import { recordProductAttempt } from "./visit-tracker.js";

document.addEventListener("click", event => {
  const tile = event.target instanceof Element ? event.target.closest("[data-product-path]") : null;
  if (tile) recordProductAttempt(tile.dataset.productPath);
});
