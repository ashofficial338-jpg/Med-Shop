// Mirrors server/src/utils/composition.js.
export const DOSAGE_FORMS = [
  "Tablet", "Capsule", "Syrup", "Suspension", "Injection", "Drops", "Cream", "Ointment",
  "Gel", "Lotion", "Inhaler", "Spray", "Powder", "Sachet", "Solution", "Suppository", "Other",
];
export const RELEASE_TYPES = ["Immediate", "SR", "ER", "XR", "CR", "MR", "DR", "Enteric Coated", "Dispersible", "Chewable"];

// Who makes it: the manufacturer, falling back to the older brand/company field.
export const makerOf = (p) => p?.manufacturer || p?.brand || "";

// Packs on hand (whole + fraction) - the unit every brand can be compared in.
export const packsOnHand = (p) =>
  p.soldAs === "pack-and-loose" && p.unitsPerPack ? p.qty / p.unitsPerPack : p.qty;

export function stockLabel(p) {
  if (p.soldAs === "pack-and-loose" && p.unitsPerPack) {
    const packs = Math.floor(p.qty / p.unitsPerPack);
    const loose = p.qty % p.unitsPerPack;
    return `${packs} ${p.packUnit}${packs === 1 ? "" : "s"}${loose ? ` + ${loose} ${p.looseUnitName}` : ""}`;
  }
  return `${p.qty} ${p.packUnit}${p.qty === 1 ? "" : "s"}`;
}

// Informational combined stock across brands, per pack unit ("40 Strips + 3 Bottles").
export function combinedStockLabel(products) {
  const byUnit = new Map();
  for (const p of products) byUnit.set(p.packUnit, (byUnit.get(p.packUnit) || 0) + packsOnHand(p));
  return [...byUnit.entries()]
    .map(([unit, n]) => {
      const v = Number(n.toFixed(1));
      return `${v} ${unit}${v === 1 ? "" : "s"}`;
    })
    .join(" + ");
}
