import http.client
import json
import re
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit


DOCKER_SOCKET = "/var/run/docker.sock"
CONTAINER_STATS = re.compile(r"^/containers/([a-f0-9]{12,64})/stats$")


class UnixConnection(http.client.HTTPConnection):
    def connect(self) -> None:
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(DOCKER_SOCKET)


def docker_get(path: str) -> tuple[int, bytes, str]:
    connection = UnixConnection("localhost", timeout=8)
    try:
        connection.request("GET", path, headers={"Accept": "application/json"})
        response = connection.getresponse()
        body = response.read(16 * 1024 * 1024 + 1)
        if len(body) > 16 * 1024 * 1024:
            raise RuntimeError("Respuesta de Docker demasiado grande")
        return response.status, body, response.getheader("Content-Type", "application/json")
    finally:
        connection.close()


def allowed_path(raw_path: str) -> str | None:
    parsed = urlsplit(raw_path)
    query = parse_qs(parsed.query, keep_blank_values=True)
    if parsed.path == "/containers/json":
        if set(query) - {"all", "size"}:
            return None
        if query.get("all", ["0"]) != ["0"] or query.get("size", ["1"]) != ["1"]:
            return None
        return "/containers/json?all=0&size=1"
    if CONTAINER_STATS.fullmatch(parsed.path):
        if set(query) - {"stream"}:
            return None
        if query.get("stream") != ["false"]:
            return None
        return f"{parsed.path}?stream=false"
    if parsed.path == "/system/df" and not query:
        return "/system/df"
    return None


class Handler(BaseHTTPRequestHandler):
    server_version = "servicoop-docker-metrics-proxy/1"

    def log_message(self, pattern: str, *args: object) -> None:
        return

    def send_json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            try:
                status, body, _ = docker_get("/_ping")
                if status != 200 or body.strip() != b"OK":
                    raise RuntimeError("Docker no responde correctamente")
                self.send_json(200, {"status": "UP"})
            except (OSError, RuntimeError, http.client.HTTPException) as error:
                self.send_json(503, {"status": "DOWN", "error": str(error)})
            return

        path = allowed_path(self.path)
        if path is None:
            self.send_json(403, {"error": "endpoint_no_permitido"})
            return
        try:
            status, body, content_type = docker_get(path)
        except (OSError, RuntimeError, http.client.HTTPException) as error:
            self.send_json(502, {"error": "docker_no_disponible", "detail": str(error)})
            return
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        self.send_json(405, {"error": "metodo_no_permitido"})

    do_PUT = do_POST
    do_DELETE = do_POST
    do_PATCH = do_POST


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 2375), Handler).serve_forever()
