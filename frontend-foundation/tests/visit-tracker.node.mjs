import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sent = [], listeners = new Map(), frames = [];
globalThis.window = {
  location: { origin: 'https://portal.test', pathname: '/lechu/exemys' },
  addEventListener(name, callback) { listeners.set(name, callback); },
  history: {
    pushState(_state, _title, path) { window.location.pathname = path.split('?')[0]; },
    replaceState(_state, _title, path) { window.location.pathname = path.split('?')[0]; },
  },
};
globalThis.requestAnimationFrame = callback => frames.push(callback);
globalThis.fetch = async (path, options) => {
  assert.equal(path, '/portal/events');
  assert.equal(options.keepalive, true);
  assert.equal(options.headers['X-Portal-Event'], '1');
  sent.push(JSON.parse(options.body));
  return { ok: true };
};
const source = await readFile(new URL('../src/navigation/visit-tracker.js', import.meta.url), 'utf8');
const tracker = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const flush = () => { while (frames.length) frames.shift()(); };
tracker.startVisitTracking();
tracker.startVisitTracking();
flush();
assert.equal(sent.length, 1);
assert.deepEqual(sent[0], { type: 'view', path: '/lechu/exemys' });
window.history.pushState(null, '', '/lechu/caudalimetros?secret=no-guardar');
flush();
window.history.replaceState(null, '', '/lechu/caudalimetros');
listeners.get('popstate')();
flush();
assert.equal(sent.length, 2);
assert.equal(sent[1].path, '/lechu/caudalimetros');
tracker.recordScreen('/recursos/?secret=no-guardar', 'clients');
tracker.recordScreen('/recursos/', 'clients');
tracker.recordProductAttempt('/kite-cat/');
tracker.recordScreen('https://otro.test/lechu/');
assert.deepEqual(sent.slice(2), [{ type: 'view', path: '/recursos/', screen: 'clients' },
                              { type: 'attempt', path: '/kite-cat/' }]);
console.log('Tracker: rutas SPA, pestañas, intentos, deduplicación y descarte de query strings OK');
