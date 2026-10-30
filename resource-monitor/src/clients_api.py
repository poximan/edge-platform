import json
from urllib.parse import parse_qs, urlsplit

from .client_details_storage import ClientDetailsConflict


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
                if path == '/api/clients/identification' and handler.command == 'GET':
                    handler.json_response(200, {'version': 1, 'items': list(self.service.details_store.snapshot().values())})
                    return True
                if path == '/api/clients/identification.csv' and handler.command == 'GET':
                    handler.response(200, self.service.details_store.csv_bytes(), 'text/csv; charset=utf-8')
                    return True
                if path in {'/api/clients/alias', '/api/clients/identification'} and handler.command == 'PUT':
                    if handler.headers.get('X-Clients-Request') != '1' or handler.headers.get('Sec-Fetch-Site') == 'cross-site':
                        handler.json_response(403, {'error': 'Solicitud de edición no permitida'})
                        return True
                    payload = self._body(handler, maximum=65536 if path.endswith('/identification') else 4096)
                    if path.endswith('/alias'):
                        if set(payload) != {'ip', 'alias'}:
                            raise ValueError('Se requieren IP y alias')
                        self.service.store.alias(payload['ip'], payload['alias'])
                        handler.json_response(200, {'saved': True})
                    else:
                        if set(payload) != {'ip', 'details', 'revision'}:
                            raise ValueError('Se requieren IP, detalles y revision')
                        details = self.service.details_store.update(payload['ip'], payload['details'], payload['revision'])
                        handler.json_response(200, {'saved': True, 'identification': details})
                    return True
            handler.json_response(404, {'error': 'Endpoint de clientes inexistente'})
        except ClientDetailsConflict as error:
            handler.json_response(409, {'error': str(error)})
        except (ValueError, KeyError, TypeError) as error:
            handler.json_response(400, {'error': str(error)})
        except OSError:
            handler.json_response(503, {'error': 'No se pudo leer o guardar el registro de clientes'})
        except RuntimeError as error:
            handler.json_response(503, {'error': str(error)})
        return True

    @staticmethod
    def _body(handler, maximum=4096):
        length = int(handler.headers.get('Content-Length', '0'))
        if not 0 < length <= maximum or handler.headers.get_content_type() != 'application/json':
            raise ValueError(f'Se requiere un objeto JSON de hasta {maximum} bytes')
        data = json.loads(handler.rfile.read(length).decode('utf-8'))
        if not isinstance(data, dict):
            raise ValueError('El cuerpo debe ser un objeto')
        return data
