import { COOKIE_NAME, MAX_COLUMNS, layoutCookie, moveLayout, readLayoutCookie } from "./layout-model.js";
import { initializeProductTiles } from "./product-tiles.js";

const sectionsRoot = document.getElementById("mode-choice");
initializeProductTiles(sectionsRoot);
const editButton = document.getElementById("layout-edit");
const resetButton = document.getElementById("layout-reset");
const status = document.getElementById("layout-status");
const sections = new Map(Array.from(sectionsRoot.querySelectorAll(".system-section"))
    .map(section => [section.dataset.system, section]));
const systems = [...sections.keys()];
const defaultLayout = { version: 1, rows: [["platform", "reportespiolis"], ["moto-tester"], ["lechuza-server"], ["chatcheto"], ["kite-cat"]] };
let layout = defaultLayout;
let editing = false;
let draggedSystem = null;
let dropTarget = null;
let dropZone = null;
const handles = [];
const moveControls = [];

function applyLayout(candidate) {
    layout = candidate;
    const rows = candidate.rows.map(row => {
        const element = document.createElement("div");
        element.className = "layout-row";
        element.dataset.columns = String(row.length);
        row.forEach(system => element.appendChild(sections.get(system)));
        return element;
    });
    sectionsRoot.replaceChildren(...rows);
}

function saveLayout() {
    try {
        document.cookie = layoutCookie(layout, systems, window.location.protocol === "https:");
        if (JSON.stringify(readLayoutCookie(document.cookie, systems)) !== JSON.stringify(layout)) {
            throw new Error("El navegador no permitió guardar la cookie de disposición");
        }
        status.textContent = "Orden guardado en este navegador";
    } catch (error) {
        status.textContent = error instanceof Error ? error.message : "No se pudo guardar la disposición";
    }
}

function setEditing(enabled) {
    editing = enabled;
    editButton.textContent = enabled ? "Terminar edición" : "Editar disposición";
    editButton.setAttribute("aria-pressed", String(enabled));
    resetButton.hidden = !enabled;
    handles.forEach(handle => { handle.hidden = !enabled; });
    moveControls.forEach(control => { control.hidden = true; });
}

function clearDropState() {
    sections.forEach(section => section.classList.remove("drop-before", "drop-share", "drop-after"));
    dropTarget = null;
    dropZone = null;
}

function move(system, target, placement) {
    if (!editing) return;
    try {
        applyLayout(moveLayout(layout, system, target, placement, systems));
        moveControls.forEach(control => { control.hidden = true; });
        saveLayout();
        handles[systems.indexOf(system)].focus();
    } catch (error) {
        status.textContent = error instanceof Error ? error.message : "No se pudo mover el producto";
    }
}

sections.forEach((section, system) => {
    const handle = document.createElement("button");
    handle.className = "drag-handle";
    handle.type = "button";
    handle.draggable = true;
    handle.textContent = "Mover";
    handle.setAttribute("aria-label", "Mover producto " + system);
    handle.title = "Arrastrá o pulsá para elegir la posición";
    handle.addEventListener("dragstart", event => {
        if (!editing) { event.preventDefault(); return; }
        draggedSystem = system;
        section.classList.add("is-dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", system);
        event.dataTransfer.setDragImage(section, 24, 24);
    });
    handle.addEventListener("dragend", () => {
        section.classList.remove("is-dragging");
        draggedSystem = null;
        clearDropState();
    });
    const control = document.createElement("form");
    control.className = "layout-move-controls";
    control.hidden = true;
    const targetLabel = document.createElement("label");
    targetLabel.textContent = "Producto de referencia";
    const target = document.createElement("select");
    systems.filter(entry => entry !== system).forEach(entry => target.add(new Option(entry, entry)));
    targetLabel.appendChild(target);
    const placementLabel = document.createElement("label");
    placementLabel.textContent = "Posición";
    const placement = document.createElement("select");
    [["share-before", "Misma fila, antes"], ["share-after", "Misma fila, después"],
        ["before", "Fila anterior"], ["after", "Fila siguiente"]]
        .forEach(([value, label]) => placement.add(new Option(label, value)));
    placementLabel.appendChild(placement);
    const submit = document.createElement("button");
    submit.className = "layout-edit";
    submit.type = "submit";
    submit.textContent = "Aplicar posición";
    control.append(targetLabel, placementLabel, submit);
    control.addEventListener("submit", event => { event.preventDefault(); move(system, target.value, placement.value); });
    handle.addEventListener("click", () => { control.hidden = !control.hidden; if (!control.hidden) target.focus(); });
    section.append(handle, control);
    handles.push(handle);
    moveControls.push(control);
});

sectionsRoot.addEventListener("dragover", event => {
    if (!editing || !draggedSystem) return;
    const target = event.target.closest(".system-section");
    if (!target || target.dataset.system === draggedSystem) { clearDropState(); return; }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rectangle = target.getBoundingClientRect();
    const vertical = (event.clientY - rectangle.top) / rectangle.height;
    const row = layout.rows.find(entries => entries.includes(target.dataset.system)).filter(entry => entry !== draggedSystem);
    let zone = vertical < 0.25 ? "before" : vertical > 0.75 ? "after" : "share";
    if (zone === "share" && row.length >= MAX_COLUMNS) zone = vertical < 0.5 ? "before" : "after";
    clearDropState();
    dropTarget = target.dataset.system;
    dropZone = zone;
    target.classList.add("drop-" + zone);
});

sectionsRoot.addEventListener("drop", event => {
    event.preventDefault();
    if (draggedSystem && dropTarget && dropZone) {
        const rectangle = sections.get(dropTarget).getBoundingClientRect();
        const placement = dropZone === "share"
            ? (event.clientX < rectangle.left + rectangle.width / 2 ? "share-before" : "share-after") : dropZone;
        move(draggedSystem, dropTarget, placement);
    }
    clearDropState();
});

resetButton.addEventListener("click", () => { applyLayout(defaultLayout); saveLayout(); });
editButton.addEventListener("click", () => { setEditing(!editing); });
setEditing(false);
try {
    const saved = readLayoutCookie(document.cookie, systems);
    applyLayout(saved || defaultLayout);
    status.textContent = saved ? "Orden de este navegador" : "Orden predeterminado";
} catch (error) {
    applyLayout(defaultLayout);
    status.textContent = error.message;
    document.cookie = COOKIE_NAME + "=; Path=/; Max-Age=0; SameSite=Lax";
}
