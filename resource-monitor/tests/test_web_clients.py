import importlib.util
import json
import io
from email.message import Message
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'web-navigation'))
sys.path.insert(0, str(ROOT / 'resource-monitor'))
from navigation_catalog import NavigationCatalog, normalize_ip
from src.clients_storage import ClientsStorage
from src.client_details_storage import ClientDetailsStorage
from src.clients_service import ClientsService
from src.clients_api import ClientsApi

observer_spec = importlib.util.spec_from_file_location('connection_observer', ROOT / 'web-connection-observer/src/main.py')
observer = importlib.util.module_from_spec(observer_spec)
observer_spec.loader.exec_module(observer)


class WebClientsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / 'clients.txt'
        self.catalog = NavigationCatalog(ROOT / 'web-navigation/catalog.json')
        self.store = ClientsStorage(self.path, self.catalog)
        self.identifications = ClientDetailsStorage(Path(self.directory.name) / 'client-details.csv',
                                                    ROOT / 'resource-monitor/config/client-details.csv')
        self.now = 10
        self.service = ClientsService(self.store, self.catalog, 'http://unused', 'k' * 48,
                                      self.identifications,
                                      monotonic=lambda: self.now)

    def tearDown(self):
        self.directory.cleanup()

    def request(self, command, path, headers=None, body=None):
        class Handler:
            def json_response(inner, status, payload):
                inner.result = status, payload
            def response(inner, status, payload, content_type):
                inner.result = status, payload
        handler = Handler()
        handler.command, handler.path = command, path
        handler.headers = Message()
        for name, value in (headers or {}).items():
            handler.headers[name] = value
        encoded = json.dumps(body).encode() if body is not None else b''
        if body is not None:
            handler.headers['Content-Type'] = 'application/json'
            handler.headers['Content-Length'] = str(len(encoded))
        handler.rfile = io.BytesIO(encoded)
        self.assertTrue(ClientsApi(self.service).handle(handler))
        return handler.result

    def test_client_api_requires_protected_identity_and_internal_key(self):
        self.assertEqual(self.request('GET', '/api/clients')[0], 403)
        self.assertEqual(self.request('GET', '/api/clients', {'X-Edge-Mode': 'protected'})[0], 403)
        self.assertEqual(self.request('GET', '/internal/v1/clients/known?ip=192.0.2.10')[0], 403)
        self.assertEqual(self.request('GET', '/internal/v1/clients/known?ip=192.0.2.10',
                                      {'X-Clients-Key': 'k' * 48}), (200, {'known': False}))
        self.assertEqual(self.request('GET', '/api/clients',
                                      {'X-Edge-Mode': 'protected', 'X-Edge-User': 'operator'})[0], 200)

    def test_inventory_enriches_observed_clients_without_creating_visits_or_overwriting_aliases(self):
        self.assertEqual(80, len(self.identifications.snapshot()))
        self.assertEqual([], self.service.snapshot()['clients'])
        self.store.seen('51.8.102.207')
        self.store.alias('51.8.102.207', 'Alias elegido a mano')
        client = self.service.snapshot()['clients'][0]
        self.assertEqual('Alias elegido a mano', client['alias'])
        self.assertFalse(client['landing_seen'])
        self.assertEqual([], client['navigation'])
        self.assertIn('rango de OAI-SearchBot', client['identification']['entity'])
        self.assertEqual('2026-10-29', client['identification']['reviewed_on'])

    def test_inventory_api_protects_download_and_uses_revision_for_edits(self):
        self.assertEqual(403, self.request('GET', '/api/clients/identification')[0])
        self.assertEqual(403, self.request('GET', '/api/clients/identification.csv')[0])
        headers = {'X-Edge-Mode': 'protected', 'X-Edge-User': 'operator'}
        status, data = self.request('GET', '/api/clients/identification', headers)
        self.assertEqual(200, status)
        original = data['items'][0]
        details = {name: value for name, value in original.items() if name not in {'ip', 'revision'}}
        details['description'] = 'Descripción revisada desde la interfaz'
        body = {'ip': original['ip'], 'details': details, 'revision': original['revision']}
        self.assertEqual(403, self.request('PUT', '/api/clients/identification', headers, body)[0])
        headers['X-Clients-Request'] = '1'
        self.assertEqual(403, self.request('PUT', '/api/clients/identification',
                                         {**headers, 'Sec-Fetch-Site': 'cross-site'}, body)[0])
        status, saved = self.request('PUT', '/api/clients/identification', headers, body)
        self.assertEqual(200, status)
        self.assertNotEqual(original['revision'], saved['identification']['revision'])
        self.assertEqual(409, self.request('PUT', '/api/clients/identification', headers, body)[0])
        status, exported = self.request('GET', '/api/clients/identification.csv', headers)
        self.assertEqual(200, status)
        self.assertIn('Descripción revisada desde la interfaz', exported.decode('utf-8-sig'))

    def test_inventory_rejects_unsafe_links_and_preserves_existing_csv_on_restart(self):
        original = next(iter(self.identifications.snapshot().values()))
        details = {name: value for name, value in original.items() if name not in {'ip', 'revision'}}
        with self.assertRaisesRegex(ValueError, 'HTTP'):
            self.identifications.update(original['ip'], {**details, 'source_urls': 'javascript:alert(1)'}, original['revision'])
        details['entity'] = 'Entidad verificada a mano'
        self.identifications.update(original['ip'], details, original['revision'])
        restarted = ClientDetailsStorage(self.identifications.path, ROOT / 'resource-monitor/config/client-details.csv')
        self.assertEqual('Entidad verificada a mano', restarted.snapshot()[original['ip']]['entity'])

    def test_alias_api_validates_origin_header_and_writes_txt(self):
        self.store.seen('192.0.2.10')
        headers = {'X-Edge-Mode': 'protected', 'X-Edge-User': 'operator'}
        body = {'ip': '192.0.2.10', 'alias': 'Bomba norte'}
        self.assertEqual(self.request('PUT', '/api/clients/alias', headers, body)[0], 403)
        headers['X-Clients-Request'] = '1'
        self.assertEqual(self.request('PUT', '/api/clients/alias',
                                      {**headers, 'Sec-Fetch-Site': 'cross-site'}, body)[0], 403)
        self.assertEqual(self.request('PUT', '/api/clients/alias', headers, {**body, 'session': 'fake'})[0], 400)
        self.assertEqual(self.request('PUT', '/api/clients/alias', headers, body)[0], 200)
        self.assertEqual(ClientsStorage(self.path, self.catalog).snapshot()['192.0.2.10']['alias'], 'Bomba norte')

    def test_seen_connection_does_not_authorize_first_entry(self):
        self.store.seen('192.0.2.10')
        self.assertFalse(self.store.known('192.0.2.10'))
        self.service.access_log({'ip': '192.0.2.10', 'path': '/', 'status': 200, 'method': 'GET',
                                 'content_type': 'text/html', 'complete': 'OK'})
        self.assertFalse(self.store.known('192.0.2.10'))

    def test_landing_alias_and_tree_survive_restart_without_sessions(self):
        ip = '192.0.2.10'
        self.service.event(ip, {'type': 'landing'})
        self.store.alias(ip, 'Oficina <norte> — control')
        self.service.event(ip, {'type': 'attempt', 'path': '/kite-cat/'})
        self.service.event(ip, {'type': 'view', 'path': '/lechu/caudalimetros/?token=no-guardar'})
        for _ in range(4):
            self.service.event(ip, {'type': 'view', 'path': '/lechu/caudalimetros/'})
        reopened = ClientsStorage(self.path, self.catalog)
        row = reopened.snapshot()[ip]
        self.assertTrue(reopened.known(ip))
        self.assertEqual(row['alias'], 'Oficina <norte> — control')
        self.assertEqual(row['navigation']['lechuza-server']['pages'], ['caudalimetros'])
        self.assertFalse(row['navigation']['kite-cat']['entered'])
        self.assertNotIn('token', self.path.read_text())
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)

    def test_ipv4_mapped_addresses_group_into_same_client(self):
        self.store.landing('::ffff:192.0.2.10')
        self.assertTrue(self.store.known('192.0.2.10'))
        self.store.seen('192.0.2.10')
        self.assertEqual(len(self.store.snapshot()), 1)

    def test_alias_validation_and_unknown_client(self):
        with self.assertRaises(KeyError):
            self.store.alias('192.0.2.10', 'Local')
        self.store.seen('192.0.2.10')
        for alias in ('a' * 121, 'Oficina\nNorte', None):
            with self.assertRaises(ValueError):
                self.store.alias('192.0.2.10', alias)

    def test_failed_atomic_save_never_grants_access(self):
        self.store.seen('192.0.2.10')
        before = self.path.read_text()
        with patch('src.clients_storage.os.replace', side_effect=OSError('disco no disponible')):
            with self.assertRaises(OSError):
                self.store.landing('192.0.2.10')
        self.assertFalse(self.store.known('192.0.2.10'))
        self.assertEqual(self.path.read_text(), before)

    def test_corrupt_txt_is_rejected_without_overwriting(self):
        self.path.write_text('{roto', encoding='utf-8')
        with self.assertRaises(ValueError):
            ClientsStorage(self.path, self.catalog)
        self.assertEqual(self.path.read_text(), '{roto')

    def test_assets_apis_and_query_strings_are_not_navigation_nodes(self):
        self.assertIsNone(self.catalog.page('/lechu/api/caudalimetros'))
        self.assertIsNone(self.catalog.page('/kite-cat/assets/main.js'))
        self.assertIsNone(self.catalog.page('/kite-cat/logo.png'))
        product, screen = self.catalog.page('/lechu/caudalimetros/?secret=no')
        self.assertEqual((product['id'], screen), ('lechuza-server', 'caudalimetros'))

    def test_navigation_event_requires_real_first_landing(self):
        with self.assertRaises(ValueError):
            self.service.event('192.0.2.10', {'type': 'view', 'path': '/lechu/'})
        self.store.landing('192.0.2.10')
        with self.assertRaises(ValueError):
            self.service.event('192.0.2.10', {'type': 'view', 'path': '/lechu/', 'screen': 'inventada'})

    def test_server_errors_are_attempts_not_confirmed_entries(self):
        event = {'ip': '192.0.2.10', 'path': '/reporte/', 'status': 502, 'method': 'GET',
                 'content_type': 'text/html', 'complete': 'OK'}
        self.service.access_log(event)
        self.assertFalse(self.store.snapshot()['192.0.2.10']['navigation']['reportespiolis']['entered'])
        self.service.access_log({**event, 'status': 200})
        self.assertTrue(self.store.snapshot()['192.0.2.10']['navigation']['reportespiolis']['entered'])
        self.assertFalse(self.store.known('192.0.2.10'))

    def test_live_closed_unknown_states_are_distinct(self):
        self.store.landing('192.0.2.10')
        self.assertEqual(self.service.snapshot()['clients'][0]['connection_state'], 'unknown')
        self.service.connections = [{'ip': '192.0.2.10', 'remote_port': 12345, 'server_port': 443}]
        self.service.updated, self.service.error = 10, None
        self.assertEqual(self.service.snapshot()['clients'][0]['open_count'], 1)
        self.service.connections = []
        self.assertEqual(self.service.snapshot()['clients'][0]['connection_state'], 'closed')
        self.now = 30
        row = self.service.snapshot()['clients'][0]
        self.assertEqual(row['connection_state'], 'unknown')
        self.assertIsNone(row['open_count'])
        self.service.updated = 30
        self.service.error = 'Observador no disponible'
        self.assertEqual(self.service.snapshot()['clients'][0]['connection_state'], 'unknown')

    def test_tcp_observer_counts_only_incoming_web_established_connections(self):
        root = Path(self.directory.name)
        (root / 'tcp').write_text('header\n'
            '0: 00000000:20FB 0A0200C0:C001 01\n'
            '1: 00000000:20FB 0A0200C0:C002 06\n'
            '2: 00000000:1F91 0A0200C0:C003 01\n'
            '3: 00000000:20FB 00000000:0000 0A\n')
        (root / 'tcp6').write_text('header\n'
            '0: 00000000000000000000000000000000:20FB 0000000000000000FFFF00000A0200C0:C004 01\n')
        rows = observer.read_connections(root, {8443: 443, 8080: 80})
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(row['ip'] == '192.0.2.10' for row in rows))
        self.assertTrue(all(row['server_port'] == 443 for row in rows))
        self.assertEqual(observer.decode_address('00000000000000000000000001000000'), '::1')


if __name__ == '__main__':
    unittest.main()
