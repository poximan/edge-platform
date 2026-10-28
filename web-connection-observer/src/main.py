import hmac
import ipaddress
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from navigation_catalog import normalize_ip


def decode_address(value):
    if len(value) == 8:
        raw = int(value, 16).to_bytes(4, sys.byteorder)
    elif len(value) == 32:
        raw = b''.join(int(value[index:index + 8], 16).to_bytes(4, sys.byteorder) for index in range(0, 32, 8))
    else:
        raise ValueError('Direccion de socket invalida')
    return normalize_ip(str(ipaddress.ip_address(raw)))


def read_connections(root, ports):
    connections = []
    for name in ('tcp', 'tcp6'):
        for line in (Path(root) / name).read_text(encoding='ascii').splitlines()[1:]:
            fields = line.split()
            if len(fields) < 4:
                raise ValueError('Tabla de conexiones TCP invalida')
            if fields[3] != '01':
                continue
            local_address, local_port = fields[1].split(':')
            local_port = int(local_port, 16)
            if local_port not in ports:
                continue
            remote_address, remote_port = fields[2].split(':')
            connections.append({'ip': decode_address(remote_address), 'remote_port': int(remote_port, 16),
                                'server_port': ports[local_port], 'transport': 'TCP'})
    return connections


def main():
    key = os.environ['WEB_CLIENTS_KEY']
    ports = {int(local): int(public) for local, public in
             (item.split(':') for item in os.environ['WEB_LISTENER_PORTS'].split(','))}
    if len(key) < 32 or not ports or any(not 0 < number < 65536 for pair in ports.items() for number in pair):
        raise ValueError('Configuracion del observador invalida')

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            return

        def do_GET(self):
            if self.path != '/api/v1/connections':
                self.send_error(404)
                return
            if not hmac.compare_digest(self.headers.get('X-Clients-Key', ''), key):
                self.send_error(403)
                return
            try:
                body = json.dumps({'version': 1, 'connections': read_connections('/proc/net', ports)}).encode()
            except (OSError, ValueError):
                self.send_error(503, 'No se pudo leer el estado TCP')
                return
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)

    ThreadingHTTPServer(('0.0.0.0', 8092), Handler).serve_forever()


if __name__ == '__main__':
    main()
