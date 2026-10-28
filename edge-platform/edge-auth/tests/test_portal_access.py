import importlib.util
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(os.environ.get('PLATFORM_SOURCE', Path(__file__).resolve().parents[3]))
sys.path.insert(0, str(ROOT / 'web-navigation'))
sys.path.insert(0, str(ROOT / 'edge-platform/edge-auth'))
os.environ.update(EDGE_PROTECTED_USER='test-user', EDGE_PROTECTED_PASS='test-password',
                  KITE_CAT_USER='kite-user', KITE_CAT_PASS='kite-password',
                  EDGE_SESSION_SECRET='test-session-secret-' * 3, EDGE_SESSION_COOKIE_NAME='test_session',
                  EDGE_SESSION_TTL_SECONDS='600', WEB_CLIENTS_URL='http://unused', WEB_CLIENTS_KEY='k' * 48,
                  WEB_NAVIGATION_CATALOG_FILE=str(ROOT / 'web-navigation/catalog.json'))
from src import main


class Registry:
    def __init__(self):
        self.visited = False

    def known(self, ip):
        return self.visited

    def event(self, ip, event):
        if event['type'] == 'landing':
            self.visited = True


class PortalAccessTests(unittest.TestCase):
    def setUp(self):
        self.registry = Registry()
        self.client = main.app.test_client()
        self.patches = [patch.object(main, 'client_registry', self.registry),
                        patch.object(main.portal_access, 'registry', self.registry)]
        for item in self.patches:
            item.start()
        self.headers = {'X-Edge-Public': '1', 'X-Edge-Client-IP': '192.0.2.10',
                        'X-Edge-Original-URI': '/moto-tester/'}

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()

    def authenticate(self):
        self.client.set_cookie('test_session', main._issue_session('test-user'))

    def test_first_visit_required_once_for_public_product(self):
        self.assertEqual(self.client.get('/session', headers=self.headers).status_code, 401)
        self.assertEqual(self.client.get('/landing', headers=self.headers).status_code, 204)
        self.assertEqual(self.client.get('/session', headers=self.headers).status_code, 204)
        self.assertEqual(self.client.get('/session', headers=self.headers).status_code, 204)

    def test_equivalent_paths_cannot_skip_first_landing(self):
        for uri in ('/moto-tester/index.html', '//moto-tester/', '/other/../moto-tester/',
                    '/other/%2e%2e/moto-tester/', '/moto-tester//'):
            self.assertEqual(self.client.get('/session', headers={**self.headers, 'X-Edge-Original-URI': uri}).status_code, 401)

    def test_previously_public_product_still_requires_current_credentials(self):
        self.registry.visited = True
        self.assertEqual(self.client.get('/session', headers=self.headers).status_code, 204)
        self.assertEqual(self.client.get('/verify', headers=self.headers).status_code, 401)
        self.authenticate()
        self.assertEqual(self.client.get('/verify', headers=self.headers).status_code, 204)

    def test_valid_session_does_not_replace_first_landing(self):
        self.authenticate()
        self.assertEqual(self.client.get('/verify', headers=self.headers).status_code, 401)

    def test_spoofed_mode_header_is_not_authentication(self):
        self.registry.visited = True
        self.assertEqual(self.client.get('/verify', headers={**self.headers, 'X-Edge-Mode': 'protected'}).status_code, 401)

    def test_registry_failure_is_not_treated_as_known_client(self):
        with patch.object(self.registry, 'known', side_effect=OSError('registro no disponible')):
            self.assertEqual(self.client.get('/session', headers=self.headers).status_code, 503)

    def test_failed_landing_persistence_does_not_grant_entry(self):
        with patch.object(self.registry, 'event', side_effect=OSError('disco no disponible')):
            self.assertEqual(self.client.get('/landing', headers=self.headers).status_code, 503)
        self.assertEqual(self.client.get('/session', headers=self.headers).status_code, 401)

    def test_internal_apis_and_assets_do_not_require_navigation_visits(self):
        for uri in ('/lechu/api/caudalimetros', '/kite-cat/assets/app.js', '/kite-cat/logo.png'):
            self.assertEqual(self.client.get('/session', headers={**self.headers, 'X-Edge-Original-URI': uri}).status_code, 204)
        self.assertEqual(self.client.get('/verify', headers={**self.headers, 'X-Edge-Original-URI': '/kite-cat/api/v1/inventory'}).status_code, 401)

    def test_browser_cannot_manufacture_landing_event(self):
        headers = {**self.headers, 'X-Portal-Event': '1', 'Origin': 'https://portal.test',
                   'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'portal.test'}
        self.assertEqual(self.client.post('/events', headers=headers, json={'type': 'landing', 'path': '/'}).status_code, 400)
        self.assertFalse(self.registry.visited)
        self.assertEqual(self.client.post('/events', headers={**headers, 'Origin': 'https://other.test'},
                                          json={'type': 'view', 'path': '/lechu/'}).status_code, 403)


if __name__ == '__main__':
    unittest.main()
