(function () {
    "use strict";

    const defaultLayout = {
        rows: [
            ["platform", "reportespiolis"],
            ["moto-tester"],
            ["lechuza-server"],
            ["chatcheto"]
        ]
    };
    const sectionsRoot = document.getElementById("mode-choice");
    const editButton = document.getElementById("layout-edit");
    const resetButton = document.getElementById("layout-reset");
    const status = document.getElementById("layout-status");
    const sections = new Map(
        Array.from(sectionsRoot.querySelectorAll(".system-section"))
            .map(function (section) { return [section.dataset.system, section]; })
    );
    let layout = structuredClone(defaultLayout);
    let draggedSystem = null;
    let dropTarget = null;
    let dropZone = null;
    let editingEnabled = false;
    const dragHandles = [];

    function setEditingEnabled(enabled) {
        editingEnabled = enabled;
        editButton.hidden = enabled;
        resetButton.hidden = !enabled;
        dragHandles.forEach(function (handle) { handle.hidden = !enabled; });
    }

    function validLayout(candidate) {
        if (!candidate || !Array.isArray(candidate.rows) || candidate.rows.length === 0) return false;
        const flattened = candidate.rows.flat();
        return candidate.rows.every(function (row) {
            return Array.isArray(row) && row.length >= 1 && row.length <= 2;
        }) && flattened.length === sections.size
            && new Set(flattened).size === sections.size
            && flattened.every(function (system) { return sections.has(system); });
    }

    function applyLayout(candidate) {
        if (!validLayout(candidate)) throw new Error("Disposición inválida");
        layout = { rows: candidate.rows.map(function (row) { return row.slice(); }) };
        layout.rows.forEach(function (row) {
            row.forEach(function (system) {
                const section = sections.get(system);
                section.dataset.layoutWidth = row.length === 2 ? "half" : "full";
                sectionsRoot.appendChild(section);
            });
        });
    }

    function withoutSystem(rows, system) {
        return rows
            .map(function (row) { return row.filter(function (entry) { return entry !== system; }); })
            .filter(function (row) { return row.length > 0; });
    }

    function clearDropState() {
        sections.forEach(function (section) {
            section.classList.remove("drop-before", "drop-share", "drop-after");
        });
        dropTarget = null;
        dropZone = null;
    }

    function markDrop(section, zone) {
        clearDropState();
        dropTarget = section.dataset.system;
        dropZone = zone;
        section.classList.add("drop-" + zone);
    }

    async function saveLayout() {
        if (!editingEnabled) return;
        status.textContent = "Guardando…";
        try {
            const response = await fetch("/portal-layout", {
                method: "PUT",
                credentials: "same-origin",
                cache: "no-store",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(layout)
            });
            if (response.status === 401) {
                setEditingEnabled(false);
                status.textContent = "La sesión venció; habilitá nuevamente la edición";
                return;
            }
            if (!response.ok) throw new Error("No se pudo guardar");
            status.textContent = "Orden guardado";
        } catch (error) {
            status.textContent = error instanceof Error ? error.message : "No se pudo guardar";
        }
    }

    async function loadLayout() {
        try {
            const response = await fetch("/portal-layout", { cache: "no-store" });
            if (!response.ok) throw new Error("Sin disposición guardada");
            const candidate = await response.json();
            applyLayout(candidate);
            status.textContent = "Orden del servidor";
        } catch {
            applyLayout(defaultLayout);
            status.textContent = "Orden predeterminado";
        }
    }

    async function loadEditingPermission() {
        try {
            const response = await fetch("/mode/session", {
                credentials: "same-origin",
                cache: "no-store"
            });
            setEditingEnabled(response.headers.get("X-Edge-Mode") === "protected");
        } catch {
            setEditingEnabled(false);
        }
    }

    function moveToDrop(system, target, zone, pointerX) {
        const rows = withoutSystem(layout.rows, system);
        const targetRowIndex = rows.findIndex(function (row) { return row.includes(target); });
        if (targetRowIndex < 0) return;
        const targetRow = rows[targetRowIndex];
        if (zone === "share" && targetRow.length < 2) {
            const targetSection = sections.get(target);
            const placeBefore = pointerX < targetSection.getBoundingClientRect().left
                + targetSection.getBoundingClientRect().width / 2;
            targetRow.splice(placeBefore ? 0 : targetRow.length, 0, system);
        } else {
            rows.splice(targetRowIndex + (zone === "after" ? 1 : 0), 0, [system]);
        }
        applyLayout({ rows: rows });
        void saveLayout();
    }

    sections.forEach(function (section, system) {
        const handle = document.createElement("button");
        handle.className = "drag-handle";
        handle.type = "button";
        handle.draggable = true;
        handle.textContent = "Mover";
        handle.setAttribute("aria-label", "Mover sección " + system);
        handle.title = "Arrastrá para cambiar de fila o compartirla";
        handle.hidden = true;
        handle.addEventListener("dragstart", function (event) {
            draggedSystem = system;
            section.classList.add("is-dragging");
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", system);
            event.dataTransfer.setDragImage(section, 24, 24);
        });
        handle.addEventListener("dragend", function () {
            section.classList.remove("is-dragging");
            draggedSystem = null;
            clearDropState();
        });
        section.appendChild(handle);
        dragHandles.push(handle);
    });

    sectionsRoot.addEventListener("dragover", function (event) {
        if (!draggedSystem) return;
        const target = event.target.closest(".system-section");
        if (!target || target.dataset.system === draggedSystem) {
            clearDropState();
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const rectangle = target.getBoundingClientRect();
        const vertical = (event.clientY - rectangle.top) / rectangle.height;
        const rowsWithoutSource = withoutSystem(layout.rows, draggedSystem);
        const targetRow = rowsWithoutSource.find(function (row) {
            return row.includes(target.dataset.system);
        });
        let zone = vertical < 0.25 ? "before" : vertical > 0.75 ? "after" : "share";
        if (zone === "share" && targetRow && targetRow.length >= 2) {
            zone = vertical < 0.5 ? "before" : "after";
        }
        markDrop(target, zone);
    });

    sectionsRoot.addEventListener("drop", function (event) {
        event.preventDefault();
        if (draggedSystem && dropTarget && dropZone) {
            moveToDrop(draggedSystem, dropTarget, dropZone, event.clientX);
        }
        clearDropState();
    });

    resetButton.addEventListener("click", function () {
        applyLayout(defaultLayout);
        void saveLayout();
    });

    editButton.addEventListener("click", function () {
        window.showProtectedForm("/", function () {
            setEditingEnabled(true);
            status.textContent = "Edición habilitada";
        });
    });

    applyLayout(defaultLayout);
    setEditingEnabled(false);
    void loadLayout();
    void loadEditingPermission();
})();
