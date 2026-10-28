import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const origin = process.env.PORTAL_ORIGIN ?? "http://platform-landing-preview:8081";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const products = [
  { label: "Abrir Métricas server", target: "/recursos/", form: "protected" },
  { label: "Abrir reportespiolis", target: "/reporte/" },
  { label: "Abrir moto-tester", target: "/moto-tester/" },
  { label: "Entrar a lechuza-server en modo seguro", target: "/lechu/", secure: true },
  { label: "Entrar a lechuza-server en modo protegido", target: "/lechu/", form: "protected" },
  { label: "Abrir alarmero", target: "/alarmero/", form: "alarmero" },
  { label: "Abrir kite-cat", target: "/kite-cat/", form: "protected" },
  { label: "Abrir chatcheto", target: "/chatcheto/", form: "chatcheto" },
];
const errors = [];
let authRequests = 0, secureRequests = 0;

async function prepare(page) {
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/mode/secure") {
      secureRequests++;
      return route.fulfill({ status: 204 });
    }
    if (path === "/mode/protected" || path === "/mode/kite-cat") {
      authRequests++;
      assert.equal(request.headers()["x-mode-user"], "tile-test");
      assert.equal(request.headers()["x-mode-pass"], "tile-test");
      return route.fulfill({ status: 204 });
    }
    if (path === "/chatcheto/" && request.resourceType() === "fetch") return route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Destino de prueba</h1>" });
    if (request.isNavigationRequest() && path !== "/") return route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Destino de prueba</h1>" });
    return route.continue();
  });
}

async function home(page) {
  await page.goto(`${origin}/`);
  await page.locator(".layout-row").first().waitFor();
  assert.equal(await page.locator("#mode-choice .card").count(), 8);
  assert.equal(await page.locator("[data-product-tile]").count(), 8);
  assert.equal(await page.locator("[data-product-tile] button, [data-product-tile] a").count(), 0);
}

const tile = (page, product) => page.locator("[data-product-tile]").filter({ has: page.locator(`.tile-title`) }).and(page.getByLabel(product.label, { exact: true }));
async function point(page, product, edge = false) {
  const element = tile(page, product);
  await element.scrollIntoViewIfNeeded();
  const box = await element.boundingBox();
  return { element, x: box.x + (edge ? box.width - 2 : box.width / 2), y: box.y + box.height / 2 };
}
async function idle(page) {
  assert.equal(new URL(page.url()).pathname, "/");
  assert.equal(await page.locator("#mode-choice").isVisible(), true);
  assert.equal(await page.locator(".product-tile.is-pressed").count(), 0);
}
async function finish(page, product) {
  if (product.form) {
    const panel = page.locator(`#${product.form}-login`);
    await panel.waitFor({ state: "visible" });
    assert.equal(new URL(page.url()).pathname, "/");
    assert.equal(await page.locator(".product-tile.is-pressed").count(), 0);
    const user = product.form === "protected" ? "user" : `${product.form}-user`;
    const pass = product.form === "protected" ? "pass" : `${product.form}-pass`;
    await page.locator(`#${user}`).fill("tile-test");
    await page.locator(`#${pass}`).fill("tile-test");
    await panel.locator('button[type="submit"]').click();
  }
  await page.waitForURL(url => url.pathname === product.target);
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await prepare(page);
  for (const product of products) {
    await home(page);
    const start = await point(page, product);
    const requests = authRequests + secureRequests;
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    assert.equal(await start.element.evaluate(element => element.classList.contains("is-pressed")), true);
    assert.equal(await page.locator("#mode-choice").isVisible(), true);
    await page.waitForFunction(label => {
      const element = [...document.querySelectorAll("[data-product-tile]")].find(item => item.getAttribute("aria-label") === label);
      return element?.classList.contains("is-pressed") && new DOMMatrixReadOnly(getComputedStyle(element.querySelector(".tile-face")).transform).m42 >= 4.9;
    }, product.label, { timeout: 3000 });
    const travel = await start.element.locator(".tile-face").evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).m42);
    assert.ok(travel >= 4.9, "Falta la animacion de presion");
    await page.mouse.move(2, 2);
    await page.mouse.up();
    await idle(page);
    assert.equal(authRequests + secureRequests, requests);

    const focus = await point(page, product);
    await page.mouse.move(focus.x, focus.y);
    await page.mouse.down();
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.mouse.up();
    await idle(page);
    assert.equal(authRequests + secureRequests, requests);

    const edge = await point(page, product, true);
    await page.mouse.move(edge.x, edge.y);
    await page.mouse.down();
    assert.equal(await page.locator("#mode-choice").isVisible(), true);
    await page.mouse.up();
    await finish(page, product);
  }

  for (const product of [products[1], products[6]]) {
    for (const key of ["Enter", "Space"]) {
      await home(page);
      const element = tile(page, product);
      await element.focus();
      const scroll = await page.evaluate(() => scrollY);
      await page.keyboard.down(key);
      assert.equal(await element.evaluate(item => item.classList.contains("is-pressed")), true);
      assert.equal(new URL(page.url()).pathname, "/");
      assert.equal(await page.locator("#mode-choice").isVisible(), true);
      assert.equal(await page.evaluate(() => scrollY), scroll);
      await page.keyboard.down(key);
      assert.equal(await page.locator("#mode-choice").isVisible(), true);
      await page.keyboard.up(key);
      await finish(page, product);
    }
    await home(page);
    await tile(page, product).focus();
    await page.keyboard.down("Space");
    await page.locator("#layout-edit").focus();
    await page.keyboard.up("Space");
    await idle(page);
  }

  await home(page);
  const cancelled = await point(page, products[6]);
  await page.mouse.move(cancelled.x, cancelled.y);
  await page.mouse.down();
  await cancelled.element.dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse", isPrimary: true });
  await page.mouse.up();
  await idle(page);
  await cancelled.element.focus();
  await page.keyboard.down("Enter");
  await page.keyboard.press("Escape");
  await page.keyboard.up("Enter");
  await idle(page);

  const image = page.locator('#moto-tester-title img');
  await image.waitFor();
  await page.waitForFunction(() => document.querySelector('#moto-tester-title img').naturalWidth > 0);
  assert.equal(await image.getAttribute("src"), "/moto-tester/assets/trasvase.png");
  await page.locator('#layout-edit').click();
  await page.locator('[data-system="moto-tester"] .drag-handle').dragTo(page.locator('[data-system="reportespiolis"] [data-product-tile]'));
  await idle(page);
  assert.ok((await context.cookies()).some(cookie => cookie.name === "servicoop_portal_layout"));
  await page.locator('#layout-reset').click();
  await page.locator('[data-system="moto-tester"] .drag-handle').click();
  const move = page.locator('[data-system="moto-tester"] .layout-move-controls');
  await move.locator("select").nth(0).selectOption("platform");
  await move.locator("select").nth(1).selectOption("share-after");
  await move.locator('button[type="submit"]').click();
  const order = await page.locator('.layout-row[data-columns="3"] .system-section').evaluateAll(items => items.map(item => item.dataset.system));
  assert.deepEqual(order, ["platform", "moto-tester", "reportespiolis"]);
  await home(page);
  assert.deepEqual(await page.locator('.layout-row[data-columns="3"] .system-section').evaluateAll(items => items.map(item => item.dataset.system)), order);
  await page.getByRole("button", { name: "Oscuro", exact: true }).click();
  assert.equal(await page.locator("html").getAttribute("data-sc-theme"), "dark");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reduced = await point(page, products[6]);
  await page.mouse.move(reduced.x, reduced.y);
  await page.mouse.down();
  assert.equal(await reduced.element.locator(".tile-face").evaluate(element => getComputedStyle(element).transitionDuration), "0s");
  await page.mouse.move(2, 2); await page.mouse.up(); await idle(page);

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobile = await mobileContext.newPage();
  await prepare(mobile); await home(mobile);
  const touch = await point(mobile, products[6]);
  const cdp = await mobileContext.newCDPSession(mobile);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: touch.x, y: touch.y }] });
  assert.equal(await touch.element.evaluate(element => element.classList.contains("is-pressed")), true);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 2, y: 2 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await idle(mobile);
  await touch.element.tap();
  await mobile.locator("#protected-login").waitFor({ state: "visible" });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ tiles: products.length, complete_clicks: products.length, outside_release_cancellations: products.length, focus_loss_cancellations: products.length, keyboard_release: 4, keyboard_focus_cancellation: 2, pointer_cancel: true, escape_cancel: true, mobile_press_cancel_and_tap: true, moto_icon: true, drag_and_cookie_layout: true, three_columns: true, reduced_motion: true, protected_logins_mocked: authRequests, secure_requests_mocked: secureRequests, browser_errors: errors.length }));
} finally { await browser.close(); }
