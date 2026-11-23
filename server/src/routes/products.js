import mongoose from "mongoose";
import { Router } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import Product from "../models/Product.js";
import Batch from "../models/Batch.js";
import StockLedger from "../models/StockLedger.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { requirePermission } from "../utils/permissions.js";
import { uploadProductImage, uploadedImageUrl } from "../middleware/upload.js";
import { generateProductCode, resolveCategory, computeLooseRate, deriveSoldAs } from "../utils/productHelpers.js";
import { computeInternalQty as computeQty } from "../utils/stockUnits.js";
import { upsertBatch } from "../utils/batchHelpers.js";
import { cleanRack, rackPositionError } from "../utils/rack.js";
import { buildStockReport, buildCompositionReport } from "../utils/stockReportHelpers.js";
import Purchase from "../models/Purchase.js";
import { DOSAGE_FORMS, RELEASE_TYPES, compositionKey, compositionLabel, productSearchFilter } from "../utils/composition.js";
import { weightedAvgCost, locationsByProduct } from "../utils/batchHelpers.js";
import { effectiveLocations } from "../utils/locations.js";
import { similarProducts } from "../utils/productAutoCreate.js";

// One ledger row per rack position a write-off came from, so each rack's
// history shows it. costImpact is split by quantity.
async function ledgerPerLocation(batch, base, totalQty, costImpact = 0) {
  const locs = effectiveLocations({ ...batch.toObject(), qtyRemaining: totalQty });
  const parts = locs.length ? locs : [{ rack: batch.rack || "", qty: totalQty }];
  for (const l of parts) {
    await StockLedger.create({
      ...base,
      qtyChange: -l.qty,
      rack: l.rack,
      ...(costImpact ? { costImpact: Number(((costImpact * l.qty) / totalQty).toFixed(2)) } : {}),
    });
  }
}
import { streamExcelReport, streamPdfReport } from "../utils/reportExport.js";

const router = Router();
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const PACK_UNITS = ["Strip", "Bottle", "Box", "Tube", "Vial", "Jar", "Piece"];
const LOOSE_UNITS = ["Tablet", "Capsule", "ml", "Piece"];
const GST_VALUES = [0, 5, 12, 18, 28];

function stripCostPriceIfStaff(product, role) {
  const obj = product.toObject ? product.toObject() : product;
  if (role === "staff") delete obj.costPrice;
  return obj;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Brand-level medicine details (see Product model). Strings can be cleared to "".
const MEDICINE_TEXT_FIELDS = ["genericName", "composition", "manufacturer", "barcode"];
function medicineFields(b) {
  const out = {};
  for (const f of MEDICINE_TEXT_FIELDS) if (b[f] !== undefined) out[f] = String(b[f] ?? "").trim();
  if (b.dosageForm !== undefined) {
    if (!DOSAGE_FORMS.includes(b.dosageForm || "")) return { error: "Please choose a valid dosage form." };
    out.dosageForm = b.dosageForm || "";
  }
  if (b.releaseType !== undefined) {
    if (!RELEASE_TYPES.includes(b.releaseType || "")) return { error: "Please choose a valid release type." };
    out.releaseType = b.releaseType || "";
  }
  return { fields: out };
}

// One master product per medicine: a second product with the same name (or
// the same barcode) is refused - more stock goes onto the existing one.
async function duplicateProductError({ name, barcode }, excludeId = null) {
  const notSelf = excludeId ? { _id: { $ne: excludeId } } : {};
  if (name) {
    const dup = await Product.findOne({ isActive: true, name: new RegExp(`^${escapeRegex(String(name).trim())}$`, "i"), ...notSelf }, "name productCode");
    if (dup) return `"${dup.name}" already exists (${dup.productCode}). Add stock to it with a purchase instead of creating a duplicate.`;
  }
  if (barcode) {
    const dup = await Product.findOne({ isActive: true, barcode, ...notSelf }, "name productCode");
    if (dup) return `This barcode is already used by ${dup.name} (${dup.productCode}).`;
  }
  return null;
}

// Add Product with every field optional: blanks become safe defaults rather
// than errors. nameGiven tells whether to auto-name it after its code.
function productDefaults(body) {
  const b = { ...body };
  b.nameGiven = Boolean(String(b.name || "").trim());
  b.name = String(b.name || "").trim();
  if (!b.category || !String(b.category).trim()) b.category = "Uncategorized";
  if (!b.packUnit) b.packUnit = "Strip";
  if (b.gstPercent === undefined || b.gstPercent === null || b.gstPercent === "") b.gstPercent = 0;
  if (b.packRate === undefined || b.packRate === null || b.packRate === "" || !(Number(b.packRate) >= 0)) b.packRate = 0;
  return b;
}

// Adds the derived Composition Group so lists can group brands together.
function withGroup(obj) {
  return { ...obj, compositionKey: compositionKey(obj), compositionLabel: compositionLabel(obj) };
}

function availabilityFilter(filter, availability) {
  if (availability === "available") filter.qty = { $gt: 0 };
  if (availability === "out") filter.qty = { $lte: 0 };
  // "low" is computed post-query since it depends on a per-doc threshold comparison
}

// Attaches nearestExpiry (earliest active batch) and batchCount to each
// product, for tile/list display - a product can now have several lots on
// the shelf at once, so there's no single "the" expiry date to show anymore.
async function withBatchSummary(products) {
  const ids = products.map((p) => p._id);
  const rows = await Batch.aggregate([
    { $match: { product: { $in: ids }, qtyRemaining: { $gt: 0 } } },
    { $group: { _id: "$product", nearestExpiry: { $min: "$expiryDate" }, batchCount: { $sum: 1 } } },
  ]);
  const byProduct = new Map(rows.map((r) => [String(r._id), r]));
  // Every rack position each product's stock sits on (multi-location).
  const locs = locationsByProduct(await Batch.find({ product: { $in: ids }, qtyRemaining: { $gt: 0 } }, "product rack locations qtyRemaining"));
  return products.map((p) => {
    const obj = p.toObject ? p.toObject() : p;
    const summary = byProduct.get(String(obj._id));
    obj.nearestExpiry = summary?.nearestExpiry || null;
    obj.batchCount = summary?.batchCount || 0;
    obj.locations = locs.get(String(obj._id)) || [];
    return obj;
  });
}

// Shared by the product list and its filter options. Every filter is
// optional; status (active / deleted / all) is admin-only.
function productListFilter(req) {
  const { category, vendor, rack, brand, dosageForm, minPrice, maxPrice, status } = req.query;
  const filter = { isActive: true };
  if (req.user.role === "admin" && status === "inactive") filter.isActive = false;
  if (req.user.role === "admin" && status === "all") delete filter.isActive;
  if (category) filter.category = category;
  if (rack !== undefined) filter.rack = String(rack).trim().toUpperCase();
  if (vendor) filter.vendor = vendor;
  // Brand matches either the manufacturer or the marketing company.
  if (brand) {
    const re = new RegExp(`^${escapeRegex(String(brand).trim())}$`, "i");
    filter.$and = [...(filter.$and || []), { $or: [{ manufacturer: re }, { brand: re }] }];
  }
  if (dosageForm) filter.dosageForm = dosageForm;
  const min = minPrice === undefined || minPrice === "" ? NaN : Number(minPrice);
  const max = maxPrice === undefined || maxPrice === "" ? NaN : Number(maxPrice);
  if (!Number.isNaN(min) || !Number.isNaN(max)) {
    filter.packRate = {};
    if (!Number.isNaN(min)) filter.packRate.$gte = min;
    if (!Number.isNaN(max)) filter.packRate.$lte = max;
  }
  return filter;
}

// Which optional filters are worth showing: only brands / dosage forms that
// real products have, and the actual price range.
router.get("/filter-options", requireAuth, async (req, res) => {
  const base = { isActive: true };
  const [brands, makers, forms, range] = await Promise.all([
    Product.distinct("brand", base),
    Product.distinct("manufacturer", base),
    Product.distinct("dosageForm", base),
    Product.aggregate([{ $match: base }, { $group: { _id: null, min: { $min: "$packRate" }, max: { $max: "$packRate" } } }]),
  ]);
  const seen = new Map();
  for (const b of [...makers, ...brands]) {
    const name = String(b || "").trim();
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  res.json({
    brands: [...seen.values()].sort((a, b) => a.localeCompare(b)),
    dosageForms: forms.filter(Boolean).sort(),
    price: range[0] ? { min: range[0].min, max: range[0].max } : null,
    hasInactive: req.user.role === "admin" ? Boolean(await Product.exists({ isActive: false })) : false,
  });
});

router.get("/", requireAuth, async (req, res) => {
  const { q, availability } = req.query;
  const filter = productListFilter(req);

  // Brand name, generic name, composition, strength, manufacturer, code,
  // barcode or rack - see utils/composition.js.
  const search = productSearchFilter(q);
  if (search) filter.$and = [...(filter.$and || []), search];
  availabilityFilter(filter, availability);

  let products = await Product.find(filter).populate("category", "name").populate("vendor", "name").sort({ createdAt: -1 });

  if (availability === "low") {
    products = products.filter((p) => p.qty > 0 && p.qty <= p.lowStockThreshold);
  }

  const withBatches = await withBatchSummary(products);
  res.json(withBatches.map((p) => withGroup(stripCostPriceIfStaff(p, req.user.role))));
});

// Brands grouped by Composition Group with their combined stock. Read-only:
// individual brand stock is never merged. ?q filters groups; ?format exports.
// Products with the same or a close name (ignoring case, spaces and
// punctuation) - Sales/Purchase Entry show these before a new product is
// added, so the same medicine isn't created twice.
router.get("/similar", requireAuth, async (req, res) => {
  res.json(await similarProducts(String(req.query.name || "").slice(0, 150), 5));
});

router.get("/composition-report", requireAuth, requireRole("admin"), async (req, res) => {
  const { q, format } = req.query;
  const groups = await buildCompositionReport({ q });
  const flat = groups.flatMap((g) =>
    g.brands.map((b, i) => ({
      group: i === 0 ? g.label : "",
      combined: i === 0 ? g.combinedStockDisplay : "",
      brand: b.name,
      code: b.productCode,
      manufacturer: b.manufacturer,
      stock: b.qtyDisplay,
      rate: b.packRate,
      avgCost: b.avgCostPrice ?? "",
      valueCost: b.valueCost,
      valueMrp: b.valueMrp,
    }))
  );
  const subtitle = `${groups.length} composition groups · ${flat.length} brands · combined stock is informational; each brand keeps its own stock`;
  if (format === "pdf") {
    return streamPdfReport(res, "GuganMedicals_Composition_Report.pdf", {
      title: "Gugan Medicals - Composition Report",
      subtitle,
      columns: [
        { header: "Composition", key: "group" },
        { header: "Combined Stock", key: "combined" },
        { header: "Brand", key: "brand" },
        { header: "Manufacturer", key: "manufacturer" },
        { header: "Stock", key: "stock" },
        { header: "Rate", key: "rate", align: "right" },
      ],
      rows: flat,
    });
  }
  if (format === "excel") {
    return streamExcelReport(res, "GuganMedicals_Composition_Report.xlsx", [
      {
        name: "Composition Report",
        columns: [
          { header: "Composition Group", key: "group", width: 34 },
          { header: "Combined Stock", key: "combined", width: 20 },
          { header: "Brand", key: "brand", width: 24 },
          { header: "Code", key: "code", width: 12 },
          { header: "Manufacturer", key: "manufacturer", width: 18 },
          { header: "Stock", key: "stock", width: 20 },
          { header: "Selling Price", key: "rate", width: 12 },
          { header: "Avg Cost", key: "avgCost", width: 12 },
          { header: "Value (Cost)", key: "valueCost", width: 14 },
          { header: "Value (MRP)", key: "valueMrp", width: 14 },
        ],
        rows: flat,
      },
    ]);
  }
  res.json(groups);
});

// Registered before GET "/:id" - both are single-segment GET routes, and Express
// matches in registration order, so this must come first or "/:id" would treat
// "expiry-tracker" as an id.
const EXPIRING_SOON_WINDOW_DAYS = 30;

router.get("/expiry-tracker", requireAuth, requireRole("admin"), async (req, res) => {
  const now = new Date();
  const soonCutoff = new Date(now.getTime() + EXPIRING_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const batches = await Batch.find({ qtyRemaining: { $gt: 0 } })
    .populate({ path: "product", select: "name productCode isActive", match: { isActive: true } })
    .sort({ expiryDate: 1 });

  const expired = [];
  const expiringSoon = [];
  const ok = [];

  for (const b of batches) {
    if (!b.product) continue; // product deactivated since - skip from the tracker
    if (!b.expiryDate) ok.push(b); // no expiry entered - never flagged
    else if (b.expiryDate < now) expired.push(b);
    else if (b.expiryDate <= soonCutoff) expiringSoon.push(b);
    else ok.push(b);
  }

  res.json({ expired, expiringSoon, ok, windowDays: EXPIRING_SOON_WINDOW_DAYS });
});

router.get("/expiry-tracker/export", requireAuth, requireRole("admin"), async (req, res) => {
  const now = new Date();
  const soonCutoff = new Date(now.getTime() + EXPIRING_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const batches = await Batch.find({ qtyRemaining: { $gt: 0 } })
    .populate({ path: "product", select: "name productCode isActive", match: { isActive: true } })
    .sort({ expiryDate: 1 })
    .lean();

  const rows = batches
    .filter((b) => b.product)
    .map((b) => {
      const status = !b.expiryDate ? "No expiry" : b.expiryDate < now ? "Expired" : b.expiryDate <= soonCutoff ? "Expiring Soon" : "OK";
      const daysLeft = b.expiryDate ? Math.ceil((b.expiryDate - now) / (24 * 60 * 60 * 1000)) : "";
      return {
        status,
        product: b.product.name,
        productCode: b.product.productCode,
        batchNo: b.batchNo,
        expiryDate: b.expiryDate ? b.expiryDate.toISOString().slice(0, 10) : "",
        daysLeft,
        qtyRemaining: b.qtyRemaining,
        costPrice: b.costPrice ?? "",
        valueAtCost: Number(((b.costPrice || 0) * b.qtyRemaining).toFixed(2)),
      };
    });
  const count = (s) => rows.filter((r) => r.status === s).length;
  const subtitle = `Expired: ${count("Expired")} · Expiring within ${EXPIRING_SOON_WINDOW_DAYS} days: ${count("Expiring Soon")} · OK: ${count("OK")}`;

  if (req.query.format === "pdf") {
    return streamPdfReport(res, "GuganMedicals_Expiry_Tracker.pdf", {
      title: "Gugan Medicals - Expiry Tracker",
      subtitle,
      columns: [
        { header: "Status", key: "status" },
        { header: "Product", key: "product", flex: 2 },
        { header: "Code", key: "productCode" },
        { header: "Batch", key: "batchNo" },
        { header: "Expiry", key: "expiryDate" },
        { header: "Days Left", key: "daysLeft", align: "right", flex: 0.7 },
        { header: "Qty", key: "qtyRemaining", align: "right", flex: 0.6 },
      ],
      rows,
    });
  }

  return streamExcelReport(res, "GuganMedicals_Expiry_Tracker.xlsx", [
    {
      name: "Expiry Tracker",
      columns: [
        { header: "Status", key: "status", width: 14 },
        { header: "Product", key: "product", width: 28 },
        { header: "Code", key: "productCode", width: 12 },
        { header: "Batch", key: "batchNo", width: 14 },
        { header: "Expiry Date", key: "expiryDate", width: 14 },
        { header: "Days Left", key: "daysLeft", width: 10 },
        { header: "Qty Remaining", key: "qtyRemaining", width: 14 },
        { header: "Cost Price", key: "costPrice", width: 12 },
        { header: "Value at Cost", key: "valueAtCost", width: 14 },
      ],
      rows,
    },
  ]);
});

// Registered before GET "/:id" for the same reason as "/expiry-tracker" above.
router.get("/stock-report", requireAuth, requireRole("admin"), async (req, res) => {
  const { category, availability, format } = req.query;
  const { rows, totals } = await buildStockReport({ category, availability });

  if (format === "pdf") {
    return streamPdfReport(res, "GuganMedicals_Stock_Report.pdf", {
      title: "Gugan Medicals - Stock Report",
      subtitle: `${totals.skuCount} SKUs · Value at cost: Rs. ${totals.totalValueCost.toFixed(2)} · Value at MRP: Rs. ${totals.totalValueMrp.toFixed(2)}`,
      columns: [
        { header: "Product", key: "name" },
        { header: "Code", key: "productCode" },
        { header: "Category", key: "category" },
        { header: "Qty on Hand", key: "qtyDisplay" },
        { header: "Value (Cost)", key: "valueCostDisplay", align: "right" },
        { header: "Value (MRP)", key: "valueMrpDisplay", align: "right" },
      ],
      rows: rows.map((r) => ({
        ...r,
        valueCostDisplay: `Rs. ${r.valueCost.toFixed(2)}`,
        valueMrpDisplay: `Rs. ${r.valueMrp.toFixed(2)}`,
      })),
    });
  }

  if (format === "excel") {
    return streamExcelReport(res, "GuganMedicals_Stock_Report.xlsx", [
      {
        name: "Stock Report",
        columns: [
          { header: "Product", key: "name", width: 28 },
          { header: "Code", key: "productCode", width: 14 },
          { header: "Category", key: "category", width: 18 },
          { header: "Qty on Hand", key: "qtyDisplay", width: 22 },
          { header: "Low Stock", key: "isLowStock", width: 12 },
          { header: "Out of Stock", key: "isOut", width: 12 },
          { header: "Nearest Expiry", key: "nearestExpiry", width: 16 },
          { header: "Avg Cost / Pack", key: "avgCostPrice", width: 14 },
          { header: "Value (Cost)", key: "valueCost", width: 14 },
          { header: "Value (MRP)", key: "valueMrp", width: 14 },
        ],
        rows: rows.map((r) => ({ ...r, nearestExpiry: r.nearestExpiry ? r.nearestExpiry.toISOString().slice(0, 10) : "" })),
      },
    ]);
  }

  res.json({ rows, totals });
});

router.post("/stock-clearance", requireAuth, requireRole("admin"), async (req, res) => {
  const { batchIds } = req.body;
  if (!Array.isArray(batchIds) || batchIds.length === 0) {
    return res.status(400).json({ message: "Please select at least one item." });
  }

  const cleared = [];
  for (const id of batchIds) {
    const batch = await Batch.findById(id).populate("product");
    if (!batch || !batch.product || batch.qtyRemaining <= 0) continue;

    const product = batch.product;
    const qtyWrittenOff = batch.qtyRemaining;
    const costPerUnit = product.soldAs === "pack-and-loose" ? batch.costPrice / product.unitsPerPack : batch.costPrice;
    const costImpact = Number((qtyWrittenOff * costPerUnit).toFixed(2));

    await ledgerPerLocation(
      batch,
      { product: product._id, batch: batch._id, type: "stock-clearance", reason: "Expired - written off", performedBy: req.user._id },
      qtyWrittenOff,
      costImpact
    );

    batch.qtyRemaining = 0;
    await batch.save();
    await Product.updateOne({ _id: product._id }, { $inc: { qty: -qtyWrittenOff } });

    cleared.push({ batchId: batch._id, productName: product.name, batchNo: batch.batchNo, qtyWrittenOff, costImpact });
  }

  res.json({ cleared });
});

router.get("/:id", requireAuth, async (req, res) => {
  const product = await Product.findById(req.params.id).populate("category", "name").populate("vendor", "name");
  if (!product) return res.status(404).json({ message: "No records found." });
  const obj = withGroup(stripCostPriceIfStaff(product, req.user.role));
  obj.locations = locationsByProduct(await Batch.find({ product: product._id, qtyRemaining: { $gt: 0 } })).get(String(product._id)) || [];
  if (req.user.role === "admin") {
    obj.avgCostPrice = weightedAvgCost(await Batch.find({ product: product._id, qtyRemaining: { $gt: 0 } }));
  }
  res.json(obj);
});

// Lots that can be sold right now, earliest expiry first - for picking an
// exact batch at checkout. No cost prices, so any signed-in user may see it.
router.get("/:id/sale-batches", requireAuth, async (req, res) => {
  const batches = await Batch.find({ product: req.params.id, qtyRemaining: { $gt: 0 }, isDeleted: { $ne: true } }, "batchNo expiryDate qtyRemaining rack locations").sort({ expiryDate: 1 });
  // Positions in pick order, so checkout can show staff exactly where to pick.
  res.json(batches.map((b) => ({ _id: b._id, batchNo: b.batchNo, expiryDate: b.expiryDate, qtyRemaining: b.qtyRemaining, rack: b.rack, locations: effectiveLocations(b) })));
});

// Every purchase of this product, from any supplier (registered,
// unregistered or none), plus a per-supplier summary and the weighted
// average purchase cost - all on the one master product.
router.get("/:id/purchases", requireAuth, requireRole("admin"), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "No records found." });
  const productId = new mongoose.Types.ObjectId(req.params.id);
  const purchases = await Purchase.find({ "items.product": productId }).populate("vendor", "name").sort({ date: -1, createdAt: -1 });
  const lines = [];
  for (const p of purchases) {
    const supplier = p.vendor ? p.vendor.name || "Unknown supplier" : p.supplierName || "";
    const supplierType = p.vendor ? "registered" : p.supplierName ? "unregistered" : "none";
    for (const item of p.items) {
      if (String(item.product) !== String(productId)) continue;
      lines.push({
        purchaseId: p._id,
        date: p.date,
        invoiceNo: p.invoiceNo,
        supplier: supplier || "No supplier",
        supplierType,
        vendorId: p.vendor?._id || null,
        qtyPacks: item.qtyPacks,
        costPrice: item.costPrice,
        previousCostPrice: item.previousCostPrice ?? null,
        rack: item.rack || "",
        lineAmount: item.lineAmount,
        batchNo: item.batchNo,
        expiryDate: item.expiryDate,
      });
    }
  }
  const bySupplier = new Map();
  for (const l of lines) {
    const key = `${l.supplierType}:${l.vendorId || l.supplier.toLowerCase()}`;
    const s = bySupplier.get(key) || { supplier: l.supplier, supplierType: l.supplierType, vendorId: l.vendorId, purchases: 0, qtyPacks: 0, amount: 0, lastPrice: l.costPrice, lastDate: l.date };
    s.purchases += 1;
    s.qtyPacks += l.qtyPacks;
    s.amount += l.lineAmount;
    bySupplier.set(key, s);
  }
  const r2 = (n) => Number(n.toFixed(2));
  const totalQty = lines.reduce((s, l) => s + l.qtyPacks, 0);
  const totalAmount = lines.reduce((s, l) => s + l.lineAmount, 0);
  res.json({
    lines,
    suppliers: [...bySupplier.values()].map((s) => ({ ...s, amount: r2(s.amount), avgPrice: s.qtyPacks > 0 ? r2(s.amount / s.qtyPacks) : null })).sort((a, b) => b.qtyPacks - a.qtyPacks),
    // Across every purchase ever made of this product.
    avgPurchasePrice: totalQty > 0 ? r2(totalAmount / totalQty) : null,
    // Of the stock still on hand (what inventory is valued at).
    avgCostOnHand: weightedAvgCost(await Batch.find({ product: productId, qtyRemaining: { $gt: 0 } })),
  });
});

// Full batch breakdown for a product - Batch No / Expiry / Qty Remaining /
// Received Date / Cost - used by the Product Detail panel, Stock Management,
// and the batch pickers in Adjust Stock. Admins, plus anyone allowed to edit
// or delete stock; cost price is only sent to admins.
router.get("/:id/batches", requireAuth, requireRole("admin"), async (req, res) => {
  const batches = await Batch.find({
    product: req.params.id,
    qtyReceived: { $gt: 0 },
    // A deleted batch disappears, unless stock has since come back into it (e.g. a voided sale).
    $or: [{ isDeleted: { $ne: true } }, { qtyRemaining: { $gt: 0 } }],
  }).sort({ expiryDate: 1 });
  res.json(batches.map((b) => ({ ...stripCostPriceIfStaff(b, req.user.role), locations: effectiveLocations(b) })));
});

async function findStockEntry(req, res) {
  const product = await Product.findById(req.params.id);
  const batch = product && (await Batch.findOne({ _id: req.params.batchId, product: product._id }));
  if (!product || !batch) {
    res.status(404).json({ message: "No records found." });
    return {};
  }
  return { product, batch };
}

// Edit one stock entry (batch). A quantity change moves Product.qty by the
// same amount and is recorded in the stock ledger like a manual adjustment.
router.patch("/:id/batches/:batchId", requireAuth, requireRole("admin"), async (req, res) => {
  const { product, batch } = await findStockEntry(req, res);
  if (!batch) return;
  const b = req.body;

  // A blank batch number keeps the current one.
  if (b.batchNo !== undefined && String(b.batchNo).trim()) {
    const batchNo = String(b.batchNo).trim();
    if (batchNo.length > 30) return res.status(400).json({ message: "Batch No can be up to 30 characters." });
    if (batchNo !== batch.batchNo && (await Batch.exists({ product: product._id, batchNo, _id: { $ne: batch._id } }))) {
      return res.status(409).json({ message: "This product already has a batch with that number." });
    }
    batch.batchNo = batchNo;
  }
  if (b.expiryDate !== undefined) {
    // Blank clears the expiry (it's optional).
    if (b.expiryDate === "" || b.expiryDate === null) batch.expiryDate = null;
    else {
      const expiry = new Date(b.expiryDate);
      if (Number.isNaN(expiry.getTime())) return res.status(400).json({ message: "Please enter a valid date." });
      batch.expiryDate = expiry;
    }
  }
  if (b.costPrice !== undefined && req.user.role === "admin") {
    const cost = Number(b.costPrice);
    if (!(cost >= 0)) return res.status(400).json({ message: "Please enter a valid number." });
    batch.costPrice = cost;
  }
  let delta = 0;
  const locationsBefore = effectiveLocations(batch);
  if (b.qtyRemaining !== undefined) {
    const qty = Number(b.qtyRemaining);
    if (!Number.isInteger(qty) || qty < 0) return res.status(400).json({ message: "Please enter a valid number." });
    delta = qty - batch.qtyRemaining;
    batch.qtyRemaining = qty;
    if (qty > batch.qtyReceived) batch.qtyReceived = qty;
  }
  if (b.rack !== undefined) {
    const rackError = await rackPositionError(b.rack, { required: false });
    if (rackError) return res.status(400).json({ message: rackError });
    const newRack = cleanRack(b.rack);
    // Changing a stock entry's rack moves all of this batch's stock there.
    const moved = locationsBefore.filter((l) => l.rack !== newRack);
    batch.rack = newRack;
    batch.locations = batch.qtyRemaining > 0 ? [{ rack: newRack, qty: batch.qtyRemaining }] : [];
    product.rack = batch.rack; // the product is found where its stock was just moved to
    for (const l of moved) {
      await StockLedger.create({
        product: product._id,
        batch: batch._id,
        type: "rack-transfer",
        qtyChange: 0,
        qtyMoved: l.qty,
        rack: l.rack,
        toRack: newRack,
        reason: `Stock entry ${batch.batchNo} moved`,
        performedBy: req.user._id,
      });
    }
  }

  await batch.save();
  if (delta) {
    product.qty = Math.max(0, product.qty + delta);
    await StockLedger.create({
      product: product._id,
      batch: batch._id,
      type: delta > 0 ? "manual-add" : "manual-reduce",
      qtyChange: delta,
      rack: batch.rack || "",
      reason: `Stock entry ${batch.batchNo} edited`,
      performedBy: req.user._id,
    });
  }
  await product.save();
  res.json(stripCostPriceIfStaff(batch, req.user.role));
});

// Delete one stock entry: whatever is left in it is written off (ledger
// entry + Product.qty), and the batch is hidden. The record itself stays,
// since past sales and purchases point at it.
router.delete("/:id/batches/:batchId", requireAuth, requireRole("admin"), async (req, res) => {
  const { product, batch } = await findStockEntry(req, res);
  if (!batch) return;
  const removed = batch.qtyRemaining;
  if (removed > 0) {
    await ledgerPerLocation(
      batch,
      { product: product._id, batch: batch._id, type: "manual-reduce", reason: `Stock entry ${batch.batchNo} deleted`, performedBy: req.user._id },
      removed
    );
  }

  batch.qtyRemaining = 0;
  batch.isDeleted = true;
  await batch.save();
  if (removed > 0) {
    product.qty = Math.max(0, product.qty - removed);
    await product.save();
  }
  res.json({ message: `Stock entry ${batch.batchNo} deleted.`, qtyRemoved: removed });
});

router.post("/", requireAuth, requirePermission("products.add"), (req, res) => {
  uploadProductImage(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.message });

    try {
      // Every field is optional; blanks get safe defaults (see productDefaults).
      const b = productDefaults(req.body);
      const category = await resolveCategory(b.category);
      if (!PACK_UNITS.includes(b.packUnit)) return res.status(400).json({ message: "Please choose a valid pack unit." });
      const soldAs = deriveSoldAs(b.unitsPerPack);
      if (soldAs === "pack-and-loose" && !LOOSE_UNITS.includes(b.looseUnitName)) b.looseUnitName = "Piece";
      if (!GST_VALUES.includes(Number(b.gstPercent))) return res.status(400).json({ message: "Please choose a valid GST rate." });

      const medicine = medicineFields(b);
      if (medicine.error) return res.status(400).json({ message: medicine.error });
      const duplicate = await duplicateProductError({ name: b.nameGiven ? b.name : null, barcode: medicine.fields.barcode });
      if (duplicate) return res.status(409).json({ message: duplicate });

      const qty = computeQty({ ...b, soldAs });
      const rack = cleanRack(b.rack);
      const rackError = await rackPositionError(b.rack, { required: false });
      if (rackError) return res.status(400).json({ message: rackError });
      const productCode = await generateProductCode(b.name || "");
      if (!b.nameGiven) b.name = `Product ${productCode}`;
      const looseRate = computeLooseRate({ soldAs, packRate: b.packRate, unitsPerPack: b.unitsPerPack });

      const product = await Product.create({
        name: b.name,
        brand: b.brand || "",
        productCode,
        category: category._id,
        image: uploadedImageUrl(req.file) || "",
        strengthValue: b.strengthValue || undefined,
        strengthUnit: b.strengthUnit || "",
        soldAs,
        packUnit: b.packUnit,
        unitsPerPack: soldAs === "pack-and-loose" ? b.unitsPerPack : undefined,
        looseUnitName: soldAs === "pack-and-loose" ? b.looseUnitName : "",
        qty,
        packRate: b.packRate,
        looseRate,
        gstPercent: b.gstPercent,
        hsnCode: b.hsnCode || "",
        lowStockThreshold: b.lowStockThreshold ?? 10,
        rack,
        vendor: b.vendor || null,
        ...medicine.fields,
      });

      // Opening stock: creates this product's first batch/lot, if any was
      // entered. Batch no, expiry and cost are optional.
      if (qty > 0) {
        await upsertBatch({
          product,
          batchNo: String(b.batchNo || "").trim() || `OPEN-${productCode}`,
          expiryDate: b.expiryDate || null,
          costPrice: Number(b.costPrice) || 0,
          addQty: qty,
          receivedAt: new Date(),
          rack,
        });
      }

      const populated = await product.populate(["category", "vendor"].map((path) => ({ path, select: "name" })));
      res.status(201).json(withGroup(stripCostPriceIfStaff(populated, req.user.role)));
    } catch (e) {
      if (e.name === "ValidationError") {
        return res.status(400).json({ message: Object.values(e.errors)[0].message });
      }
      res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  });
});

router.patch("/:id", requireAuth, requireRole("admin"), (req, res) => {
  uploadProductImage(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.message });

    try {
      const product = await Product.findById(req.params.id);
      if (!product) return res.status(404).json({ message: "No records found." });

      const b = req.body;
      // Conflicting edits: the form sends the values it was opened with. If
      // someone else changed any of them since, don't overwrite their change.
      if (b.expected) {
        let expected = {};
        try {
          expected = JSON.parse(b.expected);
        } catch {
          /* ignore a malformed snapshot */
        }
        const changed = ["name", "packRate", "gstPercent", "hsnCode", "packUnit"].filter(
          (k) => k in expected && String(expected[k] ?? "") !== String(product[k] ?? "")
        );
        if (changed.length) {
          return res.status(409).json({ message: `${product.name} was changed by another user while you were editing (${changed.join(", ")}). Close this form and open it again to see the latest values.` });
        }
        delete b.expected;
      }

      if (b.category) {
        const category = await resolveCategory(b.category);
        if (category) product.category = category._id;
      }
      if (b.vendor !== undefined) {
        product.vendor = b.vendor || null;
      }
      // Outside the field loop below so a brand can be cleared to "".
      if (b.brand !== undefined) product.brand = b.brand;
      const medicine = medicineFields(b);
      if (medicine.error) return res.status(400).json({ message: medicine.error });
      const duplicate = await duplicateProductError(
        { name: b.name && b.name.trim().toLowerCase() !== product.name.toLowerCase() ? b.name : null, barcode: medicine.fields.barcode },
        product._id
      );
      if (duplicate) return res.status(409).json({ message: duplicate });
      Object.assign(product, medicine.fields);
      // Handled apart from the field loop below so a rack can be cleared to "".
      if (b.rack !== undefined) {
        const rack = cleanRack(b.rack);
        const rackError = await rackPositionError(b.rack, { required: false });
        if (rackError) return res.status(400).json({ message: rackError });
        product.rack = rack;
      }

      // Batch No / Expiry / Cost Price / Qty are no longer product-level -
      // they're edited via Purchases, Adjust Stock, or Stock Management instead.
      // Units per Pack / Loose Unit Name (and the soldAs they imply) are
      // locked after creation too: Product.qty is already stored in whatever
      // unit that choice implies, so changing it later would silently
      // reinterpret existing stock into the wrong granularity.
      const fields = ["name", "strengthValue", "strengthUnit", "packUnit", "packRate", "gstPercent", "hsnCode", "lowStockThreshold"];
      fields.forEach((f) => {
        if (b[f] !== undefined && b[f] !== "") product[f] = b[f];
      });

      if (product.soldAs === "pack-and-loose") {
        const recomputed = computeLooseRate({
          soldAs: product.soldAs,
          packRate: product.packRate,
          unitsPerPack: product.unitsPerPack,
        });
        if (recomputed !== undefined) product.looseRate = recomputed;
      }

      if (req.file) product.image = uploadedImageUrl(req.file);

      await product.save();
      const populated = await product.populate(["category", "vendor"].map((path) => ({ path, select: "name" })));
      res.json(withGroup(stripCostPriceIfStaff(populated, req.user.role)));
    } catch (e) {
      if (e.name === "ValidationError") {
        return res.status(400).json({ message: Object.values(e.errors)[0].message });
      }
      res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  });
});

// One-time, one-way conversion of an existing pack-only product to also sell
// loose - not a generic field edit, because Product.qty and every Batch's
// qtyReceived/qtyRemaining are stored in whatever unit the product's current
// soldAs implies (whole packs for pack-only). Switching to pack-and-loose
// means the internal unit becomes loose units instead, so everything already
// on hand is rescaled by the same unitsPerPack factor to keep representing
// the same physical stock - see the PATCH "/:id" comment above for why this
// can't just be another editable field.
router.patch("/:id/enable-loose", requireAuth, requireRole("admin"), async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ message: "No records found." });
  if (product.soldAs === "pack-and-loose") {
    return res.status(400).json({ message: "This product already sells loose." });
  }

  const unitsPerPack = Number(req.body.unitsPerPack);
  const looseUnitName = req.body.looseUnitName;
  if (!(unitsPerPack > 1)) return res.status(400).json({ message: "Please enter a valid number." });
  if (!LOOSE_UNITS.includes(looseUnitName)) return res.status(400).json({ message: "Choose the loose unit to sell in." });

  try {
    const batches = await Batch.find({ product: product._id });
    for (const batch of batches) {
      const locs = effectiveLocations(batch);
      batch.qtyReceived *= unitsPerPack;
      batch.qtyRemaining *= unitsPerPack;
      batch.locations = locs.map((l) => ({ rack: l.rack, qty: l.qty * unitsPerPack }));
      await batch.save();
    }

    product.qty *= unitsPerPack;
    product.unitsPerPack = unitsPerPack;
    product.looseUnitName = looseUnitName;
    product.soldAs = "pack-and-loose";
    product.looseRate = computeLooseRate({ soldAs: "pack-and-loose", packRate: product.packRate, unitsPerPack });
    await product.save();

    const populated = await product.populate(["category", "vendor"].map((path) => ({ path, select: "name" })));
    res.json(withGroup(stripCostPriceIfStaff(populated, req.user.role)));
  } catch (e) {
    if (e.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(e.errors)[0].message });
    }
    res.status(500).json({ message: "Something went wrong. Please try again." });
  }
});

// Soft delete: past bills, purchases and the stock ledger still reference the
// product. Blocked while stock remains, since hiding it would silently drop
// that stock from every report instead of recording it as a loss.
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product || !product.isActive) return res.status(404).json({ message: "No records found." });
  if (product.qty > 0) {
    return res.status(400).json({
      message: "This product still has stock on hand. Clear it in Stock Management before deleting.",
    });
  }
  product.isActive = false;
  await product.save();
  res.json({ message: "Product deleted." });
});

router.get("/import/template", requireAuth, requirePermission("products.add"), async (req, res) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Products");
  sheet.columns = [
    { header: "Name", key: "name", width: 24 },
    { header: "Brand", key: "brand", width: 18 },
    { header: "Category", key: "category", width: 18 },
    { header: "Strength Value", key: "strengthValue", width: 14 },
    { header: "Strength Unit (mg/mcg/ml/g)", key: "strengthUnit", width: 18 },
    { header: "Pack Unit (Strip/Bottle/Box/Tube/Vial/Jar/Piece)", key: "packUnit", width: 30 },
    { header: "Units Per Pack (leave blank if not sold loose)", key: "unitsPerPack", width: 30 },
    { header: "Loose Unit Name (Tablet/Capsule/ml/Piece - only if Units Per Pack > 1)", key: "looseUnitName", width: 40 },
    { header: "Qty (Packs)", key: "qtyPacks", width: 14 },
    { header: "Pack Rate", key: "packRate", width: 12 },
    { header: "Cost Price", key: "costPrice", width: 12 },
    { header: "GST % (0/5/12/18/28)", key: "gstPercent", width: 18 },
    { header: "HSN Code", key: "hsnCode", width: 14 },
    { header: "Batch No", key: "batchNo", width: 16 },
    { header: "Expiry Date (YYYY-MM-DD)", key: "expiryDate", width: 20 },
    { header: "Low Stock Threshold", key: "lowStockThreshold", width: 18 },
    { header: "Rack", key: "rack", width: 12 }, // required - a rack position like A-001; every imported row adds stock
    { header: "Generic Name", key: "genericName", width: 20 },
    { header: "Composition", key: "composition", width: 26 },
    { header: `Dosage Form (${DOSAGE_FORMS.filter(Boolean).join("/")})`, key: "dosageForm", width: 30 },
    { header: `Release Type (${RELEASE_TYPES.filter(Boolean).join("/")})`, key: "releaseType", width: 30 },
    { header: "Manufacturer", key: "manufacturer", width: 18 },
    { header: "Barcode", key: "barcode", width: 16 },
  ];
  sheet.addRow({
    name: "Dolo 650",
    brand: "Micro Labs",
    category: "Tablet",
    strengthValue: 650,
    strengthUnit: "mg",
    packUnit: "Strip",
    unitsPerPack: 15,
    looseUnitName: "Tablet",
    qtyPacks: 10,
    packRate: 32,
    costPrice: 22,
    gstPercent: 12,
    hsnCode: "3004",
    batchNo: "B2024117",
    expiryDate: "2027-06-30",
    lowStockThreshold: 10,
    rack: "D-001",
    genericName: "Paracetamol",
    composition: "Paracetamol",
    dosageForm: "Tablet",
    releaseType: "Immediate",
    manufacturer: "Micro Labs",
    barcode: "",
  });

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", "attachment; filename=GuganMedicals_Product_Import_Template.xlsx");
  await workbook.xlsx.write(res);
  res.end();
});

router.post("/import", requireAuth, requirePermission("products.add"), importUpload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "Choose an Excel file to import." });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(req.file.buffer);
  const sheet = workbook.worksheets[0];

  const headerRow = sheet.getRow(1).values; // 1-indexed, index 0 empty
  const keyMap = {
    Name: "name",
    Brand: "brand",
    Category: "category",
    "Strength Value": "strengthValue",
    "Strength Unit (mg/mcg/ml/g)": "strengthUnit",
    "Pack Unit (Strip/Bottle/Box/Tube/Vial/Jar/Piece)": "packUnit",
    "Units Per Pack (leave blank if not sold loose)": "unitsPerPack",
    "Loose Unit Name (Tablet/Capsule/ml/Piece - only if Units Per Pack > 1)": "looseUnitName",
    "Qty (Packs)": "qtyPacks",
    "Pack Rate": "packRate",
    "Cost Price": "costPrice",
    "GST % (0/5/12/18/28)": "gstPercent",
    "HSN Code": "hsnCode",
    "Batch No": "batchNo",
    "Expiry Date (YYYY-MM-DD)": "expiryDate",
    "Low Stock Threshold": "lowStockThreshold",
    Rack: "rack",
    "Generic Name": "genericName",
    Composition: "composition",
    Manufacturer: "manufacturer",
    Barcode: "barcode",
  };
  // Headers that carry their allowed values in brackets match on the prefix.
  const keyFor = (header) => {
    if (keyMap[header]) return keyMap[header];
    const h = String(header || "");
    if (h.startsWith("Dosage Form")) return "dosageForm";
    if (h.startsWith("Release Type")) return "releaseType";
    return null;
  };

  const results = [];

  for (let rowNum = 2; rowNum <= sheet.rowCount; rowNum++) {
    const row = sheet.getRow(rowNum);
    if (row.values.length <= 1) continue; // skip blank rows

    const data = {};
    headerRow.forEach((header, idx) => {
      const key = keyFor(header);
      if (key) data[key] = row.getCell(idx).value;
    });

    try {
      // Every column is optional; blanks get the same defaults as Add Product.
      if (!data.name) data.name = `Imported product row ${rowNum}`;
      if (!data.category) data.category = "Uncategorized";
      if (!data.packUnit) data.packUnit = "Strip";
      if (!PACK_UNITS.includes(data.packUnit)) throw new Error("Pack Unit is invalid.");
      const soldAs = deriveSoldAs(data.unitsPerPack);
      if (soldAs === "pack-and-loose" && !LOOSE_UNITS.includes(data.looseUnitName)) data.looseUnitName = "Piece";
      if (data.gstPercent === undefined || data.gstPercent === null || data.gstPercent === "") data.gstPercent = 0;
      if (!GST_VALUES.includes(Number(data.gstPercent))) throw new Error("GST % is invalid.");
      if (!data.batchNo) data.batchNo = `IMP-${Date.now().toString(36).toUpperCase()}-${rowNum}`;
      if (!data.expiryDate) data.expiryDate = null;
      if (!(Number(data.packRate) >= 0)) data.packRate = 0;
      // A blank Rack cell falls back to No Rack rather than failing the row.
      const rack = cleanRack(data.rack);
      const rackError = await rackPositionError(data.rack, { required: false });
      if (rackError) throw new Error(rackError);

      const category = await resolveCategory(String(data.category));

      // Matched by product name alone now (batch-level top-up/creation is
      // handled by upsertBatch below), so a new batch of an existing medicine
      // no longer creates a duplicate product the way name+batch matching used to.
      const existing = await Product.findOne({ name: new RegExp(`^${escapeRegex(String(data.name).trim())}$`, "i") });
      const medicine = medicineFields(
        Object.fromEntries(["genericName", "composition", "dosageForm", "releaseType", "manufacturer", "barcode"].filter((k) => data[k] != null && data[k] !== "").map((k) => [k, String(data[k]).trim()]))
      );
      if (medicine.error) throw new Error(medicine.error);

      const addQty = computeQty({
        soldAs,
        unitsPerPack: data.unitsPerPack,
        qtyPacks: data.qtyPacks,
        qtyLooseExtra: 0,
      });

      if (existing && req.user.role !== "admin") {
        // Topping up or changing an existing product is an edit: Admin only.
        throw new Error(`"${existing.name}" already exists - only an Admin can add stock to or change an existing product.`);
      }
      if (existing) {
        await upsertBatch({
          product: existing,
          batchNo: data.batchNo,
          expiryDate: data.expiryDate,
          costPrice: data.costPrice || 0,
          addQty,
          receivedAt: new Date(),
          rack,
        });
        existing.qty += addQty;
        if (rack) existing.rack = rack; // a blank cell keeps its current rack
        if (data.brand) existing.brand = String(data.brand).trim(); // likewise for brand
        Object.assign(existing, medicine.fields); // and the medicine details
        // Restocking a deleted product brings it back rather than adding
        // stock to a product no list shows.
        existing.isActive = true;
        await existing.save();
        results.push({ row: rowNum, name: data.name, status: "success", message: "Stock topped up on existing product." });
      } else {
        const productCode = await generateProductCode(String(data.name));
        const looseRate = computeLooseRate({ soldAs, packRate: data.packRate, unitsPerPack: data.unitsPerPack });
        const created = await Product.create({
          name: data.name,
          brand: data.brand ? String(data.brand).trim() : "",
          productCode,
          category: category._id,
          strengthValue: data.strengthValue || undefined,
          strengthUnit: data.strengthUnit || "",
          soldAs,
          packUnit: data.packUnit,
          unitsPerPack: data.unitsPerPack || undefined,
          looseUnitName: soldAs === "pack-and-loose" ? data.looseUnitName : "",
          qty: addQty,
          packRate: data.packRate,
          looseRate,
          gstPercent: data.gstPercent,
          hsnCode: data.hsnCode || "",
          lowStockThreshold: data.lowStockThreshold ?? 10,
          rack,
          ...medicine.fields,
        });
        await upsertBatch({
          product: created,
          batchNo: data.batchNo,
          expiryDate: data.expiryDate,
          costPrice: data.costPrice || 0,
          addQty,
          receivedAt: new Date(),
          rack,
        });
        results.push({ row: rowNum, name: data.name, status: "success", message: "Product created." });
      }
    } catch (e) {
      results.push({ row: rowNum, name: data.name || "(blank)", status: "failed", message: e.message });
    }
  }

  res.json({ results });
});

export default router;
