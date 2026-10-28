import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/tmp/playwright/package/index.mjs');
const origin = process.env.METRICS_ORIGIN || 'http://platform-resource-monitor:8091';
const initialRows = [
  { ip: '192.0.2.10', alias: '<Oficina norte>', hostname: 'oficina.example', network: 'LAN / privada', landing_seen: true,
    connection_state: 'open', open_count: 1, connections: [{ remote_port: 54321, server_port: 443 }],
    navigation: [{ label: 'lechuza-server', entered: true, pages: [{ label: 'Caudalímetros' }] },
                 { label: 'kite-cat', entered: false, pages: [] }] },
  { ip: '2001:db8:1234:abcd:1234:5678:90ab:cdef', alias: '', hostname: null, network: 'Internet', landing_seen: true,
    connection_state: 'closed', open_count: 0, connections: [], navigation: [] },
  { ip: '192.0.2.30', alias: 'Equipo LAN sin landing', hostname: null, network: 'LAN / privada', landing_seen: false,
    connection_state: 'closed', open_count: 0, connections: [], navigation: [] },
  { ip: '203.0.113.20', alias: 'Equipo Internet sin landing', hostname: null, network: 'Internet', landing_seen: false,
    connection_state: 'open', open_count: 1, connections: [{ remote_port: 54322, server_port: 443 }], navigation: [] },
];
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [], events = [], saved = [];
try {
  for (const width of [320, 768, 1440]) {
    const rows = structuredClone(initialRows);
    const context = await browser.newContext({ viewport: { width, height: 960 } });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    let available = true;
    let requests = 0;
    await page.route('**/api/clients', route => {
      requests++;
      return route.fulfill({ json: { version: 1, clients: rows.map(row => ({ ...row,
      connection_state: available ? row.connection_state : 'unknown', open_count: available ? row.open_count : null,
      connections: available ? row.connections : [] })), connection_monitor: { available, error: available ? null : 'Observador de prueba no disponible' } } });
    });
    await page.route('**/api/clients/alias', async route => {
      const data = route.request().postDataJSON();
      assert.equal(route.request().headers()['x-clients-request'], '1');
      saved.push(data);
      rows.find(row => row.ip === data.ip).alias = data.alias.trim();
      await route.fulfill({ json: { saved: true } });
    });
    await page.route('**/portal/events', route => {
      events.push(route.request().postDataJSON());
      return route.fulfill({ status: 204 });
    });
    await page.goto(`${origin}/#clients`);
    await page.locator('.client-card').first().waitFor();
    assert.equal(await page.locator('[role=tablist]').getAttribute('aria-orientation'), 'vertical');
    assert.equal(await page.locator('#clients-tab').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#resources-panel').isVisible(), false);
    assert.ok((await page.locator('.client-status').first().getAttribute('aria-label')).includes('Con conexión abierta'));
    assert.equal(await page.locator('.client-address').first().textContent(), rows[0].ip);
    assert.equal(await page.locator('.client-alias').first().textContent(), rows[0].alias);
    assert.equal(await page.locator('.client-alias script, .client-alias oficina').count(), 0);
    const card = page.locator('[data-client-ip="192.0.2.10"]');
    const network = page.locator('[data-clients-network]');
    const landing = page.locator('[data-clients-landing]');
    const connection = page.locator('[data-clients-state]');
    const visibleIps = () => page.locator('.client-card:visible').evaluateAll(nodes => nodes.map(node => node.dataset.clientIp));
    const orderBeforeFiltering = await visibleIps();
    await card.evaluate(node => { window.filterClientCard = node; });
    const cases = [
      { network: 'LAN / privada', landing: '', state: '', ips: ['192.0.2.10', '192.0.2.30'] },
      { network: 'Internet', landing: '', state: '', ips: [initialRows[1].ip, '203.0.113.20'] },
      { network: '', landing: 'visited', state: '', ips: ['192.0.2.10', initialRows[1].ip] },
      { network: '', landing: 'not_visited', state: '', ips: ['192.0.2.30', '203.0.113.20'] },
      { network: 'LAN / privada', landing: 'not_visited', state: '', ips: ['192.0.2.30'] },
      { network: 'Internet', landing: 'visited', state: '', ips: [initialRows[1].ip] },
      { network: 'Internet', landing: 'not_visited', state: 'open', ips: ['203.0.113.20'] },
      { network: 'LAN / privada', landing: 'visited', state: 'closed', ips: [] },
    ];
    for (const test of cases) {
      await network.selectOption(test.network);
      await landing.selectOption(test.landing);
      await connection.selectOption(test.state);
      assert.deepEqual((await visibleIps()).sort(), [...test.ips].sort(), JSON.stringify(test));
      assert.equal(await page.locator('[data-clients-count]').textContent(), `${test.ips.length} de 4 clientes conocidos`);
      assert.equal(await page.locator('[data-clients-empty]').isVisible(), test.ips.length === 0);
    }
    await connection.selectOption('open');
    await page.locator('[data-clients-search]').fill('oficina');
    assert.deepEqual(await visibleIps(), ['192.0.2.10'], 'Buscar debe combinarse con origen, landing y conexión');
    await network.selectOption('Internet');
    assert.deepEqual(await visibleIps(), []);
    await page.locator('[data-clients-search]').fill('');
    await network.selectOption(''); await landing.selectOption(''); await connection.selectOption('');
    assert.deepEqual(await visibleIps(), orderBeforeFiltering, 'Los filtros no deben cambiar el orden');
    assert.ok(await card.evaluate(node => node === window.filterClientCard), 'Filtrar no debe reconstruir tarjetas');
    assert.equal(await card.locator('details, summary').count(), 0);
    assert.equal(await card.locator('.client-section').count(), 2);
    assert.ok(await card.locator('.client-tree').isVisible());
    assert.ok(await card.locator('.client-connections').isVisible());
    assert.equal(await card.locator('.client-heading').evaluate(node => node.getBoundingClientRect().height), 32);
    assert.ok((await card.innerText()).includes('Caudalímetros'));
    assert.ok((await card.innerText()).includes('Intentó, sin ingreso confirmado'));
    const initialOrder = await page.locator('.client-card').evaluateAll(nodes => nodes.map(node => node.dataset.clientIp));
    await card.evaluate(node => { window.originalClientCard = node; window.originalClientTitle = node.querySelector('.client-section-title'); });
    rows[0].connection_state = 'closed'; rows[0].open_count = 0; rows[0].connections = []; rows[0].alias = 'Zeta';
    rows[1].connection_state = 'open'; rows[1].open_count = 1;
    rows[1].connections = [{ remote_port: 12345, server_port: 443 }]; rows[1].alias = 'Alfa';
    rows[1].hostname = 'un-nombre-de-equipo-largo.que-no-debe-mover-las-tarjetas.example';
    rows.reverse();
    rows.push({ ...structuredClone(initialRows[1]), ip: '192.0.2.1' });
    await page.locator('[data-clients-refresh]').click();
    await page.locator('[data-client-ip="192.0.2.1"]').waitFor();
    assert.deepEqual(await page.locator('.client-card').evaluateAll(nodes => nodes.map(node => node.dataset.clientIp)), [...initialOrder, '192.0.2.1']);
    assert.ok(await card.evaluate(node => node === window.originalClientCard && node.querySelector('.client-section-title') === window.originalClientTitle));
    assert.equal(await card.locator('details, summary').count(), 0);
    assert.ok(await card.locator('.client-tree').isVisible());
    assert.ok(await card.locator('.client-connections').isVisible());
    const heightBeforeEditing = (await card.boundingBox()).height;
    await network.selectOption('LAN / privada');
    await landing.selectOption('visited');
    await card.locator('.client-edit').click();
    await card.locator('input').fill(`Puesto ${width}`);
    const editor = await card.locator('form').boundingBox();
    const address = await card.locator('.client-address').boundingBox();
    const input = await card.locator('input').boundingBox();
    const save = await card.getByRole('button', { name: 'Guardar alias', exact: true }).boundingBox();
    const cancel = await card.getByRole('button', { name: 'Cancelar edición', exact: true }).boundingBox();
    const status = await card.locator('.client-status').boundingBox();
    assert.ok(editor.x >= address.x + address.width, 'El editor debe quedar a la derecha de la IP');
    for (const control of [editor, input, save, cancel, status])
      assert.ok(Math.abs((control.y + control.height / 2) - (address.y + address.height / 2)) <= 1, 'IP, input, botones y testigo deben compartir una sola fila');
    assert.ok(save.x >= input.x + input.width && cancel.x >= save.x + save.width && status.x >= cancel.x + cancel.width,
      'Guardar y Cancelar deben quedar a la derecha del editext, seguidos por el testigo');
    assert.equal((await card.boundingBox()).height, heightBeforeEditing, 'Editar no debe cambiar el alto de la tarjeta');
    assert.equal(editor.height, 32, 'El formulario debe permanecer en una sola fila');
    if (process.env.CLIENTS_SCREENSHOT_DIR)
      await page.screenshot({ path: `${process.env.CLIENTS_SCREENSHOT_DIR}/clients-alias-${width}.png`, fullPage: true });
    if (width === 768) {
      const previous = requests;
      await page.waitForTimeout(5200);
      assert.ok(requests > previous, 'Debe ejecutarse la actualización automática');
      assert.ok(await card.locator('input').evaluate(node => node === document.activeElement), 'El polling debe conservar el foco');
    } else {
      await page.locator('[data-clients-refresh]').click();
      await page.waitForTimeout(150);
    }
    assert.equal(await card.locator('input').inputValue(), `Puesto ${width}`);
    assert.equal(await network.inputValue(), 'LAN / privada', 'El refresco debe conservar el filtro de origen');
    assert.equal(await landing.inputValue(), 'visited', 'El refresco debe conservar el filtro de landing');
    assert.deepEqual(await visibleIps(), ['192.0.2.10']);
    await card.getByRole('button', { name: 'Guardar alias', exact: true }).click();
    await card.locator('form').waitFor({ state: 'detached' });
    assert.equal(await card.locator('.client-alias').textContent(), `Puesto ${width}`);
    await network.selectOption(''); await landing.selectOption('');
    assert.equal(await card.locator('h3').textContent(), '192.0.2.10');
    assert.deepEqual(await page.locator('.client-card').evaluateAll(nodes => nodes.map(node => node.dataset.clientIp)), [...initialOrder, '192.0.2.1']);
    await card.locator('.client-edit').click();
    await card.locator('input').fill('No guardar');
    await card.getByRole('button', { name: 'Cancelar edición', exact: true }).click();
    assert.equal(await card.locator('.client-alias').textContent(), `Puesto ${width}`);
    if (width === 768) {
      for (let index = 20; index < 26; index++)
        rows.push({ ...structuredClone(initialRows[1]), ip: `192.0.2.${index}` });
      await page.locator('[data-clients-refresh]').click();
      await page.locator('[data-client-ip="192.0.2.25"]').waitFor();
      const reading = page.locator(`[data-client-ip="${initialRows[1].ip}"] .client-address`);
      await reading.evaluate(node => window.scrollBy(0, node.getBoundingClientRect().top - document.querySelector('.app-header').getBoundingClientRect().bottom - 16));
      assert.ok(await page.evaluate(() => window.scrollY > 0));
      const before = (await reading.boundingBox()).y;
      rows.find(row => row.ip === '192.0.2.10').navigation[0].pages.push({ id: 'new-screen', label: 'Nueva pantalla registrada' });
      await page.evaluate(() => document.querySelector('[data-clients-refresh]').click());
      await page.getByText('✓ Nueva pantalla registrada', { exact: true }).waitFor({ state: 'attached' });
      assert.ok(Math.abs((await reading.boundingBox()).y - before) <= 1, 'La navegación nueva debe conservar el punto de lectura');
    }
    await page.locator('#clients-tab').focus();
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.locator('#resources-tab').getAttribute('aria-selected'), 'true');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Recursos desborda a ${width}px`);
    await page.keyboard.press('ArrowDown');
    await page.locator('#clients-panel').waitFor({ state: 'visible' });
    available = false;
    await page.locator('[data-clients-refresh]').click();
    await page.waitForFunction(() => [...document.querySelectorAll('.client-status')].every(node => node.dataset.state === 'unknown'));
    await network.selectOption('Internet');
    await landing.selectOption('not_visited');
    await connection.selectOption('unknown');
    assert.deepEqual(await visibleIps(), ['203.0.113.20'], 'Origen y landing deben funcionar sin medición TCP disponible');
    await network.selectOption(''); await landing.selectOption(''); await connection.selectOption('');
    const geometry = await page.evaluate(() => {
      const panel = document.querySelector('#clients-panel').getBoundingClientRect();
      const rail = document.querySelector('[role=tablist]').getBoundingClientRect();
      const card = document.querySelector('.client-card').getBoundingClientRect();
      return { width: innerWidth, scroll: document.documentElement.scrollWidth, panel: panel.toJSON(), rail: rail.toJSON(),
        padding: parseFloat(getComputedStyle(document.querySelector('.client-card')).paddingLeft), card: card.toJSON() };
    });
    assert.ok(geometry.scroll <= width + 1, JSON.stringify({ width, scroll: geometry.scroll }));
    assert.ok(geometry.rail.right < geometry.panel.left);
    assert.ok(geometry.padding >= 12);
    await context.close();
    console.log(`Clientes ${width}px: filtros de origen/landing combinados con conexión y búsqueda, persistencia en refresco, orden, edición y geometría OK`);
  }
  assert.equal(saved.length, 3);
  assert.ok(events.some(event => event.screen === 'clients'));
  assert.ok(events.some(event => event.screen === 'resources'));
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
