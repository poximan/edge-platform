const modbusPercent = value => `${Number(value || 0).toFixed(1)}%`;
const modbusEscapeHtml = value => String(value).replace(
  /[&<>"']/g,
  character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character],
);

function describeModbusRequest(item) {
  if (!item) return "Sin consulta en curso";
  return `${item.source} · ID ${item.unit_id} · FC${item.function_code} · ${item.address} · ${item.count} registros`;
}

function renderModbus(data) {
  const sampledAt = new Date(data.sampled_at).toLocaleString(
    "es-AR",
    { timeZone: "Etc/GMT+3", hour12: false },
  );
  document.querySelector("#modbus-sampled-at").textContent = `${sampledAt} UTC−3`;
  document.querySelector("#modbus-channels").innerHTML = data.channels.map(channel => `
    <article class="card">
      <div class="modbus-card-header">
        <h3>${modbusEscapeHtml(channel.endpoint)}</h3>
        <span class="status-badge ${channel.current ? "active" : ""}">
          ${channel.current ? "En curso" : "En espera"}
        </span>
      </div>
      <p>Ocupación: ${modbusPercent(channel.busy_percent)} · En cola: ${channel.queue_depth} · Completadas: ${channel.completed} · Fallidas: ${channel.failed} · Intentos: ${channel.attempts}</p>
      <p>Duración media: ${channel.average_duration_ms === null ? "Sin muestras" : `${channel.average_duration_ms} ms`}</p>
      <p><strong>Consulta:</strong> ${modbusEscapeHtml(describeModbusRequest(channel.current))}</p>
      ${channel.current ? `<p>Intento ${channel.current.attempt} · ${channel.current.elapsed_ms} ms transcurridos</p>` : ""}
      <p><strong>Próximas consultas:</strong></p>
      ${channel.next.length
        ? `<ol>${channel.next.map(item => `<li>${modbusEscapeHtml(describeModbusRequest(item))}</li>`).join("")}</ol>`
        : "<p>Sin consultas en cola.</p>"}
    </article>`).join("");
}

async function loadModbus() {
  try {
    const response = await fetch("api/modbus", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    renderModbus(data);
    document.querySelector("#modbus-error").textContent = "";
  } catch (error) {
    document.querySelector("#modbus-channels").replaceChildren();
    document.querySelector("#modbus-sampled-at").textContent = "";
    document.querySelector("#modbus-error").textContent = error.message;
  } finally {
    setTimeout(loadModbus, 3000);
  }
}
loadModbus();
