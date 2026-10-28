import json
import os
import signal
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from .collector import ResourceCollector
from .history_service import ResourceHistoryService
from .docker_client import DockerMetricsClient
from .storage import MetricsStorage
from .modbus_client import ModbusDiagnosticsClient
from navigation_catalog import NavigationCatalog
from .clients_storage import ClientsStorage
from .clients_service import ClientsService
from .clients_api import ClientsApi
from .clients_events import ClientEventsReceiver


def required_int(name: str, minimum: int, maximum: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        raise RuntimeError(f"Falta variable obligatoria: {name}")
    value = int(raw)
    if value < minimum or value > maximum:
        raise RuntimeError(f"{name} debe estar entre {minimum} y {maximum}")
    return value


STATIC_ROOT = Path("/app/static")
navigation_catalog = NavigationCatalog(os.environ['WEB_NAVIGATION_CATALOG_FILE'])
clients_service = ClientsService(
    ClientsStorage(os.environ['WEB_CLIENTS_FILE'], navigation_catalog), navigation_catalog,
    os.environ['WEB_CONNECTION_OBSERVER_URL'], os.environ['WEB_CLIENTS_KEY'],
)
if len(clients_service.key) < 32:
    raise ValueError('WEB_CLIENTS_KEY debe contener al menos 32 caracteres')
clients_api = ClientsApi(clients_service)
client_events = ClientEventsReceiver(clients_service)
modbus_client = ModbusDiagnosticsClient(os.environ["MODBUS_DIAGNOSTICS_URL"])
storage = MetricsStorage(
    os.environ.get("RESOURCE_DB_PATH", "/data/resources.sqlite3"),
    required_int("RETENTION_DAYS", 1, 366),
)
history_service = ResourceHistoryService(storage)
collector = ResourceCollector(
    DockerMetricsClient(os.environ.get("DOCKER_METRICS_URL", "http://docker-metrics-proxy:2375")),
    storage,
    required_int("SAMPLE_INTERVAL_SECONDS", 15, 3600),
)


class Handler(BaseHTTPRequestHandler):
    server_version = "servicoop-resource-monitor/1"

    def log_message(self, pattern: str, *args: object) -> None:
        print(f"{self.address_string()} {pattern % args}", flush=True)

    def response(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def json_response(self, status: int, payload: object) -> None:
        self.response(status, json.dumps(payload, separators=(",", ":")).encode("utf-8"), "application/json")

    def do_GET(self) -> None:
        if clients_api.handle(self):
            return
        parsed = urlsplit(self.path)
        if parsed.path == "/health":
            health = collector.health()
            self.json_response(200 if health["status"] == "UP" else 503, health)
            return
        if parsed.path == "/api/snapshot":
            try:
                self.json_response(200, collector.current())
            except RuntimeError as error:
                self.json_response(503, {"error": str(error)})
            return
        if parsed.path == "/api/modbus":
            try:
                self.json_response(200, modbus_client.current())
            except Exception as error:
                self.json_response(503, {"error": f"Experto Modbus no disponible: {error}"})
            return
        if parsed.path == "/api/history":
            query = parse_qs(parsed.query)
            try:
                hours = int(query.get("hours", ["24"])[0])
            except ValueError:
                self.json_response(400, {"error": "hours_invalido"})
                return
            if hours not in {1, 6, 24, 168, 744}:
                self.json_response(400, {"error": "hours_fuera_de_rango"})
                return
            product = query.get("product", [None])[0]
            if product not in {None, "lechuza-server", "chatcheto", "moto-tester", "platform", "otros"}:
                self.json_response(400, {"error": "product_invalido"})
                return
            include_host = query.get("include_host", ["1"])[0]
            if include_host not in {"0", "1"}:
                self.json_response(400, {"error": "include_host_invalido"})
                return
            self.json_response(200, history_service.get(hours, product, include_host == "1"))
            return

        files = {
            "/": ("index.html", "text/html; charset=utf-8"),
            "/tokens.css": ("tokens.css", "text/css; charset=utf-8"),
            "/base.css": ("base.css", "text/css; charset=utf-8"),
            "/styles.css": ("styles.css", "text/css; charset=utf-8"),
            "/app.js": ("app.js", "text/javascript; charset=utf-8"),
            "/trend-chart.js": ("trend-chart.js", "text/javascript; charset=utf-8"),
            "/modbus.js": ("modbus.js", "text/javascript; charset=utf-8"),
            "/tabs.js": ("tabs.js", "text/javascript; charset=utf-8"),
            "/clients.js": ("clients.js", "text/javascript; charset=utf-8"),
            "/clients.css": ("clients.css", "text/css; charset=utf-8"),
            "/visit-tracker.js": ("visit-tracker.js", "text/javascript; charset=utf-8"),
        }
        target = files.get(parsed.path)
        if target is None:
            self.json_response(404, {"error": "no_encontrado"})
            return
        self.response(200, (STATIC_ROOT / target[0]).read_bytes(), target[1])

    def do_POST(self):
        if not clients_api.handle(self):
            self.json_response(404, {'error': 'Endpoint inexistente'})

    def do_PUT(self):
        if not clients_api.handle(self):
            self.json_response(404, {'error': 'Endpoint inexistente'})


server = ThreadingHTTPServer(("0.0.0.0", 8091), Handler)


def shutdown(_signal, _frame) -> None:
    threading.Thread(target=server.shutdown, name="resource-monitor-shutdown", daemon=True).start()


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    collector.start()
    clients_service.start()
    client_events.start()
    try:
        server.serve_forever()
    finally:
        collector.stop()
        clients_service.stop()
        client_events.stop()
        server.server_close()
