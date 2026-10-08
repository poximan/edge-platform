const COLORS = {
  "lechuza-server": "--sc-color-primary",
  chatcheto: "--sc-color-info",
  "moto-tester": "--sc-color-warning",
  platform: "--sc-color-danger",
  otros: "--sc-color-text-muted",
};

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function localTime(seconds) {
  return new Date(seconds * 1000).toLocaleString("es-AR", {
    timeZone: "Etc/GMT+3",
    hour12: false,
  });
}

export class ResourceTrendChart {
  constructor(root, field, formatter) {
    this.root = root;
    this.canvas = root.querySelector("canvas");
    this.tooltip = root.querySelector(".chart-tooltip");
    this.legend = root.querySelector(".chart-legend");
    this.field = field;
    this.formatter = formatter;
    this.rows = [];
    this.groups = new Map();
    this.fullRange = [0, 1];
    this.viewRange = [0, 1];
    this.mode = "zoom";
    this.pointer = null;
    this.hoverTime = null;
    this.pinned = false;
    this.bind();
  }

  bind() {
    for (const button of this.root.querySelectorAll("[data-chart-mode]")) {
      button.addEventListener("click", () => this.setMode(button.dataset.chartMode));
    }
    this.root.querySelector("[data-chart-reset]").addEventListener("click", () => this.reset());
    this.canvas.addEventListener("pointerdown", event => this.pointerDown(event));
    this.canvas.addEventListener("pointermove", event => this.pointerMove(event));
    this.canvas.addEventListener("pointerup", event => this.pointerUp(event));
    this.canvas.addEventListener("pointercancel", () => this.cancelPointer());
    this.canvas.addEventListener("pointerleave", () => {
      if (!this.pinned && this.pointer === null) this.clearHover();
    });
    this.canvas.addEventListener("wheel", event => this.wheel(event), { passive: false });
    this.canvas.addEventListener("dblclick", () => this.reset());
    this.canvas.addEventListener("keydown", event => {
      if (event.key === "Escape") this.clearHover();
      if (event.key === "0") this.reset();
    });
    this.setMode("zoom");
  }

  setRows(rows, resetView = false) {
    const wasFull = resetView || this.isFullView();
    this.rows = rows
      .filter(row => Number.isFinite(Number(row.sampled_at)) && Number.isFinite(Number(row[this.field])))
      .map(row => ({ ...row, sampled_at: Number(row.sampled_at), [this.field]: Number(row[this.field]) }))
      .sort((left, right) => left.sampled_at - right.sampled_at);
    this.groups = this.rows.reduce((groups, row) => {
      if (!groups.has(row.product)) groups.set(row.product, []);
      groups.get(row.product).push(row);
      return groups;
    }, new Map());
    this.legend.replaceChildren(...[...this.groups.keys()].map(product => {
      const item = document.createElement("span");
      const marker = document.createElement("i");
      marker.style.background = css(COLORS[product] || COLORS.otros);
      item.append(marker, document.createTextNode(product));
      return item;
    }));
    if (this.rows.length) {
      const first = this.rows[0].sampled_at;
      const last = this.rows.at(-1).sampled_at;
      this.fullRange = [first, Math.max(first + 1, last)];
      if (wasFull || this.viewRange[1] <= this.fullRange[0]) this.viewRange = [...this.fullRange];
      else this.viewRange = this.clampRange(this.viewRange);
    } else {
      this.fullRange = [0, 1];
      this.viewRange = [0, 1];
    }
    this.draw();
  }

  setMode(mode) {
    if (!['zoom', 'pan'].includes(mode)) return;
    this.mode = mode;
    this.canvas.dataset.mode = mode;
    for (const button of this.root.querySelectorAll("[data-chart-mode]")) {
      button.setAttribute("aria-pressed", String(button.dataset.chartMode === mode));
    }
  }

  isFullView() {
    const epsilon = Math.max(1, (this.fullRange[1] - this.fullRange[0]) * 0.001);
    return Math.abs(this.viewRange[0] - this.fullRange[0]) <= epsilon
      && Math.abs(this.viewRange[1] - this.fullRange[1]) <= epsilon;
  }

  reset() {
    this.viewRange = [...this.fullRange];
    this.pinned = false;
    this.hoverTime = null;
    this.tooltip.hidden = true;
    this.draw();
    const button = this.root.querySelector("[data-chart-reset]");
    button.textContent = "Restablecido";
    button.dataset.confirmed = "true";
    clearTimeout(this.resetFeedbackTimer);
    this.resetFeedbackTimer = setTimeout(() => {
      button.textContent = "Restablecer";
      delete button.dataset.confirmed;
    }, 1200);
  }

  geometry() {
    return {
      left: 58,
      right: Math.max(59, this.canvas.clientWidth - 16),
      top: 16,
      bottom: Math.max(17, this.canvas.clientHeight - 38),
    };
  }

  eventPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  timeAt(x) {
    const area = this.geometry();
    const ratio = Math.max(0, Math.min(1, (x - area.left) / Math.max(1, area.right - area.left)));
    return this.viewRange[0] + ratio * (this.viewRange[1] - this.viewRange[0]);
  }

  xAt(timestamp) {
    const area = this.geometry();
    return area.left + (timestamp - this.viewRange[0]) / Math.max(1, this.viewRange[1] - this.viewRange[0]) * (area.right - area.left);
  }

  pointerDown(event) {
    if (event.button !== 0) return;
    const point = this.eventPoint(event);
    this.pointer = { startX: point.x, lastX: point.x, moved: false, initialRange: [...this.viewRange] };
    this.canvas.setPointerCapture(event.pointerId);
  }

  pointerMove(event) {
    const point = this.eventPoint(event);
    if (this.pointer) {
      this.pointer.moved ||= Math.abs(point.x - this.pointer.startX) > 5;
      this.pointer.lastX = point.x;
      if (this.mode === "pan" && this.pointer.moved) {
        const area = this.geometry();
        const span = this.pointer.initialRange[1] - this.pointer.initialRange[0];
        const delta = (point.x - this.pointer.startX) / Math.max(1, area.right - area.left) * span;
        this.viewRange = this.clampRange([
          this.pointer.initialRange[0] - delta,
          this.pointer.initialRange[1] - delta,
        ]);
      }
      this.draw();
      return;
    }
    if (!this.pinned) this.showNearest(point.x, point.y);
  }

  pointerUp(event) {
    if (!this.pointer) return;
    const point = this.eventPoint(event);
    const gesture = this.pointer;
    this.pointer = null;
    if (gesture.moved && this.mode === "zoom") {
      const start = this.timeAt(gesture.startX);
      const end = this.timeAt(point.x);
      if (Math.abs(end - start) >= 1) this.viewRange = this.clampRange([Math.min(start, end), Math.max(start, end)]);
      this.pinned = false;
    } else if (!gesture.moved) {
      this.pinned = !this.pinned;
      if (this.pinned) this.showNearest(point.x, point.y);
      else this.clearHover();
    }
    this.draw();
  }

  cancelPointer() {
    this.pointer = null;
    this.draw();
  }

  wheel(event) {
    if (!this.rows.length) return;
    event.preventDefault();
    const center = this.timeAt(this.eventPoint(event).x);
    const span = this.viewRange[1] - this.viewRange[0];
    const factor = event.deltaY < 0 ? 0.75 : 1.35;
    const nextSpan = Math.max(60, Math.min(this.fullRange[1] - this.fullRange[0], span * factor));
    const position = (center - this.viewRange[0]) / Math.max(1, span);
    this.viewRange = this.clampRange([
      center - nextSpan * position,
      center + nextSpan * (1 - position),
    ]);
    this.pinned = false;
    this.clearHover();
    this.draw();
  }

  clampRange(range) {
    const fullSpan = this.fullRange[1] - this.fullRange[0];
    let span = Math.min(fullSpan, Math.max(1, range[1] - range[0]));
    let start = range[0];
    if (start < this.fullRange[0]) start = this.fullRange[0];
    if (start + span > this.fullRange[1]) start = this.fullRange[1] - span;
    return [start, start + span];
  }

  nearestRows(timestamp) {
    const result = [];
    for (const [product, points] of this.groups) {
      let nearest = null;
      for (const point of points) {
        if (point.sampled_at < this.viewRange[0] || point.sampled_at > this.viewRange[1]) continue;
        if (nearest === null || Math.abs(point.sampled_at - timestamp) < Math.abs(nearest.sampled_at - timestamp)) nearest = point;
      }
      if (nearest) result.push({ product, point: nearest });
    }
    return result;
  }

  showNearest(x, y) {
    const rows = this.nearestRows(this.timeAt(x));
    if (!rows.length) return this.clearHover();
    this.hoverTime = rows.reduce((nearest, row) =>
      Math.abs(row.point.sampled_at - this.timeAt(x)) < Math.abs(nearest - this.timeAt(x))
        ? row.point.sampled_at
        : nearest,
    rows[0].point.sampled_at);
    this.tooltip.innerHTML = `<strong>${localTime(this.hoverTime)} UTC−3</strong>${rows.map(({ product, point }) =>
      `<span><i style="background:${css(COLORS[product] || COLORS.otros)}"></i>${product}: <b>${this.formatter(point[this.field])}</b></span>`
    ).join("")}`;
    this.tooltip.hidden = false;
    const left = Math.min(Math.max(8, x + 14), Math.max(8, this.canvas.clientWidth - this.tooltip.offsetWidth - 8));
    const top = Math.min(Math.max(8, y + 12), Math.max(8, this.canvas.clientHeight - this.tooltip.offsetHeight - 8));
    this.tooltip.style.transform = `translate(${left}px, ${top}px)`;
    this.draw();
  }

  clearHover() {
    this.pinned = false;
    this.hoverTime = null;
    this.tooltip.hidden = true;
    this.draw();
  }

  draw() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (!width || !height) return;
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    const context = this.canvas.getContext("2d");
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);
    context.font = `11px ${css("--sc-font-sans")}`;
    context.fillStyle = css("--sc-color-text-muted");
    if (!this.rows.length) {
      context.fillText("Esperando muestras históricas", 16, 28);
      return;
    }
    const area = this.geometry();
    const visible = this.rows.filter(row => row.sampled_at >= this.viewRange[0] && row.sampled_at <= this.viewRange[1]);
    const maximum = Math.max(...visible.map(row => row[this.field]), 1);
    context.strokeStyle = css("--sc-color-border");
    context.lineWidth = 1;
    for (let step = 0; step <= 4; step += 1) {
      const y = area.top + (area.bottom - area.top) * step / 4;
      context.beginPath();
      context.moveTo(area.left, y);
      context.lineTo(area.right, y);
      context.stroke();
      context.fillStyle = css("--sc-color-text-muted");
      context.fillText(this.formatter(maximum * (4 - step) / 4), 4, y + 4);
    }
    for (let step = 0; step <= 4; step += 1) {
      const timestamp = this.viewRange[0] + (this.viewRange[1] - this.viewRange[0]) * step / 4;
      const label = new Date(timestamp * 1000).toLocaleString("es-AR", {
        timeZone: "Etc/GMT+3",
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit",
        hour12: false,
      });
      const x = area.left + (area.right - area.left) * step / 4;
      context.textAlign = step === 0 ? "left" : step === 4 ? "right" : "center";
      context.fillText(label, x, height - 8);
    }
    context.textAlign = "left";
    for (const [product, points] of this.groups) {
      const visiblePoints = points.filter(point => point.sampled_at >= this.viewRange[0] && point.sampled_at <= this.viewRange[1]);
      if (!visiblePoints.length) continue;
      context.strokeStyle = css(COLORS[product] || COLORS.otros);
      context.lineWidth = 2;
      context.beginPath();
      visiblePoints.forEach((point, index) => {
        const x = this.xAt(point.sampled_at);
        const y = area.bottom - point[this.field] / maximum * (area.bottom - area.top);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
    }
    if (this.hoverTime !== null) {
      const x = this.xAt(this.hoverTime);
      context.strokeStyle = css("--sc-color-text");
      context.setLineDash([4, 4]);
      context.beginPath();
      context.moveTo(x, area.top);
      context.lineTo(x, area.bottom);
      context.stroke();
      context.setLineDash([]);
    }
    if (this.pointer?.moved && this.mode === "zoom") {
      const start = Math.max(area.left, Math.min(area.right, this.pointer.startX));
      const end = Math.max(area.left, Math.min(area.right, this.pointer.lastX));
      context.save();
      context.globalAlpha = 0.2;
      context.fillStyle = css("--sc-color-primary");
      context.fillRect(Math.min(start, end), area.top, Math.abs(end - start), area.bottom - area.top);
      context.restore();
    }
  }
}
