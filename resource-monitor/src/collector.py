import shutil
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed


def product_for(name: str) -> str:
    if name == "lechu" or name.startswith("lechu-"):
        return "lechuza-server"
    if name.startswith("chatcheto-"):
        return "chatcheto"
    if name.startswith("moto-tester-"):
        return "moto-tester"
    if name.startswith("platform-"):
        return "platform"
    return "otros"


def sum_network(stats: dict, field: str) -> int:
    return sum(int(item.get(field, 0)) for item in stats.get("networks", {}).values())


def sum_block(stats: dict, operation: str) -> int:
    rows = stats.get("blkio_stats", {}).get("io_service_bytes_recursive") or []
    return sum(int(row.get("value", 0)) for row in rows if str(row.get("op", "")).lower() == operation)


def cpu_percent(stats: dict) -> float:
    current = stats.get("cpu_stats", {})
    previous = stats.get("precpu_stats", {})
    cpu_delta = int(current.get("cpu_usage", {}).get("total_usage", 0)) - int(
        previous.get("cpu_usage", {}).get("total_usage", 0)
    )
    system_delta = int(current.get("system_cpu_usage", 0)) - int(previous.get("system_cpu_usage", 0))
    cpus = int(current.get("online_cpus") or len(current.get("cpu_usage", {}).get("percpu_usage") or []) or 1)
    if cpu_delta <= 0 or system_delta <= 0:
        return 0.0
    return round(cpu_delta / system_delta * cpus * 100.0, 2)


def normalize(container: dict, stats: dict) -> dict:
    name = str((container.get("Names") or [container.get("Id", "desconocido")])[0]).lstrip("/")
    memory = stats.get("memory_stats", {})
    raw_usage = int(memory.get("usage", 0))
    cache = int(memory.get("stats", {}).get("inactive_file", 0))
    return {
        "id": str(container["Id"]),
        "name": name,
        "product": product_for(name),
        "image": str(container.get("Image", "")),
        "cpu_percent": cpu_percent(stats),
        "memory_bytes": max(0, raw_usage - cache),
        "memory_limit_bytes": int(memory.get("limit", 0)),
        "writable_bytes": max(0, int(container.get("SizeRw", 0))),
        "block_read_bytes": sum_block(stats, "read"),
        "block_write_bytes": sum_block(stats, "write"),
        "network_rx_bytes": sum_network(stats, "rx_bytes"),
        "network_tx_bytes": sum_network(stats, "tx_bytes"),
    }


def host_memory() -> dict:
    values = {}
    with open("/proc/meminfo", encoding="ascii") as source:
        for line in source:
            key, raw = line.split(":", 1)
            if key in {"MemTotal", "MemAvailable", "SwapTotal", "SwapFree"}:
                values[key] = int(raw.strip().split()[0]) * 1024
    required = {"MemTotal", "MemAvailable", "SwapTotal", "SwapFree"}
    if set(values) != required:
        raise RuntimeError("No se pudo leer el contrato de memoria del host")
    return {
        "memory_total_bytes": values["MemTotal"],
        "memory_used_bytes": values["MemTotal"] - values["MemAvailable"],
        "swap_total_bytes": values["SwapTotal"],
        "swap_used_bytes": values["SwapTotal"] - values["SwapFree"],
    }


class ResourceCollector:
    def __init__(self, client, storage, interval_seconds: int) -> None:
        self.client = client
        self.storage = storage
        self.interval_seconds = interval_seconds
        self.stop_event = threading.Event()
        self.lock = threading.RLock()
        self.thread = threading.Thread(target=self._loop, name="resource-collector", daemon=True)
        self.snapshot = None
        self.last_success = None
        self.last_error = None
        self.disk_cache = None
        self.disk_cache_at = 0.0

    def start(self) -> None:
        self.thread.start()

    def _docker_disk(self) -> dict:
        now = time.monotonic()
        if self.disk_cache is not None and now - self.disk_cache_at < 300:
            return self.disk_cache
        usage = self.client.disk_usage()
        self.disk_cache = {
            "image_bytes": int(usage.get("LayersSize", 0)),
            "build_cache_bytes": sum(int(item.get("Size", 0)) for item in usage.get("BuildCache") or []),
            "volume_bytes": sum(
                int(item.get("UsageData", {}).get("Size", 0))
                for item in usage.get("Volumes") or []
                if int(item.get("UsageData", {}).get("Size", 0)) > 0
            ),
        }
        self.disk_cache_at = now
        return self.disk_cache

    def collect(self) -> None:
        listed = self.client.containers()
        results = []
        with ThreadPoolExecutor(max_workers=6, thread_name_prefix="docker-stat") as executor:
            futures = {executor.submit(self.client.stats, item["Id"]): item for item in listed}
            for future in as_completed(futures):
                results.append(normalize(futures[future], future.result()))
        results.sort(key=lambda item: (item["product"], item["name"]))
        disk = shutil.disk_usage("/")
        host = {
            "disk_total_bytes": disk.total,
            "disk_used_bytes": disk.used,
            **host_memory(),
            **self._docker_disk(),
        }
        sampled_at = int(time.time())
        self.storage.save(sampled_at, results, host)
        with self.lock:
            self.snapshot = {"sampled_at": sampled_at, "containers": results, "host": host}
            self.last_success = sampled_at
            self.last_error = None

    def _loop(self) -> None:
        while not self.stop_event.is_set():
            started = time.monotonic()
            try:
                self.collect()
            except Exception as error:
                with self.lock:
                    self.last_error = str(error)
            remaining = max(1.0, self.interval_seconds - (time.monotonic() - started))
            self.stop_event.wait(remaining)

    def current(self):
        with self.lock:
            if self.snapshot is None:
                raise RuntimeError(self.last_error or "Todavia no hay una muestra disponible")
            return self.snapshot

    def health(self) -> dict:
        with self.lock:
            healthy = self.thread.is_alive() and self.last_success is not None
            return {
                "status": "UP" if healthy else "DOWN",
                "last_success": self.last_success,
                "last_error": self.last_error,
            }

    def stop(self) -> None:
        self.stop_event.set()
        self.thread.join(timeout=12)
