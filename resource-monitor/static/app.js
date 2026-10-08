import { ResourceTrendChart } from "./trend-chart.js";

const state = {
  snapshot: null,
  history: null,
  historyByHours: new Map(),
  appliedHours: null,
  historyController: null,
  historyRequestId: 0,
  historyPending: false,
  snapshotController: null,
  snapshotPending: false,
  sort: { key: "memory_bytes", direction: "desc" },
};

const bytes = value => {
  if (!Number.isFinite(value)) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let current = value;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current.toFixed(index < 2 ? 0 : 1)} ${units[index]}`;
};

const percent = value => `${Number(value || 0).toFixed(1)}%`;
const escapeHtml = value => String(value).replace(
  /[&<>"']/g,
  character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character],
);

function card(label, value, detail = "") {
  return `
    <article class="card">
      <span class="label">${label}</span>
      <strong class="value">${value}</strong>
      <span class="detail">${detail}</span>
    </article>`;
}

function renderSnapshot() {
  const data = state.snapshot;
  const host = data.host;
  const items = data.containers;
  const memory = items.reduce((sum, item) => sum + item.memory_bytes, 0);
  const cpu = items.reduce((sum, item) => sum + item.cpu_percent, 0);
  const diskPercent = host.disk_total_bytes
    ? host.disk_used_bytes / host.disk_total_bytes * 100
    : 0;
  const hostMemoryPercent = host.memory_total_bytes
    ? host.memory_used_bytes / host.memory_total_bytes * 100
    : 0;
  document.querySelector("#host").innerHTML = [
    card("CPU de contenedores", percent(cpu), `${items.length} contenedores activos`),
    card(
      "Memoria del host",
      percent(hostMemoryPercent),
      `${bytes(host.memory_used_bytes)} de ${bytes(host.memory_total_bytes)} · contenedores ${bytes(memory)}`,
    ),
    card("Swap", bytes(host.swap_used_bytes), `de ${bytes(host.swap_total_bytes)}`),
    card(
      "Disco raíz",
      percent(diskPercent),
      `${bytes(host.disk_used_bytes)} de ${bytes(host.disk_total_bytes)}`,
    ),
    card(
      "Caché de builds",
      bytes(host.build_cache_bytes),
      `imágenes ${bytes(host.image_bytes)}`,
    ),
  ].join("");
  const localTime = new Date(data.sampled_at * 1000).toLocaleString(
    "es-AR",
    { timeZone: "Etc/GMT+3", hour12: false },
  );
  document.querySelector("#sampledAt").textContent = `Muestra: ${localTime} UTC−3`;
  renderTable();
}

function renderTable() {
  const value = document.querySelector("#filter").value.trim().toLowerCase();
  const rows = state.snapshot.containers
    .filter(item => !value
      || item.name.toLowerCase().includes(value)
      || item.product.includes(value))
    .map(item => ({
      ...item,
      block_total_bytes: item.block_read_bytes + item.block_write_bytes,
      network_total_bytes: item.network_rx_bytes + item.network_tx_bytes,
    }))
    .sort((left, right) => {
      const leftValue = left[state.sort.key];
      const rightValue = right[state.sort.key];
      const comparison = typeof leftValue === "string"
        ? leftValue.localeCompare(rightValue, "es")
        : Number(leftValue) - Number(rightValue);
      return comparison * (state.sort.direction === "asc" ? 1 : -1);
    });
  document.querySelector("#containers").innerHTML = rows.map(item => `
    <tr>
      <td><span class="product">${escapeHtml(item.product)}</span></td>
      <td>${escapeHtml(item.name)}</td>
      <td>${percent(item.cpu_percent)}</td>
      <td>${bytes(item.memory_bytes)}</td>
      <td>${bytes(item.writable_bytes)}</td>
      <td>${bytes(item.block_read_bytes)} / ${bytes(item.block_write_bytes)}</td>
      <td>${bytes(item.network_rx_bytes)} / ${bytes(item.network_tx_bytes)}</td>
    </tr>`).join("");
  for (const button of document.querySelectorAll("[data-sort]")) {
    const selected = button.dataset.sort === state.sort.key;
    button.closest("th").setAttribute(
      "aria-sort",
      selected ? (state.sort.direction === "asc" ? "ascending" : "descending") : "none",
    );
    button.dataset.direction = selected ? state.sort.direction : "";
  }
}

const charts = [
  new ResourceTrendChart(document.querySelector('[data-trend-chart="cpu"]'), "cpu_percent", value => `${value.toFixed(1)}%`),
  new ResourceTrendChart(document.querySelector('[data-trend-chart="memory"]'), "memory_bytes", bytes),
];

function renderCharts(resetView = false) {
  for (const chart of charts) chart.setRows(state.history.products, resetView);
}

const periodSelect = document.querySelector("#window");
const historyStatus = document.querySelector("#history-status");

function periodName(hours) {
  return periodSelect.querySelector(`option[value="${hours}"]`)?.textContent || `${hours} horas`;
}

function showHistory(history, hours) {
  const changedWindow = state.appliedHours !== hours;
  state.history = history;
  state.appliedHours = hours;
  renderCharts(changedWindow);
}

function setHistoryStatus(message, status) {
  if (historyStatus.textContent !== message) historyStatus.textContent = message;
  historyStatus.dataset.status = status;
}

async function loadSnapshot(automatic = false) {
  if (automatic && state.snapshotPending) return;
  state.snapshotController?.abort();
  const controller = new AbortController();
  state.snapshotController = controller;
  state.snapshotPending = true;
  try {
    const response = await fetch("api/snapshot", {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`No se pudo leer la muestra actual (HTTP ${response.status})`);
    const snapshot = await response.json();
    if (!snapshot || !snapshot.host || !Array.isArray(snapshot.containers))
      throw new Error("La muestra actual tiene un formato inválido");
    if (controller.signal.aborted) return;
    state.snapshot = snapshot;
    renderSnapshot();
    document.querySelector("#error").textContent = "";
  } catch (error) {
    if (!controller.signal.aborted) document.querySelector("#error").textContent = error.message;
  } finally {
    if (state.snapshotController === controller) {
      state.snapshotController = null;
      state.snapshotPending = false;
    }
  }
}

async function loadHistory(automatic = false) {
  if (automatic && state.historyPending) return;
  const hours = periodSelect.value;
  state.historyController?.abort();
  const controller = new AbortController();
  const requestId = ++state.historyRequestId;
  state.historyController = controller;
  state.historyPending = true;
  if (!automatic) periodSelect.setAttribute("aria-busy", "true");

  try {
    // Start the request before redrawing cached charts, without waiting for polling.
    const pendingResponse = fetch(`api/history?hours=${hours}&include_host=0`, {
      cache: "no-store",
      signal: controller.signal,
    });
    const cached = state.historyByHours.get(hours);
    if (cached && state.appliedHours !== hours) showHistory(cached, hours);
    if (!automatic) {
      setHistoryStatus(
        cached
          ? `Mostrando ${periodName(hours)}. Actualizando datos…`
          : `Cargando ${periodName(hours)}…${state.appliedHours ? ` Siguen visibles ${periodName(state.appliedHours)}.` : ""}`,
        "loading",
      );
    }
    const response = await pendingResponse;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const history = await response.json();
    if (!history || Number(history.hours) !== Number(hours)
        || !Array.isArray(history.products) || !Array.isArray(history.host))
      throw new Error("El historial tiene un formato inválido");
    if (requestId !== state.historyRequestId) return;
    state.historyByHours.set(hours, history);
    showHistory(history, hours);
    setHistoryStatus(`Mostrando ${periodName(hours)} · ${history.products.length} puntos por producto.`, "ready");
  } catch (error) {
    if (controller.signal.aborted || requestId !== state.historyRequestId) return;
    const visible = state.appliedHours
      ? ` Se mantienen visibles ${periodName(state.appliedHours)}.`
      : "";
    setHistoryStatus(`No se pudo cargar ${periodName(hours)} (${error.message}).${visible}`, "error");
  } finally {
    if (requestId === state.historyRequestId) {
      state.historyController = null;
      state.historyPending = false;
      periodSelect.removeAttribute("aria-busy");
    }
  }
}

periodSelect.addEventListener("change", () => void loadHistory());
document.querySelector("#filter").addEventListener(
  "input",
  () => state.snapshot && renderTable(),
);
for (const button of document.querySelectorAll("[data-sort]")) {
  button.addEventListener("click", () => {
    const key = button.dataset.sort;
    state.sort = state.sort.key === key
      ? { key, direction: state.sort.direction === "asc" ? "desc" : "asc" }
      : { key, direction: ["product", "name"].includes(key) ? "asc" : "desc" };
    if (state.snapshot) renderTable();
  });
}
window.addEventListener("resize", () => charts.forEach(chart => chart.draw()));
window.addEventListener("storage", event => {
  if (event.key !== "servicoop-theme") return;
  const stored = localStorage.getItem("servicoop-theme");
  document.documentElement.dataset.scTheme = stored === "light" ? "light" : "dark";
  if (state.history) renderCharts();
});
void loadHistory();
void loadSnapshot();
setInterval(() => {
  void loadSnapshot(true);
  void loadHistory(true);
}, 30_000);
