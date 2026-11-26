// Human-readable stock on hand, e.g. "4 Strips + 3 Tablets". Product.qty is
// stored in loose units for pack-and-loose products, whole packs otherwise.
export function stockDisplay(product) {
  if (product.soldAs === "pack-and-loose" && product.unitsPerPack) {
    const packs = Math.floor(product.qty / product.unitsPerPack);
    const loose = product.qty % product.unitsPerPack;
    return `${packs} ${product.packUnit}${packs === 1 ? "" : "s"}${loose ? ` + ${loose} ${product.looseUnitName}${loose === 1 ? "" : "s"}` : ""}`;
  }
  return `${product.qty} ${product.packUnit}${product.qty === 1 ? "" : "s"}`;
}

// Reasons offered for an Extra Stock Addition (the server accepts only these).
export const EXTRA_STOCK_REASONS = ["Opening Balance", "Stock Correction", "Found Stock", "Free Items", "Adjustment", "Other"];
