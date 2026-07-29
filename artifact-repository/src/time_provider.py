from __future__ import annotations

from datetime import datetime, timedelta, timezone
import logging
from typing import Callable


UTC = timezone.utc
PRESENTATION_TIMEZONE = timezone(timedelta(hours=-3), name="UTC-03:00")


class TimeProvider:
    def __init__(self, utc_now_source: Callable[[], datetime] | None = None) -> None:
        self._utc_now_source = utc_now_source or (lambda: datetime.now(UTC))

    def now_utc(self) -> datetime:
        value = self._utc_now_source()
        if value.tzinfo is None:
            raise ValueError("La fuente de hora debe devolver un datetime con zona")
        return value.astimezone(UTC)

    def utc_iso_from_epoch(self, seconds: float) -> str:
        return datetime.fromtimestamp(seconds, UTC).isoformat()

    def format_for_presentation(
        self,
        value: datetime,
        pattern: str = "%Y-%m-%d %H:%M:%S",
    ) -> str:
        if value.tzinfo is None:
            raise ValueError("No se puede presentar un datetime sin zona")
        return value.astimezone(PRESENTATION_TIMEZONE).strftime(pattern)

    def format_epoch_for_log(self, seconds: float) -> str:
        value = datetime.fromtimestamp(seconds, UTC)
        return self.format_for_presentation(value, "%Y-%m-%d %H:%M:%S")


time_provider = TimeProvider()


class PresentationLogFormatter(logging.Formatter):
    def formatTime(self, record: logging.LogRecord, datefmt: str | None = None) -> str:
        if datefmt:
            value = datetime.fromtimestamp(record.created, UTC)
            return time_provider.format_for_presentation(value, datefmt)
        return time_provider.format_epoch_for_log(record.created)
