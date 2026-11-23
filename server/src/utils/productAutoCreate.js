import Product from "../models/Product.js";
import { generateProductCode, resolveCategory } from "./productHelpers.js";

// Products typed in on Purchase Entry: an existing product is
// reused, a new name is added to the Product List (Product Master) when the
// entry is saved - no separate trip to Products needed.
//
// Duplicates: names are compared ignoring case, spaces and punctuation, so
// "Dolo 650", "dolo650" and "DOLO-650" are one product. similarProducts()
// lists near matches (a typo or two) so the form can offer them first.

export const PACK_UNITS = ["Strip", "Bottle", "Box", "Tube", "Vial", "Jar", "Piece"];
const GST_VALUES = [0, 5, 12, 18, 28];

export const normalizeName = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// "strip", "STRIPS", "tab" -> a Product pack unit; anything else -> Strip
// (the default Add Product uses).
export function toPackUnit(unit) {
  const u = String(unit || "").trim().toLowerCase().replace(/s$/, "");
  const alias = { tab: "Strip", tablet: "Strip", nos: "Piece", no: "Piece", pc: "Piece", pcs: "Piece", unit: "Piece", btl: "Bottle", pack: "Box", pkt: "Box", packet: "Box" };
  return PACK_UNITS.find((p) => p.toLowerCase() === u) || alias[u] || "Strip";
}

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

const FIELDS = "name productCode hsnCode gstPercent packUnit packRate isActive";
const activeProducts = () => Product.find({ isActive: true }, FIELDS).lean();

// The active product with this name (ignoring case/spaces/punctuation), or null.
export async function findProductByName(name, list) {
  const key = normalizeName(name);
  if (!key) return null;
  return (list || (await activeProducts())).find((p) => normalizeName(p.name) === key) || null;
}

// Products whose names are the same or close to `name`: exact first, then
// one containing the other, then small typos. At most `limit`.
export async function similarProducts(name, limit = 5) {
  const key = normalizeName(name);
  if (key.length < 2) return [];
  const scored = [];
  for (const p of await activeProducts()) {
    const n = normalizeName(p.name);
    if (!n) continue;
    let score = null;
    if (n === key) score = 0;
    else if (key.length >= 3 && (n.includes(key) || key.includes(n))) score = 1;
    else {
      const d = editDistance(n, key);
      if (d <= Math.max(1, Math.floor(key.length / 5))) score = 1 + d;
    }
    if (score !== null) scored.push({ p, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.p.name.localeCompare(b.p.name))
    .slice(0, limit)
    .map(({ p, score }) => ({ ...p, exact: score === 0 }));
}

// Finds the product for a typed line, creating it when it's new.
// `details`: { hsnCode, unit, gstPercent, rate, vendor }. Returns
// { product, created }. `cache` (a Map) lets one entry with the same new name
// on several lines create it only once.
export async function findOrCreateProduct(name, details = {}, cache = new Map()) {
  const clean = String(name || "").trim().replace(/\s+/g, " ").slice(0, 150);
  const key = normalizeName(clean);
  if (!key) throw new Error("Product name is empty.");
  if (cache.has(key)) return { product: cache.get(key), created: false };

  const existing = await Product.findOne({ _id: (await findProductByName(clean))?._id ?? null });
  if (existing) {
    // Fill in an HSN code the product didn't have yet; nothing else on an
    // existing product is changed (its price/GST drive POS billing).
    const hsn = String(details.hsnCode || "").trim();
    if (hsn && !existing.hsnCode) {
      existing.hsnCode = hsn;
      await existing.save();
    }
    cache.set(key, existing);
    return { product: existing, created: false };
  }

  const gst = Number(details.gstPercent);
  const rate = Number(details.rate);
  const category = await resolveCategory("Uncategorized");
  const product = await Product.create({
    name: clean,
    productCode: await generateProductCode(clean),
    category: category._id,
    soldAs: "pack-only",
    packUnit: toPackUnit(details.unit),
    hsnCode: String(details.hsnCode || "").trim().slice(0, 20),
    gstPercent: GST_VALUES.includes(gst) ? gst : 0,
    packRate: rate >= 0 && Number.isFinite(rate) ? rate : 0,
    qty: 0,
    vendor: details.vendor || null,
  });
  cache.set(key, product);
  return { product, created: true };
}
