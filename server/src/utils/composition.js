// Composition Groups: brands with the same active ingredients, strength,
// dosage form and release type. A group is derived from each product's own
// fields (never stored), and is only ever used to find and report on brands
// together - stock, batches and prices always stay with the individual brand.
// Release type is part of the key because e.g. a 500 mg SR tablet is not a
// substitute for a 500 mg plain tablet.

export const DOSAGE_FORMS = [
  "", "Tablet", "Capsule", "Syrup", "Suspension", "Injection", "Drops", "Cream", "Ointment",
  "Gel", "Lotion", "Inhaler", "Spray", "Powder", "Sachet", "Solution", "Suppository", "Other",
];
export const RELEASE_TYPES = ["", "Immediate", "SR", "ER", "XR", "CR", "MR", "DR", "Enteric Coated", "Dispersible", "Chewable"];

// "Paracetamol + Caffeine", "caffeine, paracetamol" -> "caffeine+paracetamol".
export function normalizeComposition(text) {
  return String(text || "")
    .toLowerCase()
    .split(/\s*(?:\+|,|&|\/|\band\b)\s*/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .sort()
    .join("+");
}

export function strengthLabel(p) {
  if (!(Number(p.strengthValue) > 0)) return "";
  return `${Number(p.strengthValue)} ${p.strengthUnit || ""}`.trim();
}

// Null when the product has no composition entered (it then stands alone).
export function compositionKey(p) {
  const comp = normalizeComposition(p.composition);
  if (!comp) return null;
  return [comp, strengthLabel(p).toLowerCase().replace(/\s+/g, ""), (p.dosageForm || "").toLowerCase(), (p.releaseType || "").toLowerCase()].join("|");
}

export function compositionLabel(p) {
  return [p.composition, strengthLabel(p), p.dosageForm, p.releaseType && p.releaseType !== "Immediate" ? p.releaseType : ""]
    .filter(Boolean)
    .join(" · ");
}

const escapeRegex = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TEXT_FIELDS = ["name", "productCode", "brand", "genericName", "composition", "manufacturer"];

// Mongo filter for a free-text search over brand name, generic name,
// composition, manufacturer, code, barcode and strength. Every word must
// match some field, so "paracetamol 650" finds Paracetamol 650 mg brands.
export function productSearchFilter(q) {
  const text = String(q || "").trim();
  if (!text) return null;
  const tokens = text.split(/\s+/).slice(0, 8);
  const tokenClauses = tokens.map((token) => {
    const pattern = new RegExp(escapeRegex(token), "i");
    const or = TEXT_FIELDS.map((f) => ({ [f]: pattern }));
    const strength = token.match(/^(\d+(?:\.\d+)?)(mg|mcg|ml|g)?$/i);
    if (strength) {
      or.push(strength[2] ? { strengthValue: Number(strength[1]), strengthUnit: strength[2].toLowerCase() } : { strengthValue: Number(strength[1]) });
    }
    return { $or: or };
  });
  return {
    $or: [
      { barcode: text },
      { rack: text.toUpperCase() },
      tokenClauses.length === 1 ? tokenClauses[0] : { $and: tokenClauses },
    ],
  };
}
