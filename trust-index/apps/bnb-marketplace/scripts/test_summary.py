import unittest
from generate_summary import detail_fetch_summary


class SummaryTests(unittest.TestCase):
    def test_historical_failures_are_not_current_gaps(self):
        text = detail_fetch_summary([
            {"detail_status": "read"},
            {"detail_status": "unread_rate_limited"},
            {},
        ], historical_failures=3)
        self.assertIn("**1** rows recorded as rate-limited", text)
        self.assertIn("**1** rows with unknown detail status", text)
        self.assertIn("**3** historical failure records", text)
        self.assertNotIn("this run exhausted", text)
