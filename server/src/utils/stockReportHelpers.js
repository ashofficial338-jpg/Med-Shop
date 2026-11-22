import Product from "../models/Product.js";
import Batch from "../models/Batch.js";
import StockLedger from "../models/StockLedger.js";
import { cached } from "./readCache.js";
import { compositionKey, compositionLabel, strengthLabel } from "./composition.js";
import { weightedAvgCost } from "./batchHelpers.js";

function stockDisplay(product) {
  if (product.soldAs === "pack-and-loose" && product.unitsPerPack) {
    const packs = Math.floor(product.qty / product.unitsPerPack);
    const loose = product.qty % product.unitsPerPack;
    return `${packs} ${product.packUnit}${packs === 1 ? "" : "s"}${loose ? ` + ${loose} ${product.looseUnitName}${loose === 1 ? "" : "s"}` : ""}`;
  }
  return `${product.qty} ${product.packUnit}${product.qty === 1 ? "" : "s"}`;
}

// Per-product stock valuation, at cost (Σ each batch's remaining qty × its
// cost-per-internal-unit - same math already used in products.js's
// stock-clearance route) and at MRP (qty on hand × the effective selling
// rate). Returns totals across the filtered set for a report header/dashboard tile.
// `scope` is an extra Product filter (see summaryHelpers.productScope).
export function buildStockReport(options = {}) {
  return cached(`stockReport:${JSON.stringify(options)}`, () => stockReportFor(options));
}

async function stockReportFor({ category, availability, scope = {} }) {
  const filter = { isActive: true, ...scope };
  if (category) filter.category = category;
  if (availability === "available") filter.qty = { $gt: 0 };
  if (availability === "out") filter.qty = { $lte: 0 };

  let products = await Product.find(filter).populate("category", "name").populate("vendor", "name").sort({ name: 1 });
  if (availability === "low") {
    products = products.filter((p) => p.qty > 0 && p.qty <= p.lowStockThreshold);
  }

  const batches = await Batch.find({ product: { $in: products.map((p) => p._id) }, qtyRemaining: { $gt: 0 } });
  const batchesByProduct = new Map();
  for (const b of batches) {
    const key = String(b.product);
    if (!batchesByProduct.has(key)) batchesByProduct.set(key, []);
    batchesByProduct.get(key).push(b);
  }

  let totalValueCost = 0;
  let totalValueMrp = 0;

  const rows = products.map((product) => {
    const productBatches = batchesByProduct.get(String(product._id)) || [];
    const costPerUnit = (batch) =>
      product.soldAs === "pack-and-loose" ? batch.costPrice / product.unitsPerPack : batch.costPrice;
    const valueCost = Number(productBatches.reduce((sum, b) => sum + b.qtyRemaining * costPerUnit(b), 0).toFixed(2));

    const effectiveRate = product.soldAs === "pack-and-loose" ? product.looseRate : product.packRate;
    const valueMrp = Number((product.qty * effectiveRate).toFixed(2));

    const nearestExpiry = productBatches.reduce((min, b) => (b.expiryDate && (!min || b.expiryDate < min) ? b.expiryDate : min), null);
    // Purchase price per pack: the cost of the most recently received lot still on hand.
    const latestBatch = productBatches.reduce((last, b) => (!last || b.receivedAt > last.receivedAt ? b : last), null);

    totalValueCost += valueCost;
    totalValueMrp += valueMrp;

    return {
      productId: product._id,
      name: product.name,
      productCode: product.productCode,
      category: product.category?.name || "Uncategorized",
      brand: product.brand || "",
      supplier: product.vendor?.name || "",
      packRate: product.packRate,
      gstPercent: product.gstPercent,
      purchasePrice: latestBatch ? latestBatch.costPrice : null,
      // Per pack, weighted by what's still on hand from each lot (so lots
      // bought from different suppliers at different prices average correctly).
      avgCostPrice: weightedAvgCost(productBatches),
      genericName: product.genericName || "",
      composition: product.composition || "",
      strength: strengthLabel(product),
      dosageForm: product.dosageForm || "",
      releaseType: product.releaseType || "",
      manufacturer: product.manufacturer || "",
      barcode: product.barcode || "",
      compositionKey: compositionKey(product),
      compositionLabel: compositionLabel(product),
      packUnit: product.packUnit,
      packsOnHand: product.soldAs === "pack-and-loose" && product.unitsPerPack ? Number((product.qty / product.unitsPerPack).toFixed(2)) : product.qty,
      qty: product.qty,
      lowStockThreshold: product.lowStockThreshold,
      qtyDisplay: stockDisplay(product),
      isLowStock: product.qty > 0 && product.qty <= product.lowStockThreshold,
      isOut: product.qty <= 0,
      nearestExpiry,
      valueCost,
      valueMrp,
    };
  });

  return {
    rows,
    totals: {
      skuCount: rows.length,
      totalValueCost: Number(totalValueCost.toFixed(2)),
      totalValueMrp: Number(totalValueMrp.toFixed(2)),
    },
  };
}

// Inventory value at cost as it stood at a past moment `at`: each batch's
// current qtyRemaining with every stock movement from `at` onwards undone.
// Every StockLedger write carries its batch, so this rebuilds the history
// exactly. Same scope and cost-per-unit math as buildStockReport, so the
// value at "now" matches the Stock Value tile. `matches` optionally narrows it
// to products passing a test (see summaryHelpers.productMatcher).
export async function inventoryValueAt(at, matches = null) {
  const [batches, later] = await Promise.all([
    // Every valuation starts from the same batches; only the movements to
    // undo depend on `at`.
    cached("inventory:batches", () => Batch.find({}).populate("product", "soldAs unitsPerPack isActive category brand vendor")),
    cached(`inventory:movedSince:${at.getTime()}`, () =>
      StockLedger.aggregate([
        { $match: { createdAt: { $gte: at }, batch: { $ne: null } } },
        { $group: { _id: "$batch", change: { $sum: "$qtyChange" } } },
      ])
    ),
  ]);
  const changeByBatch = new Map(later.map((r) => [String(r._id), r.change]));

  let value = 0;
  for (const b of batches) {
    if (!b.product?.isActive) continue;
    if (matches && !matches(b.product)) continue;
    const qty = Math.max(b.qtyRemaining - (changeByBatch.get(String(b._id)) || 0), 0);
    const costPerUnit = b.product.soldAs === "pack-and-loose" ? b.costPrice / b.product.unitsPerPack : b.costPrice;
    value += qty * costPerUnit;
  }
  return Number(value.toFixed(2));
}

// Composition report: brands sharing a Composition Group listed together with
// a combined stock figure. Purely a read-out - each brand's own stock and
// batches are untouched. Combined stock is given per pack unit, since a
// Strip and a Bottle can't be added together.
export async function buildCompositionReport({ q = "" } = {}) {
  const { rows } = await buildStockReport({});
  const needle = String(q).trim().toLowerCase();
  const groups = new Map();
  for (const r of rows) {
    if (!r.compositionKey) continue;
    if (!groups.has(r.compositionKey)) {
      groups.set(r.compositionKey, { key: r.compositionKey, label: r.compositionLabel, composition: r.composition, strength: r.strength, dosageForm: r.dosageForm, releaseType: r.releaseType, brands: [] });
    }
    groups.get(r.compositionKey).brands.push(r);
  }
  const r2 = (n) => Number(n.toFixed(2));
  const out = [...groups.values()]
    .filter((g) => !needle || [g.label, g.composition, ...g.brands.flatMap((b) => [b.name, b.genericName, b.manufacturer])].some((t) => String(t || "").toLowerCase().includes(needle)))
    .map((g) => {
      const byUnit = new Map();
      for (const b of g.brands) byUnit.set(b.packUnit, (byUnit.get(b.packUnit) || 0) + b.packsOnHand);
      const combinedStock = [...byUnit.entries()].map(([unit, packs]) => ({ unit, packs: r2(packs) }));
      return {
        ...g,
        brandCount: g.brands.length,
        brandsInStock: g.brands.filter((b) => b.qty > 0).length,
        combinedStock,
        combinedStockDisplay: combinedStock.map((c) => `${c.packs} ${c.unit}${c.packs === 1 ? "" : "s"}`).join(" + ") || "0",
        valueCost: r2(g.brands.reduce((s, b) => s + b.valueCost, 0)),
        valueMrp: r2(g.brands.reduce((s, b) => s + b.valueMrp, 0)),
        brands: g.brands.map((b) => ({
          productId: b.productId, name: b.name, productCode: b.productCode, manufacturer: b.manufacturer || b.brand,
          qtyDisplay: b.qtyDisplay, packsOnHand: b.packsOnHand, packUnit: b.packUnit, packRate: b.packRate,
          avgCostPrice: b.avgCostPrice, nearestExpiry: b.nearestExpiry, valueCost: b.valueCost, valueMrp: b.valueMrp,
        })),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  return out;
}
