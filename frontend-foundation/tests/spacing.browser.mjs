import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright-core");

// Proxy privado de pruebas: permite lecturas, nunca acciones sobre los productos.
const routes = [
  ["/lechu/", "lechu:8052", false],
  ["/alarmero/", "lechu-alarmero-service:8094", true],
  ["/kite-cat/", "kite-cat-web:8080", false],
  ["/moto-tester/", "moto-tester-trasvase-tester:8080", true],
  ["/recursos/", "platform-resource-monitor:8091", true],
  ["/chatcheto/", "chatcheto-atendedor:5173", true],
  ["/chatcheto-api/", "chatcheto-chat-core:4000", true],
  ["/chatcheto-geo/", "chatcheto-geo-posicion:4500", true],
  ["/chatcheto-dashboard-api/", "chatcheto-dashboard-service:4200", true],
  ["/chatcheto-bkr-gis-api/", "chatcheto-broker-gis:4900", true],
  ["/chatcheto-bkr-movil-api/", "chatcheto-broker-movil:4950", true],
  ["/chatcheto-gis-api/", "chatcheto-adapter-gis:4700", true],
];
const chatest = process.env.CHATEST_PUBLIC_DIR;
const server = http.createServer((request, response) => {
  if (!["GET", "HEAD"].includes(request.method)) return response.writeHead(405).end();
  const path = new URL(request.url, "http://localhost").pathname;
  if (chatest && (path === "/chatest/" || (path === "/styles.css" && request.headers.referer?.includes("/chatest/")))) {
    const html = path === "/chatest/";
    let body = readFileSync(`${chatest}/${html ? "index.html" : "styles.css"}`, "utf8");
    // Solo distribucion del panel de carga; no ejecuta inyecciones de trafico.
    if (html) body = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
    return response.writeHead(200, { "content-type": html ? "text/html" : "text/css" }).end(body);
  }
  const [prefix, host, strip] = routes.find(([prefix]) => path.startsWith(prefix)) ??
    ["/", "platform-edge-gateway:8081", false];
  const target = new URL(strip ? request.url.slice(prefix.length - 1) : request.url, `http://${host}`);
  const upstream = http.request(target, {
    method: request.method,
    headers: { ...request.headers, host: target.host, "x-edge-mode": "protected", "x-edge-user": "spacing-check" },
  }, incoming => {
    response.writeHead(incoming.statusCode, incoming.headers);
    incoming.pipe(response);
  });
  upstream.on("error", error => {
    if (!response.headersSent) response.writeHead(502);
    response.end(String(error));
  });
  response.on("close", () => upstream.destroy());
  upstream.end();
});
await new Promise(resolve => server.listen(9090, "127.0.0.1", resolve));
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const products = [["landing", "/"], ["recursos", "/recursos/"], ["lechu", "/lechu/exemys"],
  ["alarmero", "/alarmero/"], ["kite-cat", "/kite-cat/"], ["moto-tester", "/moto-tester/"], ["chatcheto", "/chatcheto/"],
  ...(chatest ? [["chatest", "/chatest/"]] : [])]
  .filter(([name]) => !process.env.SPACING_PRODUCTS || process.env.SPACING_PRODUCTS.split(",").includes(name));
const results = [];
try {
  for (const width of (process.env.SPACING_WIDTHS ?? "320,768,1440").split(",").map(Number)) {
    for (const [product, path] of products) {
      const context = await browser.newContext({ viewport: { width, height: 960 } });
      await context.addInitScript(() => localStorage.setItem("servicoop-theme", "light"));
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:9090${path}`, { waitUntil: "domcontentloaded" });
      await page.locator(".sc-page").waitFor({ state: "visible", timeout: 30000 });
      if (["lechu", "alarmero", "kite-cat", "moto-tester"].includes(product))
        await page.locator("[data-sc-card]").first().waitFor({ state: "visible", timeout: 30000 });
      const result = await page.evaluate(() => {
        const style = getComputedStyle(document.querySelector(".sc-page"));
        return {
          width: document.documentElement.scrollWidth,
          inline: [parseFloat(style.paddingLeft), parseFloat(style.paddingRight)],
          block: [parseFloat(style.paddingTop), parseFloat(style.paddingBottom)],
          cards: [...document.querySelectorAll("[data-sc-card]")].map(card => ({
            mode: card.dataset.scPadding, inset: parseFloat(getComputedStyle(card).paddingLeft),
          })),
          offenders: [...document.querySelectorAll("body *")].filter(element =>
            element.getBoundingClientRect().right > innerWidth + 1 && !element.closest("table, svg")
          ).slice(0, 8).map(element => `${element.tagName}.${element.className}`),
          clippedControls: [...document.querySelectorAll("button, input, select, textarea, a")].filter(element => {
            const rect = element.getBoundingClientRect();
            if (!rect.width || getComputedStyle(element).visibility === "hidden" ||
                (rect.right <= innerWidth + 1 && rect.left >= -1)) return false;
            for (let parent = element.parentElement; parent; parent = parent.parentElement)
              if (["auto", "scroll"].includes(getComputedStyle(parent).overflowX)) return false;
            return true;
          }).map(element => `${element.tagName}.${element.className}`),
        };
      });
      console.log(JSON.stringify({ product, viewport: width, ...result }));
      assert(result.inline.every(value => value >= 16 && value <= 32.1), `${product}: margen lateral`);
      assert(result.block.every(value => value >= 20 && value <= 40.1), `${product}: margen vertical`);
      assert(result.width <= width + 1, `${product}: desborde horizontal`);
      assert.deepEqual(result.clippedControls, [], `${product}: controles recortados`);
      for (const card of result.cards) {
        const minimum = card.mode === "none" ? 0 : card.mode === "compact" ? 8 : 12;
        assert(card.inset >= minimum && card.inset <= 12.1, `${product}: relleno de tarjeta`);
        if (card.mode === "none") assert.equal(card.inset, 0);
      }
      results.push({ product, width });
      await context.close();
    }
  }
  console.log(JSON.stringify({ status: "ok", cases: results.length }));
} finally {
  await browser.close();
  server.closeAllConnections();
  server.close();
}
