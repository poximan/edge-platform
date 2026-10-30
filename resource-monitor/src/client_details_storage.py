import copy
import csv
import hashlib
import io
import json
import os
import re
import tempfile
import threading
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit

from navigation_catalog import normalize_ip


FIELDS = ('ip', 'dns_name', 'entity', 'asn', 'description', 'reviewed_on',
          'dns_verification', 'source_urls')
LIMITS = {'dns_name': 253, 'entity': 240, 'asn': 12, 'description': 4000,
          'reviewed_on': 10, 'dns_verification': 2000, 'source_urls': 6000}


class ClientDetailsConflict(ValueError):
    pass


class ClientDetailsStorage:
    """Catalogo CSV de identificacion, separado de visitas y aliases manuales."""

    def __init__(self, path, seed_path):
        self.path = Path(path)
        self.lock = threading.RLock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            rows = self._read(Path(seed_path))
            self._write(rows)
        self._read(self.path)

    @staticmethod
    def validate(row):
        if not isinstance(row, dict) or set(row) != set(FIELDS):
            raise ValueError('Se requieren todas las columnas del inventario')
        normalized = {'ip': normalize_ip(row['ip'])}
        for field, limit in LIMITS.items():
            value = row[field]
            if (not isinstance(value, str) or len(value) > limit
                    or any(ord(character) < 32 and character not in '\n\r\t' for character in value)):
                raise ValueError(f'Campo {field} invalido; maximo {limit} caracteres')
            normalized[field] = value.strip()
        if normalized['reviewed_on']:
            parsed_date = date.fromisoformat(normalized['reviewed_on'])
            if parsed_date.isoformat() != normalized['reviewed_on']:
                raise ValueError('La fecha debe tener formato AAAA-MM-DD')
        if normalized['asn'] and (not re.fullmatch(r'AS[1-9][0-9]{0,9}', normalized['asn'])
                                  or int(normalized['asn'][2:]) > 4294967295):
            raise ValueError('ASN invalido; utilizar AS seguido del numero')
        urls = normalized['source_urls'].split()
        for url in urls:
            parsed = urlsplit(url)
            if (parsed.scheme not in {'https', 'http'} or not parsed.hostname
                    or parsed.username is not None or parsed.password is not None):
                raise ValueError('Las fuentes deben ser URL HTTP o HTTPS, separadas por espacios')
        normalized['source_urls'] = ' '.join(urls)
        return normalized

    @classmethod
    def _read(cls, path):
        try:
            with path.open('r', encoding='utf-8-sig', newline='') as handle:
                reader = csv.DictReader(handle)
                if reader.fieldnames != list(FIELDS):
                    raise ValueError('Columnas CSV incorrectas')
                rows = {}
                for number, raw in enumerate(reader, 2):
                    row = cls.validate(raw)
                    if row['ip'] != raw['ip'] or row['ip'] in rows:
                        raise ValueError(f'IP repetida o no canonica en fila {number}')
                    rows[row['ip']] = row
                return rows
        except (ValueError, TypeError, csv.Error, UnicodeError) as error:
            raise RuntimeError(f'Inventario CSV invalido: {error}') from None

    @staticmethod
    def _revision(row):
        if row is None:
            return None
        return hashlib.sha256(json.dumps(row, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

    @classmethod
    def _contract(cls, row):
        return {**row, 'revision': cls._revision(row)}

    def snapshot(self):
        with self.lock:
            return {ip: self._contract(row) for ip, row in self._read(self.path).items()}

    def csv_bytes(self):
        with self.lock:
            return self._serialize(self._read(self.path)).encode('utf-8-sig')

    @staticmethod
    def _serialize(rows):
        output = io.StringIO(newline='')
        writer = csv.DictWriter(output, fieldnames=FIELDS, lineterminator='\n')
        writer.writeheader()
        writer.writerows(rows.values())
        return output.getvalue()

    def _write(self, rows):
        temporary = None
        try:
            with tempfile.NamedTemporaryFile('w', encoding='utf-8', newline='',
                                             dir=self.path.parent, delete=False) as handle:
                temporary = Path(handle.name)
                os.chmod(temporary, 0o600)
                handle.write(self._serialize(rows))
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.path)
            directory = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    def update(self, ip, details, revision):
        ip = normalize_ip(ip)
        if not isinstance(details, dict) or set(details) != set(FIELDS) - {'ip'}:
            raise ValueError('Los detalles deben contener todas las columnas salvo IP')
        if revision is not None and (not isinstance(revision, str) or not re.fullmatch(r'[a-f0-9]{64}', revision)):
            raise ValueError('Revision del inventario invalida')
        candidate = self.validate({'ip': ip, **details})
        with self.lock:
            rows = self._read(self.path)
            if self._revision(rows.get(ip)) != revision:
                raise ClientDetailsConflict('Los datos cambiaron durante la edicion. Cancele y abra nuevamente para revisar la version actual.')
            rows[ip] = candidate
            self._write(rows)
            return copy.deepcopy(self._contract(candidate))
