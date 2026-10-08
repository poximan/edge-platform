import threading
import time


class ResourceHistoryService:
    def __init__(self, storage, cache_seconds: float = 45.0) -> None:
        self._storage = storage
        self._cache_seconds = cache_seconds
        self._lock = threading.RLock()
        self._cache: dict[tuple[int, str | None, bool], tuple[int, float, dict]] = {}

    def get(self, hours: int, product: str | None, include_host: bool = True) -> dict:
        key = (hours, product, include_host)
        with self._lock:
            revision = self._storage.revision()
            cached = self._cache.get(key)
            if cached is not None and cached[0] == revision and time.monotonic() < cached[1]:
                return cached[2]
            result, result_revision = self._storage.history(hours, product, include_host)
            self._cache[key] = (
                result_revision,
                time.monotonic() + self._cache_seconds,
                result,
            )
            return result
