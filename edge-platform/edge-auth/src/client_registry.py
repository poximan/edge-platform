import json
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from navigation_catalog import normalize_ip


class ClientRegistry:
    def __init__(self, url, key):
        if not url or len(key) < 32:
            raise ValueError('Configuracion del registro de clientes invalida')
        self.url, self.key = url.rstrip('/'), key

    def _request(self, path, data=None):
        body = json.dumps(data).encode('utf-8') if data is not None else None
        request = Request(self.url + path, data=body,
                          headers={'X-Clients-Key': self.key, 'Content-Type': 'application/json'})
        with urlopen(request, timeout=3) as response:
            return json.load(response)

    def known(self, ip):
        result = self._request('/internal/v1/clients/known?' + urlencode({'ip': normalize_ip(ip)}))
        if not isinstance(result.get('known'), bool):
            raise ValueError('Respuesta del registro de clientes invalida')
        return result['known']

    def event(self, ip, event):
        result = self._request('/internal/v1/clients/events', {'ip': normalize_ip(ip), 'event': event})
        if result.get('recorded') is not True:
            raise ValueError('El registro no confirmo la persistencia del evento')
