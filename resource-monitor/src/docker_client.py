import json
from urllib.parse import urlencode
from urllib.request import urlopen


class DockerMetricsClient:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")

    def _get(self, path: str, query: dict[str, str] | None = None):
        suffix = f"?{urlencode(query)}" if query else ""
        with urlopen(f"{self.base_url}{path}{suffix}", timeout=10) as response:
            return json.load(response)

    def containers(self):
        return self._get("/containers/json", {"all": "0", "size": "1"})

    def stats(self, container_id: str):
        return self._get(
            f"/containers/{container_id}/stats",
            {"stream": "false"},
        )

    def disk_usage(self):
        return self._get("/system/df")
