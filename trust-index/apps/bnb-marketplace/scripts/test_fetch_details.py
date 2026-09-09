"""No network: validate cache repair and shared quota deferral."""
import io
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

import fetch_details


class FetchDetailTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        snapshot = Path(fetch_details.HERE) / "data" / "agents.json"
        self.agents = json.loads(snapshot.read_text(encoding="utf-8"))["agents"][:3]
        self.candidate = self.agents[0]
        self.detail = {**self.candidate, "services": None, "supported_protocols": []}
        self.cache = self.root / f"{self.candidate['chain_id']}_{self.candidate['token_id']}.json"
        fetch_details._quota_exhausted.clear()
        self.addCleanup(fetch_details._quota_exhausted.clear)
        self.patcher = patch.object(fetch_details, "DET", str(self.root))
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def test_invalid_cache_is_repaired_from_a_valid_response(self):
        self.cache.write_text('{"error":"upstream unavailable"}', encoding="utf-8")
        with patch.object(fetch_details.urllib.request, "urlopen",
                          return_value=io.BytesIO(json.dumps(self.detail).encode())) as request:
            self.assertEqual(fetch_details.fetch_one(self.candidate)[0], "ok")
            request.assert_called_once()
        self.assertEqual(json.loads(self.cache.read_text()), self.detail)

    def test_invalid_response_never_replaces_cache(self):
        self.cache.write_text('{"error":"old invalid response"}', encoding="utf-8")
        before = self.cache.read_bytes()
        with patch.object(fetch_details.urllib.request, "urlopen", return_value=io.BytesIO(b'{}')), \
             patch.object(fetch_details.time, "sleep") as sleep:
            self.assertEqual(fetch_details.fetch_one(self.candidate, tries=1)[0], "failed")
            sleep.assert_not_called()
        self.assertEqual(self.cache.read_bytes(), before)

    def test_quota_exhaustion_defers_remaining_candidates_without_sleep_or_requests(self):
        error = urllib.error.HTTPError("https://api.8004scan.io", 429, "Too Many Requests",
                                       {"Retry-After": "3600"}, None)
        self.addCleanup(error.close)
        with patch.object(fetch_details.urllib.request, "urlopen", side_effect=error) as request, \
             patch.object(fetch_details.time, "sleep") as sleep:
            first = fetch_details.fetch_one(self.agents[0])
            second = fetch_details.fetch_one(self.agents[1])
            self.assertEqual(first[0], "rate_limited")
            self.assertIn("3600", first[2])
            self.assertEqual(second[0], "rate_limited")
            self.assertIn("deferred", second[2])
            request.assert_called_once()
            sleep.assert_not_called()

    def test_valid_cache_is_still_reused_after_shared_quota_exhaustion(self):
        self.cache.write_text(json.dumps(self.detail), encoding="utf-8")
        fetch_details._quota_exhausted.set()
        with patch.object(fetch_details.urllib.request, "urlopen") as request:
            self.assertEqual(fetch_details.fetch_one(self.candidate)[0], "cached")
            request.assert_not_called()
