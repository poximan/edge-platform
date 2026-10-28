import json
import logging
import socketserver
import threading


class ClientEventsReceiver:
    def __init__(self, service, port=8093):
        class Handler(socketserver.BaseRequestHandler):
            def handle(self):
                raw = self.request[0]
                try:
                    start = raw.index(b'{')
                    service.access_log(json.loads(raw[start:].decode('utf-8')))
                except (ValueError, KeyError, TypeError, UnicodeError):
                    logging.warning('Evento de acceso web rechazado')
                except Exception:
                    logging.exception('No se pudo conservar un acceso web')
        self.server = socketserver.UDPServer(('0.0.0.0', port), Handler)

    def start(self):
        self.thread = threading.Thread(target=self.server.serve_forever, name='web-access-events', daemon=True)
        self.thread.start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
