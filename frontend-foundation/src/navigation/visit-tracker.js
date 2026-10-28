const reported = new Set();
let started = false;

async function report(type, path, screen) {
  const target = new URL(path, window.location.origin);
  if (target.origin !== window.location.origin) return;
  const event = { type, path: target.pathname, ...(screen ? { screen } : {}) };
  const key = JSON.stringify(event);
  if (reported.has(key)) return;
  reported.add(key);
  try {
    const response = await fetch("/portal/events", {
      method: "POST", credentials: "same-origin", keepalive: true,
      headers: { "Content-Type": "application/json", "X-Portal-Event": "1" },
      body: key,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    reported.delete(key);
    console.warn("No se pudo registrar la navegación del portal", error);
  }
}

export function recordScreen(path, screen) {
  void report("view", path, screen);
}

export function recordProductAttempt(path) {
  void report("attempt", path);
}

export function startVisitTracking() {
  if (started) return;
  started = true;
  const recordCurrent = () => {
    if (window.location.pathname !== "/") recordScreen(window.location.pathname);
  };
  window.addEventListener("popstate", () => requestAnimationFrame(recordCurrent));
  for (const method of ["pushState", "replaceState"]) {
    const original = window.history[method];
    window.history[method] = function (...args) {
      const result = original.apply(this, args);
      requestAnimationFrame(recordCurrent);
      return result;
    };
  }
  requestAnimationFrame(recordCurrent);
}
