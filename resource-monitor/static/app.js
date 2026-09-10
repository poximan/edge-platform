import { ResourceTrendChart } from "./trend-chart.js";

const state = {
  snapshot: null,
  history: null,
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

function renderCharts() {
  for (const chart of charts) chart.setRows(state.history.products);
}

async function load() {
  document.querySelector("#error").textContent = "";
  try {
    const hours = document.querySelector("#window").value;
    const [snapshotResponse, historyResponse] = await Promise.all([
      fetch("api/snapshot", { cache: "no-store" }),
      fetch(`api/history?hours=${hours}`, { cache: "no-store" }),
    ]);
    if (!snapshotResponse.ok || !historyResponse.ok)
      throw new Error("El monitor todavía no tiene datos disponibles");
    state.snapshot = await snapshotResponse.json();
    state.history = await historyResponse.json();
    renderSnapshot();
    renderCharts();
  } catch (error) {
    document.querySelector("#error").textContent = error.message;
  }
}

document.querySelector("#refresh").addEventListener("click", load);
document.querySelector("#window").addEventListener("change", load);
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
load();
setInterval(load, 30_000);
