import assert from "node:assert/strict";
import { test } from "node:test";

import { createSplashLifecycle, type SplashClock } from "../src/startup/splashLifecycle.ts";

class FakeClock implements SplashClock {
  time = 100_000;
  sequence = 0;
  timers = new Map<number, { at: number; callback: () => void }>();
  now() { return this.time; }
  schedule(callback: () => void, delay: number) {
    const id = ++this.sequence;
    this.timers.set(id, { at: this.time + delay, callback });
    return id;
  }
  cancel(id: number) { this.timers.delete(id); }
  advance(milliseconds: number) {
    const target = this.time + milliseconds;
    while (true) {
      const next = [...this.timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > target) break;
      this.time = next[1].at;
      this.timers.delete(next[0]);
      next[1].callback();
    }
    this.time = target;
  }
}

function setup() {
  const clock = new FakeClock();
  const dismissedAt: number[] = [];
  const lifecycle = createSplashLifecycle(() => dismissedAt.push(clock.now() - 100_000), clock);
  return { clock, dismissedAt, lifecycle };
}

test("respuesta inmediata: conserva el splash hasta los 2000 ms", () => {
  const { clock, dismissedAt, lifecycle } = setup();
  lifecycle.setReady();
  clock.advance(1999);
  assert.deepEqual(dismissedAt, []);
  clock.advance(1);
  assert.deepEqual(dismissedAt, [2000]);
});

test("respuesta antes del mínimo: descuenta el tiempo ya transcurrido", () => {
  const { clock, dismissedAt, lifecycle } = setup();
  clock.advance(1200);
  lifecycle.setReady();
  clock.advance(800);
  assert.deepEqual(dismissedAt, [2000]);
});

test("respuesta posterior al mínimo: entra al terminar la carga", () => {
  const { clock, dismissedAt, lifecycle } = setup();
  clock.advance(3200);
  assert.deepEqual(dismissedAt, []);
  lifecycle.setReady();
  clock.advance(0);
  assert.deepEqual(dismissedAt, [3200]);
});

test("servicio sin respuesta: entra obligatoriamente a los 5000 ms", () => {
  const { clock, dismissedAt } = setup();
  clock.advance(4999);
  assert.deepEqual(dismissedAt, []);
  clock.advance(1);
  assert.deepEqual(dismissedAt, [5000]);
});

test("refrescos y respuestas tardías no reinician el splash", () => {
  const { clock, dismissedAt, lifecycle } = setup();
  clock.advance(300);
  lifecycle.setReady();
  clock.advance(1200);
  lifecycle.setReady();
  clock.advance(500);
  assert.deepEqual(dismissedAt, [2000]);
  lifecycle.setReady();
  clock.advance(20_000);
  assert.deepEqual(dismissedAt, [2000]);
  assert.equal(clock.timers.size, 0);
});

test("una respuesta posterior al límite no produce otro cierre", () => {
  const { clock, dismissedAt, lifecycle } = setup();
  clock.advance(8000);
  lifecycle.setReady();
  clock.advance(0);
  assert.deepEqual(dismissedAt, [5000]);
});

test("desmontar cancela los temporizadores, incluso antes de estar listo", () => {
  for (const ready of [false, true]) {
    const { clock, dismissedAt, lifecycle } = setup();
    if (ready) lifecycle.setReady();
    clock.advance(500);
    lifecycle.dispose();
    lifecycle.setReady();
    clock.advance(10_000);
    assert.deepEqual(dismissedAt, []);
    assert.equal(clock.timers.size, 0);
  }
});
