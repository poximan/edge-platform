from datetime import datetime, timezone
import unittest

from src.time_provider import TimeProvider


class TimeProviderTest(unittest.TestCase):
    def test_file_timestamp_stays_utc_and_logs_use_utc_minus_three(self) -> None:
        provider = TimeProvider(
            utc_now_source=lambda: datetime(2026, 7, 27, 2, 30, tzinfo=timezone.utc),
        )
        self.assertEqual(
            "2026-07-27T02:30:00+00:00",
            provider.utc_iso_from_epoch(provider.now_utc().timestamp()),
        )
        self.assertEqual(
            "2026-07-26 23:30:00",
            provider.format_for_presentation(provider.now_utc()),
        )


if __name__ == "__main__":
    unittest.main()
