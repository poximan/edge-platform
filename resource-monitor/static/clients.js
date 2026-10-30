import { ClientIdentificationPanel, openClientInventory, validIdentification } from './client-identification.js';

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function text(node, value) {
  if (node.textContent !== value) node.textContent = value;
}

function updateItems(list, items, key, create, update) {
  const previous = new Map([...list.children].map(node => [node.dataset.key, node]));
  for (const item of items) {
    const identifier = key(item);
    let node = previous.get(identifier);
    if (!node) {
      node = create(item);
      node.dataset.key = identifier;
      list.append(node);
    }
    update(node, item);
    previous.delete(identifier);
  }
  for (const node of previous.values()) node.remove();
}

export class ClientsView {
  constructor(root) {
    this.root = root;
    this.rows = [];
    this.cards = new Map();
    this.content = new WeakMap();
    this.active = false;
    this.pending = false;
    this.editing = null;
    this.timer = null;
    this.search = root.querySelector('[data-clients-search]');
    this.filter = root.querySelector('[data-clients-state]');
    this.network = root.querySelector('[data-clients-network]');
    this.landing = root.querySelector('[data-clients-landing]');
    this.list = root.querySelector('[data-clients-list]');
    this.notice = root.querySelector('[data-clients-notice]');
    this.search.addEventListener('input', () => this.render());
    this.filter.addEventListener('change', () => this.render());
    this.network.addEventListener('change', () => this.render());
    this.landing.addEventListener('change', () => this.render());
    root.querySelector('[data-clients-refresh]').addEventListener('click', () => void this.load());
    root.querySelector('[data-clients-inventory]').addEventListener('click', () => {
      void openClientInventory((ip, identification) => this.identificationSaved(ip, identification));
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.active) void this.load();
    });
  }

  activate() {
    this.active = true;
    void this.load();
    this.timer ??= setInterval(() => { if (!document.hidden) void this.load(); }, 5000);
  }

  deactivate() {
    this.active = false;
    clearInterval(this.timer);
    this.timer = null;
    this.controller?.abort();
  }

  async load() {
    if (!this.active || this.pending) return;
    this.pending = true;
    const controller = new AbortController();
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch('api/clients', { cache: 'no-store', signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      if (data.version !== 1 || !Array.isArray(data.clients) || typeof data.connection_monitor?.available !== 'boolean'
          || data.clients.some(client => typeof client.ip !== 'string' || typeof client.alias !== 'string'
            || (client.identification !== null && !validIdentification(client.identification, client.ip))
            || !['Internet', 'LAN / privada'].includes(client.network) || typeof client.landing_seen !== 'boolean'
            || !['open', 'closed', 'unknown'].includes(client.connection_state)
            || !Array.isArray(client.navigation) || !Array.isArray(client.connections)))
        throw new Error('El registro de clientes tiene un formato inválido');
      const anchor = this.readingAnchor();
      this.rows = data.clients;
      this.notice.textContent = data.connection_monitor.available ? '' :
        (data.connection_monitor.error || 'La medición de conexiones no está disponible');
      this.render();
      if (anchor?.node.isConnected && anchor.node.getClientRects().length)
        window.scrollBy(0, anchor.node.getBoundingClientRect().top - anchor.top);
    } catch (error) {
      if (this.active) {
        this.notice.textContent = `No se pudo actualizar Clientes (${error.message}). El estado anterior puede estar desactualizado.`;
        for (const card of this.cards.values()) this.status(card, 'unknown', null);
      }
    } finally {
      clearTimeout(timeout);
      this.pending = false;
    }
  }

  status(card, state, count) {
    const status = card.querySelector('[data-connection-status]');
    status.dataset.state = state;
    const label = state === 'open' ? `Con conexión abierta · ${count}` :
      state === 'closed' ? 'Sin conexiones abiertas' : 'Medición no disponible';
    text(status, state === 'open' ? `✓ ${count}` : state === 'closed' ? '○' : '—');
    status.title = label;
    status.setAttribute('aria-label', label);
  }

  readingAnchor() {
    if (!window.scrollY) return null;
    const top = document.querySelector('.app-header')?.getBoundingClientRect().bottom || 0;
    for (const node of this.list.querySelectorAll('.client-address, .client-secondary, .client-section-title, .client-tree span, .client-tree strong')) {
      const box = node.getBoundingClientRect();
      if (box.height && box.top >= top && box.top < window.innerHeight) return { node, top: box.top };
    }
    return null;
  }

  render() {
    const search = this.search.value.trim().toLocaleLowerCase('es');
    const rows = [...this.rows].sort((a, b) => a.ip.localeCompare(b.ip, 'es', { numeric: true }));
    const known = new Set(rows.map(row => row.ip));
    for (const [ip, card] of this.cards) if (!known.has(ip)) card.hidden = true;
    let visible = 0;
    for (const client of rows) {
      let card = this.cards.get(client.ip);
      if (!card) {
        card = element('article', undefined, 'client-card');
        card.dataset.clientIp = client.ip;
        this.cards.set(client.ip, card);
        this.list.append(card);
        this.renderClient(card, client);
      }
      const identity = client.identification;
      const editing = this.editing === client.ip || !!this.content.get(card)?.identification.form;
      card.hidden = !editing && !((!search || `${client.ip} ${client.alias} ${client.hostname || ''} ${identity?.dns_name || ''} ${identity?.entity || ''} ${identity?.asn || ''} ${identity?.description || ''}`.toLocaleLowerCase('es').includes(search))
        && (!this.filter.value || this.filter.value === client.connection_state)
        && (!this.network.value || this.network.value === client.network)
        && (!this.landing.value || client.landing_seen === (this.landing.value === 'visited')));
      if (!card.hidden) visible++;
      this.updateClient(card, client);
    }
    text(this.root.querySelector('[data-clients-count]'), `${visible} de ${this.rows.length} clientes conocidos`);
    this.root.querySelector('[data-clients-empty]').hidden = visible > 0;
  }

  section(label) {
    const section = element('section', undefined, 'client-section');
    section.append(element('h4', label, 'client-section-title'));
    return section;
  }

  renderClient(card, client) {
    const headingScroll = element('div', undefined, 'client-heading-scroll');
    headingScroll.tabIndex = 0;
    headingScroll.setAttribute('role', 'group');
    headingScroll.setAttribute('aria-label', `Identificación y conexión de ${client.ip}`);
    const header = element('header', undefined, 'client-heading');
    const address = element('h3', client.ip, 'client-address');
    const aliasArea = element('div', undefined, 'client-alias-area');
    const aliasDisplay = element('div', undefined, 'client-alias-display');
    const alias = element('span', '', 'client-alias');
    const secondary = element('span', '', 'client-secondary');
    const status = element('span', undefined, 'client-status');
    status.setAttribute('role', 'img');
    status.dataset.connectionStatus = '';
    const edit = element('button', '✎', 'client-edit');
    edit.type = 'button';
    edit.setAttribute('aria-label', `Cambiar alias de ${client.ip}`);
    edit.title = 'Cambiar alias';
    edit.addEventListener('click', () => this.edit(card, this.rows.find(row => row.ip === client.ip)));
    aliasDisplay.append(alias, edit);
    aliasArea.append(aliasDisplay);
    header.append(address, aliasArea, status);
    headingScroll.append(header);
    const error = element('p', '', 'client-notice client-alias-error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    card.append(headingScroll, secondary, error);
    const identity = element('section', undefined, 'client-identification');
    const identification = new ClientIdentificationPanel(identity,
      (ip, value) => this.identificationSaved(ip, value));
    card.append(identity);
    const details = element('div', undefined, 'client-details');
    const navigation = this.section('Navegación conocida');
    const tree = element('ul', undefined, 'client-tree');
    const landing = element('li');
    const landingStatus = element('strong');
    const products = element('ul');
    landing.append(landingStatus, products);
    tree.append(landing);
    navigation.append(tree);
    details.append(navigation);
    const current = this.section('Conexiones TCP');
    const connections = element('ul', undefined, 'client-connections');
    current.append(connections);
    details.append(current);
    card.append(details);
    this.content.set(card, { alias, aliasArea, aliasDisplay, secondary, landingStatus, products, connections, edit, error, identification });
  }

  identificationSaved(ip, identification) {
    const row = this.rows.find(client => client.ip === ip);
    if (row) row.identification = identification;
    this.render();
  }

  updateClient(card, client) {
    const view = this.content.get(card);
    text(view.alias, client.alias || '—');
    view.alias.title = client.alias || 'Sin alias';
    const identity = client.identification;
    const name = identity ? identity.dns_name || 'Sin nombre DNS documentado' : client.hostname || 'Sin nombre DNS';
    const origin = identity ? `CSV · ${identity.reviewed_on || 'sin fecha'}` : 'DNS automático';
    text(view.secondary, `${name} · ${client.network} · ${origin}`);
    view.secondary.title = view.secondary.textContent;
    view.edit.disabled = !!this.editing && this.editing !== client.ip;
    view.identification.update(client.ip, identity);
    this.status(card, client.connection_state, client.open_count);
    text(view.landingStatus, client.landing_seen ? '✓ Landing visitado' : '○ Sin visita al landing registrada');
    view.products.hidden = !client.navigation.length;
    updateItems(view.products, client.navigation, visit => visit.id || visit.label, () => {
      const product = element('li');
      product.append(element('span'), element('ul'));
      return product;
    }, (product, visit) => {
      text(product.firstElementChild, `${visit.label} · ${visit.entered ? '✓ Ingresó' : '○ Intentó, sin ingreso confirmado'}`);
      const pages = product.lastElementChild;
      pages.hidden = !visit.pages.length;
      updateItems(pages, visit.pages, page => page.id || page.label, () => element('li'),
        (node, page) => text(node, `✓ ${page.label}`));
    });
    const connections = client.connection_state === 'unknown' ? [] : client.connections;
    updateItems(view.connections, connections.length ? connections : [null],
      connection => connection ? `${connection.server_port}:${connection.remote_port}` : 'empty',
      () => element('li'), (node, connection) => text(node, connection ?
        `${connection.server_port === 443 ? 'HTTPS' : 'HTTP'} · puerto de origen ${connection.remote_port} → servidor ${connection.server_port}` :
        client.connection_state === 'unknown' ? 'Medición no disponible' : 'Sin conexiones abiertas'));
  }

  edit(card, client) {
    if (this.editing || !client) return;
    this.editing = client.ip;
    const view = this.content.get(card);
    const form = element('form', undefined, 'client-alias-form');
    const input = element('input');
    input.setAttribute('aria-label', `Alias de ${client.ip}`);
    input.value = client.alias;
    input.maxLength = 120;
    input.autocomplete = 'off';
    const save = element('button', '✓');
    save.type = 'submit';
    save.title = 'Guardar alias';
    save.setAttribute('aria-label', 'Guardar alias');
    const cancel = element('button', '×', 'client-cancel');
    cancel.type = 'button';
    cancel.title = 'Cancelar edición';
    cancel.setAttribute('aria-label', 'Cancelar edición');
    const error = view.error;
    error.hidden = true;
    text(error, '');
    const finish = () => {
      form.remove();
      error.hidden = true;
      view.aliasDisplay.hidden = false;
      this.editing = null;
      this.render();
      if (!card.hidden) view.edit.focus({ preventScroll: true });
    };
    cancel.addEventListener('click', finish);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      save.disabled = cancel.disabled = true;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);
      try {
        const response = await fetch('api/clients/alias', {
          method: 'PUT', credentials: 'same-origin', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', 'X-Clients-Request': '1' },
          body: JSON.stringify({ ip: client.ip, alias: input.value }),
        });
        const data = await response.json();
        if (!response.ok || data.saved !== true) throw new Error(data.error || `HTTP ${response.status}`);
        client.alias = input.value.trim();
        const row = this.rows.find(row => row.ip === client.ip);
        if (row) row.alias = client.alias;
        finish();
      } catch (reason) {
        error.textContent = `No se pudo guardar el alias: ${reason.message}`;
        error.hidden = false;
        save.disabled = cancel.disabled = false;
      } finally {
        clearTimeout(timeout);
      }
    });
    form.append(input, save, cancel);
    view.aliasDisplay.hidden = true;
    view.aliasArea.append(form);
    this.render();
    input.focus({ preventScroll: true });
    input.select();
    input.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}
