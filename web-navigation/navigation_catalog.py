import ipaddress
import json
import posixpath
import re
from pathlib import Path
from urllib.parse import unquote


def normalize_ip(value):
    address = ipaddress.ip_address(value)
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        address = address.ipv4_mapped
    if address.is_unspecified or address.is_multicast or '%' in str(address):
        raise ValueError("IP de cliente invalida")
    return str(address)


class NavigationCatalog:
    def __init__(self, path):
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        if data.get("version") != 1 or not data.get("products"):
            raise ValueError("Catalogo de navegacion invalido")
        self.products = data["products"]
        self.by_id = {}
        prefixes = set()
        for product in self.products:
            identifier, prefix = product["id"], product["prefix"]
            if (identifier in self.by_id or prefix in prefixes or not prefix.startswith('/')
                    or not prefix.endswith('/') or not product['label'] or not isinstance(product['pages'], dict)):
                raise ValueError("Producto de navegacion invalido o duplicado")
            self.by_id[identifier] = product
            prefixes.add(prefix)

    def page(self, raw_path):
        if not isinstance(raw_path, str) or not raw_path.startswith('/'):
            return None
        # Coincide con la normalizacion de URI realizada por Nginx al rutear.
        path = posixpath.normpath(re.sub('/+', '/', unquote(raw_path.split('?', 1)[0])))
        for product in self.products:
            prefix = product['prefix']
            if path != prefix.rstrip('/') and not path.startswith(prefix):
                continue
            suffix = path[len(prefix):].strip('/') if path.startswith(prefix) else ''
            # Los assets y contratos de red no son pantallas ni conceden acceso.
            filename = suffix.split('/')[-1]
            if (suffix.split('/')[0] in {'api', 'assets', 'static', 'health', 'internal'}
                    or ('.' in filename and not filename.lower().endswith(('.html', '.htm')))):
                return None
            if suffix == 'index.html':
                suffix = ''
            return product, suffix if suffix in product['pages'] else None
        return None
