import json
import threading
import time
from urllib.request import urlopen


class ModbusDiagnosticsClient:
    """Consulta al experto; nunca envia comandos al canal Modbus."""

    def __init__(self, url):
        self.url = url
        self._lock = threading.Lock()
        self._cached = None
        self._cached_at = 0

    def current(self):
        with self._lock:
            if self._cached is not None and time.monotonic() - self._cached_at < 2:
                return self._cached
            with urlopen(self.url, timeout=3) as response:
                value = json.load(response)
            if value.get("version") != 1 or not isinstance(value.get("channels"), list):
                raise ValueError("Contrato invalido del experto Modbus")
            self._cached = value
            self._cached_at = time.monotonic()
            return value
