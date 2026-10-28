import unittest
from unittest.mock import patch

from test_portal_access import main, Registry


class KiteAccessTests(unittest.TestCase):
    def setUp(self):
        self.client = main.app.test_client()
        self.registry = Registry()
        self.registry.visited = True
        self.patch = patch.object(main.portal_access, 'registry', self.registry)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def login(self, path='/kite-cat/login', user='kite-user', password='kite-password'):
        return self.client.post(path, headers={'X-Mode-User': user, 'X-Mode-Pass': password})

    def verify(self, uri):
        return self.client.get('/verify', headers={'X-Edge-Original-URI': uri, 'X-Edge-Public': '1',
                                                   'X-Edge-Client-IP': '192.0.2.10'})

    def test_kite_login_grants_only_kite_pages_and_api(self):
        response = self.login()
        self.assertEqual(response.status_code, 204)
        cookie = response.headers['Set-Cookie']
        self.assertIn(main.KITE_CAT_COOKIE_NAME, cookie)
        for attribute in ('Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/'):
            self.assertIn(attribute, cookie)
        for uri in ('/kite-cat/', '/kite-cat/api/v1/inventory', '/kite-cat/assets/app.js'):
            with self.subTest(uri=uri):
                self.assertEqual(self.verify(uri).status_code, 204)
        for uri in ('/lechu/proxmox', '/alarmero/', '/recursos/', '/chatcheto/', '/kite-cat-other/'):
            with self.subTest(uri=uri):
                self.assertEqual(self.verify(uri).status_code, 401)

    def test_global_credentials_are_unchanged_and_do_not_grant_kite(self):
        self.assertEqual(self.login('/login', 'test-user', 'test-password').status_code, 204)
        self.assertEqual(self.verify('/lechu/proxmox').status_code, 204)
        self.assertEqual(self.verify('/recursos/').status_code, 204)
        self.assertEqual(self.verify('/kite-cat/api/v1/inventory').status_code, 401)
        self.assertEqual(self.login(user='test-user', password='test-password').status_code, 403)
        self.assertEqual(self.login('/login').status_code, 403)

    def test_cookies_can_coexist_and_logout_clears_both(self):
        self.login('/login', 'test-user', 'test-password')
        self.login()
        self.assertEqual(self.verify('/recursos/').status_code, 204)
        self.assertEqual(self.verify('/kite-cat/').status_code, 204)
        self.assertEqual(self.client.get('/logout').status_code, 302)
        self.assertEqual(self.verify('/recursos/').status_code, 401)
        self.assertEqual(self.verify('/kite-cat/').status_code, 401)

    def test_cookie_cannot_be_reused_in_another_scope_even_with_same_username(self):
        with patch.object(main, 'KITE_CAT_USER', main.PROTECTED_USER):
            self.client.set_cookie(main.KITE_CAT_COOKIE_NAME, main._issue_session(main.PROTECTED_USER))
            self.assertEqual(self.verify('/kite-cat/').status_code, 401)
            self.client.set_cookie(main.COOKIE_NAME, main._issue_session(main.PROTECTED_USER, 'kite-cat'))
            self.assertEqual(self.verify('/recursos/').status_code, 401)

    def test_normalized_paths_cannot_reuse_global_session_for_kite(self):
        self.login('/login', 'test-user', 'test-password')
        for uri in ('//kite-cat/', '/other/../kite-cat/', '/other/%2e%2e/kite-cat/',
                    '/kite%2dcat/api/v1/inventory', '/kite-cat//api/v1/inventory?x=1'):
            with self.subTest(uri=uri):
                self.assertEqual(self.verify(uri).status_code, 401)
        self.login()
        self.assertEqual(self.verify('/other/../kite-cat/').status_code, 204)

    def test_first_landing_is_still_required_for_kite(self):
        self.login()
        self.registry.visited = False
        self.assertEqual(self.verify('/kite-cat/').status_code, 401)

    def test_invalid_password_and_expired_or_forged_session_are_rejected(self):
        self.assertEqual(self.login(password='wrong').status_code, 403)
        self.login()
        with patch.object(main, 'epoch_seconds', return_value=main.epoch_seconds() + 601):
            self.assertEqual(self.verify('/kite-cat/').status_code, 401)
        self.client.set_cookie(main.KITE_CAT_COOKIE_NAME, main._issue_session('kite-user', 'kite-cat') + 'x')
        self.assertEqual(self.verify('/kite-cat/').status_code, 401)


if __name__ == '__main__':
    unittest.main()
