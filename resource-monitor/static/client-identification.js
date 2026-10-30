const fields = [
  ['dns_name', 'Nombre DNS', 253], ['entity', 'Entidad o servicio', 240],
  ['asn', 'ASN', 12], ['reviewed_on', 'Fecha de revisión', 10],
  ['description', 'Descripción y límites de atribución', 4000],
  ['dns_verification', 'Verificación DNS', 2000], ['source_urls', 'Fuentes HTTP/HTTPS', 6000],
];

function node(tag, label, className) {
  const result = document.createElement(tag);
  if (label !== undefined) result.textContent = label;
  if (className) result.className = className;
  return result;
}

function text(target, value) {
  if (target.textContent !== value) target.textContent = value;
}

export function validIdentification(value, ip) {
  return !!value && typeof value === 'object' && typeof value.ip === 'string' && value.ip === ip
    && typeof value.revision === 'string' && /^[a-f0-9]{64}$/.test(value.revision)
    && fields.every(([name]) => typeof value[name] === 'string');
}

function sourceUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch { return null; }
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  } finally { clearTimeout(timeout); }
}

export class ClientIdentificationPanel {
  constructor(container, onSaved, label = 'Identificación', showDns = false) {
    this.container = container;
    this.onSaved = onSaved;
    this.current = null;
    const header = node('div', undefined, 'client-identification-header');
    header.append(node('h4', label, 'client-section-title'));
    this.edit = node('button', '✎', 'client-identification-edit');
    this.edit.type = 'button';
    this.edit.title = 'Editar identificación en el CSV';
    this.edit.addEventListener('click', () => this.openEditor());
    header.append(this.edit);
    this.display = node('div', undefined, 'client-identification-display');
    this.entity = node('strong');
    this.dns = node('p');
    this.showDns = showDns;
    this.description = node('p');
    this.verification = node('p', undefined, 'client-identification-verification');
    this.sources = node('div', undefined, 'client-identification-sources');
    this.display.append(this.entity, this.dns, this.description, this.verification, this.sources);
    container.append(header, this.display);
  }

  update(ip, identification) {
    this.ip = ip;
    this.current = identification;
    this.edit.setAttribute('aria-label', `Editar identificación de ${ip} en el CSV`);
    const value = identification;
    text(this.entity, value ? [value.entity || 'Entidad sin identificar', value.asn].filter(Boolean).join(' · ')
      : 'Sin identificación en el inventario');
    text(this.dns, value?.dns_name || 'Sin nombre DNS documentado');
    this.dns.hidden = !this.showDns;
    text(this.description, value?.description || '');
    this.description.hidden = !this.description.textContent;
    const reviewed = value?.reviewed_on ? `Revisado: ${value.reviewed_on}` : 'Sin fecha de revisión';
    text(this.verification, value ? [reviewed, value.dns_verification].filter(Boolean).join(' · ') : '');
    this.verification.hidden = !value;
    if (this.lastSources === (value?.source_urls || '')) return;
    this.lastSources = value?.source_urls || '';
    this.sources.replaceChildren();
    for (const [index, text] of (value?.source_urls || '').split(/\s+/).filter(Boolean).entries()) {
      const url = sourceUrl(text);
      if (!url) continue;
      const link = node('a', `Fuente ${index + 1}`);
      link.href = url.href;
      link.title = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      this.sources.append(link);
    }
  }

  openEditor() {
    if (this.form) return;
    const revision = this.current?.revision ?? null;
    const form = node('form', undefined, 'client-identification-form');
    const inputs = {};
    for (const [name, title, maximum] of fields) {
      const label = node('label', title);
      const input = node(['description', 'dns_verification', 'source_urls'].includes(name) ? 'textarea' : 'input');
      if (input.tagName === 'INPUT') input.type = name === 'reviewed_on' ? 'date' : 'text';
      else input.rows = name === 'description' ? 3 : 2;
      input.maxLength = maximum;
      input.value = this.current?.[name] || '';
      input.autocomplete = 'off';
      input.setAttribute('aria-label', `${title} de ${this.ip}`);
      label.append(input);
      if (input.tagName === 'TEXTAREA') label.className = 'client-identification-wide';
      form.append(label);
      inputs[name] = input;
    }
    const actions = node('div', undefined, 'client-identification-actions');
    const save = node('button', 'Guardar');
    save.type = 'submit';
    const cancel = node('button', 'Cancelar', 'client-cancel');
    cancel.type = 'button';
    const error = node('p', '', 'client-notice');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    const finish = () => {
      form.remove();
      this.form = null;
      this.display.hidden = false;
      this.edit.hidden = false;
      this.edit.focus({ preventScroll: true });
    };
    cancel.addEventListener('click', finish);
    form.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !cancel.disabled) {
        event.preventDefault(); event.stopPropagation(); finish();
      }
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      save.disabled = cancel.disabled = true;
      error.hidden = true;
      try {
        const details = Object.fromEntries(fields.map(([name]) => [name, inputs[name].value]));
        const result = await request('api/clients/identification', {
          method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Clients-Request': '1' },
          body: JSON.stringify({ ip: this.ip, details, revision }),
        });
        if (result.saved !== true || !validIdentification(result.identification, this.ip))
          throw new Error('Respuesta de identificación inválida');
        this.update(this.ip, result.identification);
        this.onSaved(this.ip, result.identification);
        finish();
      } catch (reason) {
        error.textContent = `No se pudo guardar: ${reason.message}`;
        error.hidden = false;
        save.disabled = cancel.disabled = false;
      }
    });
    actions.append(save, cancel);
    form.append(actions, error);
    this.form = form;
    this.display.hidden = true;
    this.edit.hidden = true;
    this.container.append(form);
    inputs.dns_name.focus({ preventScroll: true });
  }
}

export async function openClientInventory(onSaved) {
  const dialog = node('dialog', undefined, 'client-inventory-dialog');
  dialog.setAttribute('aria-labelledby', 'client-inventory-title');
  const header = node('header', undefined, 'client-inventory-header');
  const heading = node('h3', 'Inventario de identificación');
  heading.id = 'client-inventory-title';
  const close = node('button', 'Cerrar', 'client-cancel');
  close.type = 'button';
  close.addEventListener('click', () => dialog.close());
  header.append(heading, close);
  const note = node('p', 'Este catálogo CSV identifica IP; sus entradas no registran visitas ni conexiones.', 'client-inventory-note');
  const searchLabel = node('label', 'Buscar en el CSV');
  const search = node('input');
  search.type = 'search';
  search.placeholder = 'IP, DNS, entidad, ASN o descripción';
  searchLabel.append(search);
  const status = node('p', 'Cargando inventario…', 'client-inventory-note');
  status.setAttribute('role', 'status');
  const list = node('div', undefined, 'client-inventory-list');
  dialog.append(header, note, searchLabel, status, list);
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
  try {
    const data = await request('api/clients/identification');
    if (!dialog.isConnected) return;
    if (data.version !== 1 || !Array.isArray(data.items) || data.items.some(item => !validIdentification(item, item?.ip)))
      throw new Error('El inventario tiene un formato inválido');
    const entries = [];
    for (const item of [...data.items].sort((a, b) => a.ip.localeCompare(b.ip, 'es', { numeric: true }))) {
      const entry = node('article', undefined, 'client-inventory-entry');
      const panel = new ClientIdentificationPanel(entry, (ip, identification) => {
        entries.find(row => row.ip === ip).value = identification;
        onSaved(ip, identification);
      }, item.ip, true);
      panel.update(item.ip, item);
      entries.push({ ip: item.ip, value: item, node: entry });
      list.append(entry);
    }
    const filter = () => {
      const term = search.value.trim().toLocaleLowerCase('es');
      let visible = 0;
      for (const entry of entries) {
        entry.node.hidden = !!term && !Object.values(entry.value).join(' ').toLocaleLowerCase('es').includes(term);
        if (!entry.node.hidden) visible++;
      }
      status.textContent = `${visible} de ${entries.length} identificaciones del CSV`;
    };
    search.addEventListener('input', filter);
    filter();
  } catch (error) {
    if (dialog.isConnected) status.textContent = `No se pudo cargar el inventario: ${error.message}`;
  }
}
