import json
from urllib.parse import parse_qs, urlsplit


class ClientsApi:
    def __init__(self, service):
        self.service = service

    def handle(self, handler):
        parsed = urlsplit(handler.path)
        path = parsed.path
        if not (path.startswith('/api/clients') or path.startswith('/internal/v1/clients/')):
            return False
        try:
            if path.startswith('/internal/'):
                if not self.service.authorized(handler.headers.get('X-Clients-Key')):
                    handler.json_response(403, {'error': 'Acceso interno denegado'})
                    return True
                if path == '/internal/v1/clients/known' and handler.command == 'GET':
                    ip = parse_qs(parsed.query).get('ip', [''])[0]
                    handler.json_response(200, {'known': self.service.store.known(ip)})
                    return True
                if path == '/internal/v1/clients/events' and handler.command == 'POST':
                    payload = self._body(handler)
                    self.service.event(payload['ip'], payload['event'])
                    handler.json_response(200, {'recorded': True})
                    return True
            else:
                if handler.headers.get('X-Edge-Mode') != 'protected' or not handler.headers.get('X-Edge-User', '').strip():
                    handler.json_response(403, {'error': 'Se requiere acceso protegido'})
                    return True
                if path == '/api/clients' and handler.command == 'GET':
                    handler.json_response(200, self.service.snapshot())
                    return True
                if path == '/api/clients/alias' and handler.command == 'PUT':
                    if handler.headers.get('X-Clients-Request') != '1' or handler.headers.get('Sec-Fetch-Site') == 'cross-site':
                        handler.json_response(403, {'error': 'Solicitud de edición no permitida'})
                        return True
                    payload = self._body(handler)
                    if set(payload) != {'ip', 'alias'}:
                        raise ValueError('Se requieren IP y alias')
                    self.service.store.alias(payload['ip'], payload['alias'])
                    handler.json_response(200, {'saved': True})
                    return True
            handler.json_response(404, {'error': 'Endpoint de clientes inexistente'})
        except (ValueError, KeyError, TypeError) as error:
            handler.json_response(400, {'error': str(error)})
        except OSError:
            handler.json_response(503, {'error': 'No se pudo leer o guardar el registro de clientes'})
        return True

    @staticmethod
    def _body(handler):
        length = int(handler.headers.get('Content-Length', '0'))
        if not 0 < length <= 4096 or handler.headers.get_content_type() != 'application/json':
            raise ValueError('Se requiere un objeto JSON de hasta 4096 bytes')
        data = json.loads(handler.rfile.read(length).decode('utf-8'))
        if not isinstance(data, dict):
            raise ValueError('El cuerpo debe ser un objeto')
        return data
