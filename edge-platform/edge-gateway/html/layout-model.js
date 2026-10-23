export const COOKIE_NAME = "servicoop_portal_layout";
export const MAX_COLUMNS = 3;

export function validateLayout(candidate, systems) {
    if (!candidate || candidate.version !== 1 || !Array.isArray(candidate.rows) || !candidate.rows.length
            || !candidate.rows.every(row => Array.isArray(row) && row.length >= 1 && row.length <= MAX_COLUMNS)) {
        throw new Error("La disposición guardada no es válida");
    }
    const entries = candidate.rows.flat();
    if (entries.length !== systems.length || new Set(entries).size !== systems.length
            || !entries.every(system => systems.includes(system))) {
        throw new Error("La disposición no coincide con los productos disponibles");
    }
    return { version: 1, rows: candidate.rows.map(row => row.slice()) };
}

export function readLayoutCookie(cookies, systems) {
    const cookie = cookies.split(";").map(part => part.trim()).find(part => part.startsWith(COOKIE_NAME + "="));
    if (!cookie) return null;
    try {
        return validateLayout(JSON.parse(decodeURIComponent(cookie.slice(COOKIE_NAME.length + 1))), systems);
    } catch {
        throw new Error("La cookie de disposición no es válida; se muestra el orden predeterminado");
    }
}

export function layoutCookie(layout, systems, secure) {
    const value = encodeURIComponent(JSON.stringify(validateLayout(layout, systems)));
    return COOKIE_NAME + "=" + value + "; Path=/; Max-Age=31536000; SameSite=Lax" + (secure ? "; Secure" : "");
}

export function moveLayout(layout, system, target, placement, systems) {
    validateLayout(layout, systems);
    if (system === target || !systems.includes(system) || !systems.includes(target)
            || !["before", "after", "share-before", "share-after"].includes(placement)) {
        throw new Error("Seleccioná otro producto como destino");
    }
    const rows = layout.rows.map(row => row.filter(entry => entry !== system)).filter(row => row.length);
    const index = rows.findIndex(row => row.includes(target));
    const row = rows[index];
    if (placement.startsWith("share-")) {
        if (row.length >= MAX_COLUMNS) throw new Error("Una fila admite hasta tres productos");
        row.splice(row.indexOf(target) + (placement === "share-after" ? 1 : 0), 0, system);
    } else {
        rows.splice(index + (placement === "after" ? 1 : 0), 0, [system]);
    }
    return validateLayout({ version: 1, rows }, systems);
}
