export function initializeProductTiles(root) {
    let press = null;
    let release = null;
    const tileFor = target => target instanceof Element ? target.closest("[data-product-tile]") : null;

    function inside(tile, event) {
        const hit = document.elementFromPoint(event.clientX, event.clientY);
        return hit !== null && tile.contains(hit);
    }

    function clearPress() {
        const previous = press;
        press = null;
        if (!previous) return;
        previous.tile.classList.remove("is-pressed");
        if (previous.pointerId !== undefined && previous.tile.hasPointerCapture(previous.pointerId)) {
            previous.tile.releasePointerCapture(previous.pointerId);
        }
    }

    function cancel() {
        release = null;
        clearPress();
    }

    root.addEventListener("pointerdown", event => {
        const tile = tileFor(event.target);
        if (!tile || event.button !== 0 || !event.isPrimary) return;
        cancel();
        press = { tile, pointerId: event.pointerId };
        tile.classList.add("is-pressed");
        tile.setPointerCapture(event.pointerId);
    });

    root.addEventListener("pointermove", event => {
        if (press?.pointerId !== event.pointerId) return;
        press.tile.classList.toggle("is-pressed", inside(press.tile, event));
    });

    root.addEventListener("pointerup", event => {
        if (press?.pointerId !== event.pointerId) return;
        const tile = press.tile;
        const valid = inside(tile, event) && document.hasFocus();
        clearPress();
        release = valid ? { tile, at: performance.now() } : null;
    });

    root.addEventListener("pointercancel", cancel);
    root.addEventListener("lostpointercapture", event => {
        if (press?.pointerId === event.pointerId) cancel();
    });

    root.addEventListener("keydown", event => {
        const tile = tileFor(event.target);
        if (!tile || !["Enter", " "].includes(event.key)) return;
        event.preventDefault();
        if (event.repeat) return;
        cancel();
        press = { tile, key: event.key };
        tile.classList.add("is-pressed");
    });

    root.addEventListener("keyup", event => {
        if (!press || press.key !== event.key) return;
        event.preventDefault();
        const tile = press.tile;
        const valid = document.activeElement === tile && document.hasFocus();
        clearPress();
        if (valid) tile.click();
    });

    root.addEventListener("focusout", event => {
        if (press?.tile === tileFor(event.target)) cancel();
    });

    // El click fisico solo pasa si termino una pulsacion dentro de la misma tarjeta.
    // detail=0 conserva la activacion semantica de teclado y lectores de pantalla.
    root.addEventListener("click", event => {
        const tile = tileFor(event.target);
        if (!tile) return;
        const valid = event.detail === 0 || (release?.tile === tile && performance.now() - release.at < 1000);
        release = null;
        if (!valid) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }, true);

    root.addEventListener("dragstart", event => {
        if (tileFor(event.target)) event.preventDefault();
        cancel();
    });
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", event => { if (event.key === "Escape") cancel(); });
    document.addEventListener("visibilitychange", () => { if (document.hidden) cancel(); });
}
