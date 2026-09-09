"""Offline regression checks: a rejected rebuild must not publish false gaps."""
import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import build_dataset
from detail_response import validate_detail


class DetailStatusTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        # Reuse an actual committed identity; these isolated files never ship.
        snapshot = json.loads(Path(build_dataset.OUT).read_text(encoding="utf-8"))
        self.agent = snapshot["agents"][0]
        (self.root / "candidates.json").write_text(
            json.dumps({"candidates": [self.agent]}), encoding="utf-8")
        self.output = self.root / "agents.json"
        self.before = json.dumps({"agents": [self.agent]}).encode()
        self.output.write_bytes(self.before)

    def run_build(self, failures, detail=None, use_cache=False):
        (self.root / "detail_failures.json").write_text(
            json.dumps({"failures": failures}), encoding="utf-8")
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(build_dataset, "RAW", str(self.root)))
            stack.enter_context(patch.object(build_dataset, "DET", str(self.root)))
            stack.enter_context(patch.object(build_dataset, "OUT", str(self.output)))
            if not use_cache:
                stack.enter_context(patch.object(build_dataset, "detail_for", return_value=detail))
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            return build_dataset.main()

    def failure(self, status, error):
        return {"agent_id": self.agent["agent_id"], "status": status, "error": error}

    def test_unexplained_gap_leaves_published_snapshot_untouched(self):
        self.assertEqual(self.run_build([]), 1)
        self.assertEqual(self.output.read_bytes(), self.before)
        self.assertFalse(Path(str(self.output) + ".tmp").exists())

    def test_non_throttle_failure_is_not_published_as_rate_limited(self):
        for status, error in [("missing", "404 from detail endpoint"),
                              ("failed", "TimeoutError('timed out')")]:
            with self.subTest(status=status):
                self.assertEqual(self.run_build([self.failure(status, error)]), 1)
                self.assertEqual(self.output.read_bytes(), self.before)

    def test_recorded_http_429_allows_rate_limited_status(self):
        self.assertIsNone(self.run_build([
            self.failure("failed", "<HTTPError 429: 'Too Many Requests'>")]))
        row = json.loads(self.output.read_text())["agents"][0]
        self.assertEqual(row["detail_status"], "unread_rate_limited")
        self.assertIsNone(row["endpoint"])

    def test_explicit_rate_limited_record_is_supported(self):
        self.assertIsNone(self.run_build([self.failure("rate_limited", "quota exhausted")]))

    def test_read_detail_supersedes_a_stale_failure_record(self):
        detail = {**self.agent, "services": {}}
        self.assertIsNone(self.run_build([self.failure("missing", "404")], detail))
        row = json.loads(self.output.read_text())["agents"][0]
        self.assertEqual(row["detail_status"], "read")

    def test_invalid_cache_cannot_become_read_or_a_stale_throttle_gap(self):
        cache = self.root / f"{self.agent['chain_id']}_{self.agent['token_id']}.json"
        valid = {**self.agent, "services": None, "supported_protocols": []}
        bad = ["{}\n", "[]", "false", "0", "null", "{broken",
               json.dumps({"error": "temporarily unavailable"}),
               json.dumps({**valid, "agent_id": "wrong identity"}),
               json.dumps({**valid, "services": []}),
               json.dumps({**valid, "services": {"mcp": []}})]
        for body in bad:
            with self.subTest(body=body[:60]):
                cache.write_text(body, encoding="utf-8")
                self.assertEqual(self.run_build([
                    self.failure("rate_limited", "old quota failure")], use_cache=True), 1)
                self.assertEqual(self.output.read_bytes(), self.before)

    def test_valid_disk_detail_with_null_services_is_read(self):
        cache = self.root / f"{self.agent['chain_id']}_{self.agent['token_id']}.json"
        cache.write_text(json.dumps({**self.agent, "services": None,
                                     "supported_protocols": []}), encoding="utf-8")
        self.assertIsNone(self.run_build([], use_cache=True))
        row = json.loads(self.output.read_text())["agents"][0]
        self.assertEqual(row["detail_status"], "read")


class ServicesShapeTests(unittest.TestCase):
    """`services` mixes interface declarations with scalar identity values."""

    CANDIDATE = {"agent_id": "a", "chain_id": 56, "token_id": "1"}

    def _detail(self, services):
        return {"agent_id": "a", "chain_id": 56, "token_id": "1",
                "supported_protocols": ["mcp"], "services": services}

    def test_scalar_identity_values_do_not_reject_the_record(self):
        # Measured on the live cache: 4 of 8,590 responses file services["ens"]
        # = "name.eth" and services["did"] = "did:ethr:0x..." alongside the real
        # service objects. Requiring every value to be an object discarded those
        # four valid records, turning live agents into gaps -- the failure this
        # validator exists to prevent, committed by the validator.
        detail = self._detail({
            "mcp": {"endpoint": "https://example.invalid/mcp"},
            "ens": "clawdmint.eth",
            "did": "did:ethr:0x75b583C518215E272f3C0a3BCC1b27012F294Adc",
        })
        self.assertIs(validate_detail(detail, self.CANDIDATE), detail)

    def test_an_interface_key_must_still_be_an_object(self):
        with self.assertRaises(ValueError):
            validate_detail(self._detail({"mcp": "not-an-object"}), self.CANDIDATE)

    def test_an_interface_endpoint_must_still_be_a_string(self):
        with self.assertRaises(ValueError):
            validate_detail(self._detail({"a2a": {"endpoint": 42}}), self.CANDIDATE)


if __name__ == "__main__":
    unittest.main()
