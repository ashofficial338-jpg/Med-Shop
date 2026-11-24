// Stock arithmetic for one line of the bill being made.

// Internal stock units one line takes (loose units for pack-and-loose products).
export const lineUnits = (line) =>
  line.unitType === "pack" && line.product.soldAs === "pack-and-loose" ? line.qty * line.product.unitsPerPack : line.qty;

export function unitsLabel(product, units) {
  if (product.soldAs === "pack-and-loose" && product.unitsPerPack) {
    const packs = Math.floor(units / product.unitsPerPack);
    const loose = units % product.unitsPerPack;
    return `${packs} ${product.packUnit}${packs === 1 ? "" : "s"}${loose ? ` + ${loose} ${product.looseUnitName}` : ""}`;
  }
  return `${units} ${product.packUnit}${units === 1 ? "" : "s"}`;
}

export const hasRack = (line) => line.rack !== null && line.rack !== undefined;

// Units available for a line: the picked rack position of the picked batch,
// the picked batch, or the whole product. Null while that is still loading.
export function availableFor(line, batches) {
  if (!batches) return null;
  if (!line.batch) return batches.reduce((s, b) => s + b.qtyRemaining, 0);
  const b = batches.find((x) => x._id === line.batch);
  if (!b) return 0;
  if (!hasRack(line)) return b.qtyRemaining;
  return b.locations.find((l) => l.rack === line.rack)?.qty || 0;
}

// The first line that can't be filled: too much for its own batch, or - a
// strip line and a loose-tablet line of one product together - too much for
// the product. Undefined when everything on the bill is in stock.
export function shortLineOf(lines, batchesByProduct) {
  const used = new Map();
  for (const l of lines) used.set(l.product._id, (used.get(l.product._id) || 0) + lineUnits(l));
  return lines.find((l) => {
    const batches = batchesByProduct[l.product._id];
    const available = availableFor(l, batches);
    if (available === null) return false;
    const all = batches.reduce((s, b) => s + b.qtyRemaining, 0);
    return lineUnits(l) > available || used.get(l.product._id) > all;
  });
}
