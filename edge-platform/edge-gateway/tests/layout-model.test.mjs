import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutCookie, moveLayout, readLayoutCookie, validateLayout } from "../html/layout-model.js";

const systems = ["a", "b", "c", "d", "e"];
const initial = { version: 1, rows: [["a", "b"], ["c"], ["d"], ["e"]] };

test("hasta tres productos por fila y nunca cuatro", () => {
    const three = moveLayout(initial, "c", "b", "share-after", systems);
    assert.deepEqual(three.rows, [["a", "b", "c"], ["d"], ["e"]]);
    assert.throws(() => moveLayout(three, "d", "a", "share-before", systems), /hasta tres/);
    assert.deepEqual(initial.rows, [["a", "b"], ["c"], ["d"], ["e"]]);
});

test("reordena dentro de una fila llena y separa filas sin perder productos", () => {
    const three = moveLayout(initial, "c", "a", "share-before", systems);
    const reordered = moveLayout(three, "a", "b", "share-after", systems);
    assert.deepEqual(reordered.rows[0], ["c", "b", "a"]);
    assert.deepEqual(moveLayout(reordered, "b", "e", "after", systems).rows, [["c", "a"], ["d"], ["e"], ["b"]]);
});

test("cookie local con caducidad, sin sesión ni disposición de otro cliente", () => {
    const cookie = layoutCookie(initial, systems, true);
    assert.ok(cookie.length < 4096);
    assert.match(cookie, /Max-Age=31536000; SameSite=Lax; Secure$/);
    assert.deepEqual(readLayoutCookie("servicoop_edge_session=unrelated; " + cookie.split(";")[0], systems), initial);
    assert.equal(readLayoutCookie("", systems), null);
    assert.throws(() => readLayoutCookie("servicoop_portal_layout=broken", systems));
});

test("rechaza duplicados, filas vacías, cuatro columnas y productos desconocidos", () => {
    for (const rows of [[["a", "b", "c", "d"], ["e"]], [["a", "b"], ["c", "d"], []],
        [["a", "b"], ["c", "d"], ["x"]], [["a", "b"], ["c", "d"], ["a"]]]) {
        assert.throws(() => validateLayout({ version: 1, rows }, systems));
    }
});
