"""Offline regression checks: a rejected rebuild must not publish false gaps."""
import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import build_dataset


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

    def run_build(self, failures, detail=None):
        (self.root / "detail_failures.json").write_text(
            json.dumps({"failures": failures}), encoding="utf-8")
        with patch.object(build_dataset, "RAW", str(self.root)), \
             patch.object(build_dataset, "OUT", str(self.output)), \
             patch.object(build_dataset, "detail_for", return_value=detail), \
             contextlib.redirect_stdout(io.StringIO()):
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


if __name__ == "__main__":
    unittest.main()
