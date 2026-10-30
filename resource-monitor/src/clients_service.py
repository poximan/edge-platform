import hmac
import ipaddress
import json
import logging
import queue
import socket
import threading
import time
from urllib.request import Request, urlopen

from navigation_catalog import normalize_ip


class ClientsService:
    def __init__(self, store, catalog, observer_url, key, details_store, interval=2, monotonic=time.monotonic):
        self.store, self.catalog = store, catalog
        self.observer_url, self.key, self.interval = observer_url, key, interval
        self.details_store = details_store
        self.monotonic = monotonic
        self.stop_event = threading.Event()
        self.lock = threading.Lock()
        self.connections = None
        self.updated = None
        self.error = 'Esperando la primera medición de conexiones'
        self.dns = queue.Queue(maxsize=256)
        self.dns_requested = set()

    def authorized(self, supplied):
        return bool(supplied) and hmac.compare_digest(supplied, self.key)

    def start(self):
        threading.Thread(target=self._loop, name='web-connections', daemon=True).start()
        threading.Thread(target=self._resolve_names, name='client-names', daemon=True).start()

    def stop(self):
        self.stop_event.set()

    def _loop(self):
        while not self.stop_event.is_set():
            try:
                request = Request(self.observer_url, headers={'X-Clients-Key': self.key})
                with urlopen(request, timeout=2) as response:
                    payload = json.load(response)
                if payload.get('version') != 1 or not isinstance(payload.get('connections'), list):
                    raise ValueError('Contrato de conexiones invalido')
                connections = payload['connections']
                for item in connections:
                    item['ip'] = normalize_ip(item['ip'])
                    if not all(type(item.get(field)) is int and 0 < item[field] < 65536
                               for field in ('remote_port', 'server_port')):
                        raise ValueError('Puerto de conexion invalido')
                    self.store.seen(item['ip'])
                with self.lock:
                    self.connections, self.updated, self.error = connections, self.monotonic(), None
            except Exception as error:
                with self.lock:
                    self.error = f'No se pudo medir la conexión real ({type(error).__name__})'
            self.stop_event.wait(self.interval)

    def _resolve_names(self):
        while not self.stop_event.is_set():
            try:
                ip = self.dns.get(timeout=1)
            except queue.Empty:
                continue
            try:
                name = socket.gethostbyaddr(ip)[0]
                if name and len(name) <= 253 and name != ip:
                    self.store.hostname(ip, name)
            except (OSError, ValueError):
                pass
            except Exception:
                logging.exception('No se pudo persistir el nombre de un cliente')
            finally:
                self.dns.task_done()

    def event(self, ip, event):
        ip = normalize_ip(ip)
        if not isinstance(event, dict):
            raise ValueError('El evento debe ser un objeto')
        kind = event.get('type')
        if kind == 'landing':
            self.store.landing(ip)
            return
        if kind not in {'attempt', 'view'} or not self.store.known(ip):
            raise ValueError('Evento sin visita previa al landing o tipo invalido')
        page = self.catalog.page(event.get('path', ''))
        if page is None:
            raise ValueError('El destino no pertenece al catalogo de pantallas')
        product, path_screen = page
        self.store.navigation(ip, product['id'], kind == 'view', event.get('screen') or path_screen)

    def access_log(self, event):
        ip = normalize_ip(event['ip'])
        self.store.seen(ip)
        page = self.catalog.page(event.get('path', ''))
        if page is None:
            return
        product, screen = page
        entered = (event.get('method') == 'GET' and 200 <= int(event.get('status', 0)) < 300
                   and event.get('content_type', '').startswith('text/html') and event.get('complete') == 'OK')
        self.store.navigation(ip, product['id'], entered, screen if entered else None)

    def snapshot(self):
        clients = self.store.snapshot()
        identifications = self.details_store.snapshot()
        with self.lock:
            available = self.error is None and self.updated is not None and self.monotonic() - self.updated < self.interval * 3 + 2
            connections = list(self.connections or []) if available else []
            error = self.error
        rows = []
        for ip, client in clients.items():
            with self.lock:
                if not client['hostname'] and ip not in identifications and ip not in self.dns_requested:
                    try:
                        self.dns.put_nowait(ip)
                        self.dns_requested.add(ip)
                    except queue.Full:
                        pass
            active = [item for item in connections if item['ip'] == ip]
            navigation = []
            for identifier, visit in client['navigation'].items():
                product = self.catalog.by_id[identifier]
                navigation.append({**visit, 'id': identifier, 'label': product['label'],
                                   'pages': [{'id': name, 'label': product['pages'][name]} for name in visit['pages']]})
            rows.append({'ip': ip, 'alias': client['alias'], 'hostname': client['hostname'],
                         'identification': identifications.get(ip),
                         'network': 'Internet' if ipaddress.ip_address(ip).is_global else 'LAN / privada',
                         'landing_seen': client['landing_seen'], 'navigation': navigation,
                         'connections': active, 'open_count': len(active) if available else None,
                         'connection_state': ('open' if active else 'closed') if available else 'unknown'})
        return {'version': 1, 'clients': rows, 'connection_monitor': {'available': available, 'error': error,
                'interval_seconds': self.interval}}
