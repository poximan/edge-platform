import copy
import json
import os
import threading
from pathlib import Path

from navigation_catalog import normalize_ip


class ClientsStorage:
    """Registro acumulativo en TXT; nunca guarda permisos ni sesiones."""

    def __init__(self, path, catalog):
        self.path, self.catalog = Path(path), catalog
        self.lock = threading.RLock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.clients = {}
        if self.path.exists():
            data = json.loads(self.path.read_text(encoding='utf-8'))
            if data.get('version') != 1 or not isinstance(data.get('clients'), dict):
                raise ValueError('Registro TXT de clientes invalido')
            for ip, client in data['clients'].items():
                if normalize_ip(ip) != ip or not isinstance(client, dict):
                    raise ValueError('IP invalida en registro de clientes')
                if (not isinstance(client.get('alias'), str) or not isinstance(client.get('landing_seen'), bool)
                        or not isinstance(client.get('navigation'), dict)
                        or 'hostname' not in client or not isinstance(client['hostname'], (str, type(None)))):
                    raise ValueError('Contrato de cliente invalido')
                for identifier, visit in client['navigation'].items():
                    if (identifier not in catalog.by_id or not isinstance(visit, dict)
                            or not isinstance(visit.get('attempted'), bool)
                            or not isinstance(visit.get('entered'), bool) or not isinstance(visit.get('pages'), list)
                            or any(page not in catalog.by_id[identifier]['pages'] for page in visit['pages'])):
                        raise ValueError('Arbol de navegacion invalido')
            self.clients = data['clients']

    def _change(self, ip, operation):
        ip = normalize_ip(ip)
        with self.lock:
            candidate = copy.deepcopy(self.clients.get(ip, {
                'alias': '', 'hostname': None, 'landing_seen': False, 'navigation': {},
            }))
            operation(candidate)
            if candidate == self.clients.get(ip):
                return
            clients = {**self.clients, ip: candidate}
            temporary = self.path.with_name(self.path.name + '.tmp')
            descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            try:
                with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
                    json.dump({'version': 1, 'clients': clients}, output, ensure_ascii=False, indent=2)
                    output.write('\n')
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(temporary, self.path)
                directory = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(directory)
                finally:
                    os.close(directory)
            finally:
                temporary.unlink(missing_ok=True)
            self.clients = clients

    def seen(self, ip):
        self._change(ip, lambda client: None)

    def landing(self, ip):
        self._change(ip, lambda client: client.update(landing_seen=True))

    def known(self, ip):
        with self.lock:
            return self.clients.get(normalize_ip(ip), {}).get('landing_seen') is True

    def alias(self, ip, alias):
        if (not isinstance(alias, str) or len(alias) > 120
                or any(ord(character) < 32 for character in alias)):
            raise ValueError('El alias admite hasta 120 caracteres, sin saltos de linea')
        with self.lock:
            if normalize_ip(ip) not in self.clients:
                raise KeyError('Cliente desconocido')
        self._change(ip, lambda client: client.update(alias=alias.strip()))

    def hostname(self, ip, name):
        self._change(ip, lambda client: client.update(hostname=name))

    def navigation(self, ip, identifier, entered=False, screen=None):
        if identifier not in self.catalog.by_id:
            raise ValueError('Producto desconocido')
        if screen is not None and screen not in self.catalog.by_id[identifier]['pages']:
            raise ValueError('Pantalla desconocida')
        def update(client):
            visit = client['navigation'].setdefault(identifier, {'attempted': False, 'entered': False, 'pages': []})
            visit['attempted'] = True
            if entered:
                visit['entered'] = True
                if screen is not None and screen not in visit['pages']:
                    visit['pages'].append(screen)
        self._change(ip, update)

    def snapshot(self):
        with self.lock:
            return copy.deepcopy(self.clients)
