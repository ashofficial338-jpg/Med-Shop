import { Router } from "express";
import { markInvoiceChanged } from "../utils/invoiceArchive.js";
import mongoose from "mongoose";
import Purchase from "../models/Purchase.js";
import Vendor from "../models/Vendor.js";
import Product from "../models/Product.js";
import StockLedger from "../models/StockLedger.js";
import SupplierPayment from "../models/SupplierPayment.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { computeInternalQty } from "../utils/stockUnits.js";
import { upsertBatch, upsertBatches, weightedAvgCost, moveBetweenLocations, refreshProductRack } from "../utils/batchHelpers.js";
import { effectiveLocations } from "../utils/locations.js";
import Batch from "../models/Batch.js";
import { cleanRack, rackPositionError } from "../utils/rack.js";
import { generatePaymentNo } from "../utils/ledgerHelpers.js";
import { nextSequence } from "../models/Counter.js";
import { computeLooseRate } from "../utils/productHelpers.js";
import { streamExcelReport, streamPdfReport, periodLabel } from "../utils/reportExport.js";
import { dayRange } from "../utils/queryFilters.js";
import { findOrCreateProduct } from "../utils/productAutoCreate.js";
import { transactional, rethrowIfRetryable, isDuplicateOf, cleanClientRef } from "../utils/transaction.js";

const router = Router();
router.use(requireAuth, requireRole("admin"));

const PACK_UNITS = ["Strip", "Bottle", "Box", "Tube", "Vial", "Jar", "Piece"];
const LOOSE_UNITS = ["Tablet", "Capsule", "ml", "Piece"];
const GST_VALUES = [0, 5, 12, 18, 28];
// A purchase without a supplier has nobody to owe, so it's always paid up front.
const DIRECT_PAYMENT_MODES = ["Cash", "UPI", "Bank Transfer", "Cheque", "Other"];
const PAID_AT_PURCHASE_NOTE = "Paid at purchase";
// How money paid along with a credit purchase was paid.
const paidMode = (m) => (DIRECT_PAYMENT_MODES.includes(m) ? m : "Cash");
const round2 = (n) => Number(Number(n).toFixed(2));
const stockUnitName = (p) => (p?.soldAs === "pack-and-loose" ? p.looseUnitName : p?.packUnit) || "units";
const duplicateInvoiceMessage = (vendorId) =>
  vendorId ? "This invoice number has already been recorded for this supplier." : "This invoice number has already been recorded for a purchase without a supplier.";
// Earlier purchases from the same supplier (registered, typed in, or none).
const supplierFilterFor = (vendorId, supplierName) =>
  vendorId
    ? { vendor: new mongoose.Types.ObjectId(String(vendorId)) }
    : supplierName
      ? { vendor: null, supplierName: new RegExp(`^${escapeRegex(supplierName)}$`, "i") }
      : { vendor: null, supplierName: { $in: ["", null] } };

// Who a purchase was bought from, for lists and exports: a registered
// vendor, an unregistered supplier typed in by name, or nobody.
export function purchasePartyName(p) {
  if (p.vendor) return p.vendor.name || "Unknown supplier";
  return p.supplierName ? `${p.supplierName} (unregistered)` : "No supplier";
}

// Blank -> 0 for optional money fields; NaN for anything that isn't a number.
const optionalNumber = (v) => (v === undefined || v === null || v === "" ? 0 : Number(v));

const escapeRegex = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Shared by the list and its export. `category` keeps purchases that include
// at least one product from that category (used by dashboard links).
async function buildPurchaseFilter(req) {
  const { vendor, from, to, category, product, supplierName } = req.query;
  const filter = {};
  // vendor: a registered vendor's id, "unregistered" (any typed-in supplier)
  // or "none" (no supplier at all). supplierName narrows to one unregistered supplier.
  if (vendor === "none") Object.assign(filter, { vendor: null, supplierName: { $in: ["", null] } });
  else if (vendor === "unregistered") Object.assign(filter, { vendor: null, supplierName: { $nin: ["", null] } });
  else if (vendor && mongoose.isValidObjectId(vendor)) filter.vendor = vendor;
  if (supplierName) Object.assign(filter, { vendor: null, supplierName: new RegExp(`^${escapeRegex(String(supplierName).trim())}$`, "i") });
  if (product && mongoose.isValidObjectId(product)) filter["items.product"] = product;
  // Payment status (only credit purchases can carry a balance).
  const paid = { $ifNull: ["$amountPaid", "$total"] };
  if (req.query.payment === "paid") filter.$expr = { $gte: [paid, "$total"] };
  if (req.query.payment === "due") filter.$expr = { $lt: [paid, "$total"] };
  const range = dayRange(from, to);
  if (range) filter.date = range;
  if (category && mongoose.isValidObjectId(category)) {
    const ids = (await Product.find({ category }, "_id")).map((p) => p._id);
    filter["items.product"] = { $in: ids };
  }
  return filter;
}

// Previous purchase rate for a product, to pre-fill (never force) the
// purchase price on a new entry. Supplier-specific when this supplier has
// sold it before; otherwise the latest rate from anyone; otherwise the newest
// batch's cost (e.g. opening stock). Read-only - history is never touched.
router.get("/last-rate", async (req, res) => {
  const { product, vendor, supplierName } = req.query;
  if (!mongoose.isValidObjectId(product)) return res.status(400).json({ message: "Please choose a product." });
  const pid = new mongoose.Types.ObjectId(product);
  const find = (extra) => Purchase.findOne({ "items.product": pid, ...extra }).populate("vendor", "name").sort({ date: -1, createdAt: -1 });
  let supplierFilter = null;
  if (vendor && mongoose.isValidObjectId(vendor)) supplierFilter = { vendor };
  else if (supplierName && String(supplierName).trim()) supplierFilter = { vendor: null, supplierName: new RegExp(`^${escapeRegex(String(supplierName).trim())}$`, "i") };
  else if (req.query.noSupplier === "1") supplierFilter = { vendor: null, supplierName: { $in: ["", null] } };

  const rateOf = (p) => {
    if (!p) return null;
    const item = [...p.items].reverse().find((i) => String(i.product) === String(pid));
    return {
      costPrice: item.costPrice,
      qtyPacks: item.qtyPacks,
      batchNo: item.batchNo,
      date: p.date,
      invoiceNo: p.invoiceNo,
      supplier: purchasePartyName(p),
      supplierType: p.vendor ? "registered" : p.supplierName ? "unregistered" : "none",
      purchaseId: p._id,
    };
  };
  const [bySupplierDoc, latestDoc, recentDocs] = await Promise.all([
    supplierFilter ? find(supplierFilter) : null,
    find({}),
    Purchase.find({ "items.product": pid }).populate("vendor", "name").sort({ date: -1, createdAt: -1 }).limit(5),
  ]);
  const supplierRate = rateOf(bySupplierDoc);
  const latestRate = rateOf(latestDoc);
  let batchRate = null;
  if (!latestRate) {
    const b = await Batch.findOne({ product: pid }).sort({ receivedAt: -1 });
    if (b) batchRate = { costPrice: b.costPrice, date: b.receivedAt, batchNo: b.batchNo, supplier: "Opening stock / adjustment", supplierType: "none" };
  }
  const basis = supplierRate ? "supplier" : latestRate ? "latest" : batchRate ? "batch" : null;
  const suggested = (supplierRate || latestRate || batchRate)?.costPrice ?? null;
  res.json({
    suggested,
    basis,
    supplierRate,
    latestRate: latestRate || batchRate,
    recent: recentDocs.map(rateOf),
    avgCostOnHand: weightedAvgCost(await Batch.find({ product: pid, qtyRemaining: { $gt: 0 } })),
  });
});

// Snapshots each line's previous purchase rate (supplier-specific, falling
// back to the latest from anyone) before the new purchase is saved.
async function attachPreviousRates(lines, supplierFilter, excludeId = null) {
  const ids = [...new Set(lines.map((l) => String(l.product)))].map((id) => new mongoose.Types.ObjectId(id));
  const latest = async (extra) => {
    const rows = await Purchase.aggregate([
      { $match: { "items.product": { $in: ids }, ...(excludeId ? { _id: { $ne: excludeId } } : {}), ...extra } },
      { $project: { date: 1, createdAt: 1, "items.product": 1, "items.costPrice": 1 } },
      { $unwind: { path: "$items", includeArrayIndex: "line" } },
      { $match: { "items.product": { $in: ids } } },
      { $sort: { date: -1, createdAt: -1, line: -1 } },
      { $group: { _id: "$items.product", costPrice: { $first: "$items.costPrice" } } },
    ]);
    return new Map(rows.map((r) => [String(r._id), r.costPrice]));
  };
  const own = await latest(supplierFilter);
  const any = await latest({});
  for (const line of lines) {
    const id = String(line.product);
    line.previousCostPrice = own.get(id) ?? any.get(id) ?? null;
  }
}

// Names of unregistered suppliers used so far, for filters and autocomplete.
router.get("/unregistered-suppliers", async (req, res) => {
  const names = await Purchase.distinct("supplierName", { vendor: null, supplierName: { $nin: ["", null] } });
  const seen = new Map();
  for (const n of names) if (!seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), n);
  res.json([...seen.values()].sort((a, b) => a.localeCompare(b)));
});

// Possible duplicates of a bill about to be entered (used by the scanned-bill
// flow): the same invoice number from anyone, or the same date and total.
// Read-only - saving still relies on the unique vendor + invoiceNo index.
router.get("/check-duplicate", async (req, res) => {
  const invoiceNo = String(req.query.invoiceNo || "").trim().slice(0, 60);
  const total = Number(req.query.total);
  const date = String(req.query.date || "");
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(new Date(date).getTime()) ? dayRange(date, date) : null;
  const or = [];
  if (invoiceNo) or.push({ invoiceNo: new RegExp(`^${escapeRegex(invoiceNo)}$`, "i") });
  if (day && total > 0) or.push({ date: day, total: { $gte: total - 1, $lte: total + 1 } });
  if (!or.length) return res.json([]);
  const found = await Purchase.find({ $or: or }).populate("vendor", "name").sort({ date: -1 }).limit(5);
  res.json(
    found.map((p) => ({
      _id: p._id,
      invoiceNo: p.invoiceNo,
      date: p.date,
      total: p.total,
      supplier: purchasePartyName(p),
      vendor: p.vendor?._id || null,
      sameInvoiceNo: Boolean(invoiceNo) && p.invoiceNo.toLowerCase() === invoiceNo.toLowerCase(),
    }))
  );
});

router.get("/", async (req, res) => {
  const filter = await buildPurchaseFilter(req);
  const purchases = await Purchase.find(filter)
    .populate("vendor", "name")
    .populate("items.product", "name productCode")
    .sort({ date: -1, createdAt: -1 });
  res.json(purchases);
});

// Registered before GET "/:id" - both are single-segment GET routes, and
// Express matches in registration order, so this must come first or "/:id"
// would treat "export" as a purchase id.
router.get("/export", async (req, res) => {
  const { format, from, to, vendor } = req.query;
  const filter = await buildPurchaseFilter(req);
  const purchases = await Purchase.find(filter).populate("vendor", "name").sort({ date: -1, createdAt: -1 });
  const rows = purchases.map((p) => ({
    invoiceNo: p.invoiceNo,
    date: p.date.toISOString().slice(0, 10),
    vendor: purchasePartyName(p),
    paymentMode: p.paymentMode,
    subtotal: p.subtotal,
    gst: p.gstAmount,
    tds: p.tdsAmount,
    total: p.total,
    amountPaid: p.amountPaid ?? p.total,
    balanceDue: p.balanceDue,
  }));

  if (format === "pdf") {
    return streamPdfReport(res, "GuganMedicals_Purchases_Report.pdf", {
      title: "Gugan Medicals - Purchases Report",
      subtitle: `${periodLabel(from, to)}${vendor || req.query.supplierName ? ` · Supplier: ${req.query.supplierName ? `${req.query.supplierName} (unregistered)` : vendor === "none" ? "No supplier" : vendor === "unregistered" ? "Unregistered suppliers" : purchases[0]?.vendor?.name || "selected vendor"}` : ""} · Total: Rs. ${rows.reduce((s, r) => s + r.total, 0).toFixed(2)}`,
      columns: [
        { header: "Invoice No", key: "invoiceNo" },
        { header: "Date", key: "date" },
        { header: "Vendor", key: "vendor" },
        { header: "Mode", key: "paymentMode" },
        { header: "Total", key: "total", align: "right" },
        { header: "Balance Due", key: "balanceDue", align: "right" },
      ],
      rows,
    });
  }

  return streamExcelReport(res, "GuganMedicals_Purchases_Report.xlsx", [
    {
      name: "Purchases",
      columns: [
        { header: "Invoice No", key: "invoiceNo", width: 16 },
        { header: "Date", key: "date", width: 14 },
        { header: "Vendor", key: "vendor", width: 20 },
        { header: "Payment Mode", key: "paymentMode", width: 14 },
        { header: "Subtotal", key: "subtotal", width: 12 },
        { header: "GST", key: "gst", width: 12 },
        { header: "TDS", key: "tds", width: 12 },
        { header: "Total", key: "total", width: 12 },
        { header: "Amount Paid", key: "amountPaid", width: 12 },
        { header: "Balance Due", key: "balanceDue", width: 12 },
      ],
      rows,
    },
  ]);
});

router.get("/:id", async (req, res) => {
  const purchase = await Purchase.findById(req.params.id)
    .populate("vendor", "name")
    .populate("items.product", "name productCode packUnit soldAs unitsPerPack");
  if (!purchase) return res.status(404).json({ message: "No records found." });
  // Split of amountPaid for the edit form: paid with the purchase itself
  // (editable) vs paid later through the supplier ledger (protected).
  const { atPurchase, paidAtPurchase, paidLater } = await purchasePayments(purchase);
  res.json({ ...purchase.toObject(), paidAtPurchase, paidLater, paidMode: atPurchase[0]?.mode || "Cash" });
});

// --- Saving a purchase ---------------------------------------------------

// A line's amount and GST, after its trade discount.
function lineFigures({ qtyPacks, costPrice, discountPercent }, gstPercent) {
  const lineAmount = round2(qtyPacks * netUnitCost({ costPrice, discountPercent }));
  return { lineAmount, lineGst: round2((lineAmount * (gstPercent || 0)) / 100) };
}

// What one pack really cost: the rate less the line's discount. This is what
// the stock is valued at (and so what a sale's profit is worked out from).
function netUnitCost({ costPrice, discountPercent }) {
  return Number((costPrice * (1 - (discountPercent || 0) / 100)).toFixed(4));
}

// Checks one submitted line and finds its product - by id, by name (ignoring
// case, spaces and punctuation), or as a new one to add to the Product List.
// Product and quantity are all a line needs; everything else is optional.
// Returns { error } or the line.
async function readLine(item, { vendorId, newProducts, known, rackErrors, keepInactive, keepRack }) {
  let product = known.get(String(item.product)) || null;
  if (product && !product.isActive && !keepInactive?.(item)) product = null;
  let created = false;

  if (!product) {
    const np = item.newProduct || {};
    const name = String(np.name || "").trim();
    if (!name) return { error: "Choose the product for each line (or remove empty lines)." };
    const blank = (v) => v === undefined || v === null || v === "";
    const gstPercent = blank(np.gstPercent) ? 0 : Number(np.gstPercent);
    if (!GST_VALUES.includes(gstPercent)) return { error: `Choose a valid GST rate for ${name}.` };
    if (np.packUnit && !PACK_UNITS.includes(np.packUnit)) return { error: `Choose a valid pack unit for ${name}.` };
    const unitsPerPack = blank(np.unitsPerPack) ? undefined : Number(np.unitsPerPack);
    if (unitsPerPack !== undefined && !(Number.isInteger(unitsPerPack) && unitsPerPack >= 1)) {
      return { error: `Units per pack of ${name} must be a whole number.` };
    }
    ({ product, created } = await findOrCreateProduct(
      name,
      {
        hsnCode: np.hsnCode,
        unit: np.packUnit || np.unit,
        gstPercent,
        rate: blank(item.sellingPrice) ? np.sellingPrice : item.sellingPrice,
        vendor: vendorId,
        category: np.category,
        unitsPerPack,
        looseUnitName: LOOSE_UNITS.includes(np.looseUnitName) ? np.looseUnitName : "Piece",
      },
      newProducts
    ));
  }

  const qtyPacks = Number(item.qtyPacks);
  const costPrice = optionalNumber(item.costPrice);
  const discountPercent = optionalNumber(item.discountPercent);
  const hasSelling = item.sellingPrice !== undefined && item.sellingPrice !== null && item.sellingPrice !== "";
  const sellingPrice = hasSelling ? Number(item.sellingPrice) : null;
  if (!(qtyPacks > 0) || !Number.isInteger(qtyPacks)) return { error: `Enter the quantity for ${product.name}.` };
  if (!(costPrice >= 0)) return { error: `Please enter a valid purchase rate for ${product.name}.` };
  if (!(discountPercent >= 0 && discountPercent <= 100)) return { error: `The discount on ${product.name} must be between 0 and 100%.` };
  if (hasSelling && !(sellingPrice >= 0)) return { error: `Please enter a valid selling price for ${product.name}.` };
  if (item.expiryDate && Number.isNaN(new Date(item.expiryDate).getTime())) return { error: `Please enter a valid expiry date for ${product.name}.` };
  const batchNo = String(item.batchNo || "").trim();
  if (batchNo.length > 30) return { error: "Batch number can be at most 30 characters." };
  const rack = cleanRack(item.rack);
  if (keepRack?.(item) !== rack) {
    if (!rackErrors.has(rack)) rackErrors.set(rack, await rackPositionError(item.rack, { required: false }));
    if (rackErrors.get(rack)) return { error: rackErrors.get(rack) };
  }

  return {
    product,
    created,
    sellingPrice,
    addQty: computeInternalQty({ soldAs: product.soldAs, unitsPerPack: product.unitsPerPack, qtyPacks, qtyLooseExtra: 0 }),
    line: {
      product: product._id,
      qtyPacks,
      costPrice,
      discountPercent,
      batchNo,
      expiryDate: item.expiryDate || null,
      rack,
      ...lineFigures({ qtyPacks, costPrice, discountPercent }, product.gstPercent),
    },
  };
}

// What readLine looks things up in, read once for the whole purchase.
async function lineContext(items, vendorId) {
  const ids = items.map((i) => i?.product).filter((id) => mongoose.isValidObjectId(id));
  const products = ids.length ? await Product.find({ _id: { $in: ids } }) : [];
  return { vendorId, known: new Map(products.map((p) => [String(p._id), p])), newProducts: new Map(), rackErrors: new Map() };
}

// A selling price typed on a purchase becomes the product's current price.
function priceUpdate(product, sellingPrice) {
  if (sellingPrice === null || sellingPrice === product.packRate) return {};
  const looseRate = computeLooseRate({ soldAs: product.soldAs, packRate: sellingPrice, unitsPerPack: product.unitsPerPack });
  return { packRate: sellingPrice, ...(product.soldAs === "pack-and-loose" ? { looseRate: looseRate ?? 0 } : {}) };
}

// The one Purchase Entry: from a registered supplier (can be on credit), from
// a supplier typed in by name, or with no supplier at all (both paid up
// front). In one transaction it records the purchase, brings the stock in
// batch by batch, updates purchase and selling rates, and posts what was
// paid; supplier balances, stock value, the Day Book, the dashboard and the
// reports are all worked out from these same records.
const savePurchase = transactional(async (req, res) => {
  const { vendor, invoiceNo, date, items, tdsAmount, paymentMode, amountPaid } = req.body;

  // The same form sent again: answer with the purchase it already made.
  const clientRef = cleanClientRef(req.body.clientRef);
  if (clientRef) {
    const saved = await Purchase.findOne({ clientRef, createdBy: req.user._id }).populate("vendor", "name");
    if (saved) return res.status(200).json({ ...saved.toObject(), alreadySaved: true });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "Add at least one product line before saving." });
  }
  if (date && Number.isNaN(new Date(date).getTime())) return res.status(400).json({ message: "Please enter a valid date." });

  let vendorDoc = null;
  if (vendor) {
    vendorDoc = mongoose.isValidObjectId(vendor) ? await Vendor.findById(vendor) : null;
    if (!vendorDoc || !vendorDoc.isActive) return res.status(400).json({ message: "The selected supplier was not found. Please choose the supplier again." });
  }
  const vendorId = vendorDoc?._id || null;
  const supplierName = vendorDoc ? "" : String(req.body.supplierName || "").trim();

  // Only a registered supplier has an account to owe on; every other purchase
  // (and every mode but Credit) is settled in full at once.
  const mode = paymentMode || (vendorDoc ? "Credit" : "Cash");
  if (!vendorDoc && mode === "Credit") {
    return res.status(400).json({ message: "Choose a registered supplier to buy on credit, or pick how it was paid (Cash, UPI, ...)." });
  }
  if (![...DIRECT_PAYMENT_MODES, "Credit"].includes(mode)) return res.status(400).json({ message: "Please choose a valid payment mode." });

  try {
    const context = await lineContext(items, vendorId);
    const lines = [];
    for (const item of items) {
      const read = await readLine(item, context);
      if (read.error) return res.status(400).json({ message: read.error });
      lines.push(read);
    }

    const subtotal = round2(lines.reduce((s, l) => s + l.line.lineAmount, 0));
    const gstAmount = round2(lines.reduce((s, l) => s + l.line.lineGst, 0));
    const total = round2(subtotal + gstAmount);
    const paid = mode === "Credit" ? round2(Math.min(Math.max(Number(amountPaid) || 0, 0), total)) : total;

    const resolvedInvoiceNo =
      String(invoiceNo || "").trim() ||
      (vendorDoc ? `PUR-${String(await nextSequence("purchaseNo")).padStart(6, "0")}` : `DP-${String(await nextSequence("directPurchaseNo")).padStart(6, "0")}`);
    for (const l of lines) if (!l.line.batchNo) l.line.batchNo = resolvedInvoiceNo.slice(0, 30);
    await attachPreviousRates(lines.map((l) => l.line), supplierFilterFor(vendorId, supplierName));

    const purchase = new Purchase({
      ...(clientRef ? { clientRef } : {}),
      vendor: vendorId,
      supplierName,
      invoiceNo: resolvedInvoiceNo,
      date: date || new Date(),
      items: lines.map((l) => l.line),
      subtotal,
      gstAmount,
      tdsAmount: vendorDoc ? Math.max(Number(tdsAmount) || 0, 0) : 0,
      total,
      paymentMode: mode,
      amountPaid: paid,
      createdBy: req.user._id,
    });
    await purchase.save();

    if (mode === "Credit" && paid > 0) {
      await SupplierPayment.create({
        paymentNo: await generatePaymentNo("supplier"),
        vendor: vendorId,
        purchase: purchase._id,
        amount: paid,
        mode: paidMode(req.body.paidMode),
        date: purchase.date,
        note: PAID_AT_PURCHASE_NOTE,
        recordedBy: req.user._id,
      });
    }

    // Stock in: each line creates its own batch (or tops up the one with this
    // batch number), so an older lot's expiry is never overwritten.
    const batches = await upsertBatches(
      lines.map(({ product, addQty, line }) => ({
        product,
        batchNo: line.batchNo,
        expiryDate: line.expiryDate,
        costPrice: netUnitCost(line),
        addQty,
        receivedAt: purchase.date,
        purchase: purchase._id,
        rack: line.rack,
      }))
    );
    batches.forEach((b, i) => (purchase.items[i].batch = b._id));
    await Product.bulkWrite(
      lines.map(({ product, addQty, sellingPrice, line }) => {
        const set = { ...priceUpdate(product, sellingPrice), ...(line.rack ? { rack: line.rack } : {}) };
        return { updateOne: { filter: { _id: product._id }, update: { $inc: { qty: addQty }, ...(Object.keys(set).length ? { $set: set } : {}) } } };
      })
    );
    await StockLedger.insertMany(
      lines.map(({ product, addQty, line }, i) => ({
        product: product._id,
        batch: batches[i]._id,
        type: "purchase",
        qtyChange: addQty,
        rack: line.rack || "",
        reason: vendorDoc ? `Purchase invoice ${resolvedInvoiceNo}` : `Direct purchase ${resolvedInvoiceNo} (no supplier)`,
        refId: purchase._id,
        performedBy: req.user._id,
      }))
    );
    // Stock put on no rack: keep the product's shown position one that holds its stock.
    for (const id of new Set(lines.filter((l) => !l.line.rack && l.product.rack).map((l) => String(l.line.product)))) {
      await refreshProductRack(await Product.findById(id));
    }
    await purchase.save();

    const populated = await Purchase.findById(purchase._id).populate("vendor", "name");
    await populated.populate("items.product", "name productCode");
    res.status(201).json({ ...populated.toObject(), createdProducts: lines.filter((l) => l.created).length });
  } catch (e) {
    rethrowIfRetryable(e);
    if (isDuplicateOf(e, "clientRef")) return res.status(409).json({ message: "This purchase has already been saved. Check Purchases." });
    if (isDuplicateOf(e, "invoiceNo")) return res.status(409).json({ message: duplicateInvoiceMessage(vendorId) });
    if (e.name === "ValidationError") return res.status(400).json({ message: Object.values(e.errors)[0].message });
    console.error(e);
    res.status(500).json({ message: "Something went wrong. Nothing was saved - please try again." });
  }
});

router.post("/", savePurchase);
// Kept for the Excel upload: the same entry, without a registered supplier.
router.post("/direct", (req, res, next) => {
  req.body.vendor = undefined;
  return savePurchase(req, res, next);
});

// Corrects a saved purchase (supplier, invoice no, date, products, qty, rate,
// discount, batch, expiry, rack, payment). Stock is reconciled per batch: each
// lot this purchase brought in is raised or lowered by the difference, so
// stock already sold from it stays accounted for - a quantity can't be cut
// below what's already gone. A supplier purchase can't become a direct one
// (or the reverse). Payments made later through the supplier ledger are
// protected: such a purchase stays on Credit with the same supplier and its
// total can't drop below what was paid.
router.put(
  "/:id",
  transactional(async (req, res) => {
    const purchase = await Purchase.findById(req.params.id);
    if (!purchase) return res.status(404).json({ message: "No records found." });
    const { vendor, supplierName, invoiceNo, date, items, tdsAmount, paymentMode, amountPaid } = req.body;
    const isDirect = !purchase.vendor;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Add at least one product line before saving." });
    }
    if (date && Number.isNaN(new Date(date).getTime())) return res.status(400).json({ message: "Please enter a valid date." });

    let vendorId = null;
    if (!isDirect) {
      vendorId = vendor && mongoose.isValidObjectId(vendor) ? String(vendor) : String(purchase.vendor);
      if (vendorId !== String(purchase.vendor)) {
        const v = await Vendor.findById(vendorId);
        if (!v || !v.isActive) return res.status(400).json({ message: "Please choose a valid supplier." });
      }
    }
    const vendorChanged = !isDirect && vendorId !== String(purchase.vendor);
    const mode = paymentMode || purchase.paymentMode;
    const allowedModes = isDirect ? DIRECT_PAYMENT_MODES : [...DIRECT_PAYMENT_MODES, "Credit"];
    if (!allowedModes.includes(mode)) {
      return res.status(400).json({
        message: isDirect ? "A purchase without a supplier is paid up front - choose Cash, UPI, Bank Transfer, Cheque or Other." : "Please choose a valid payment mode.",
      });
    }

    const resolvedInvoiceNo = String(invoiceNo ?? "").trim() || purchase.invoiceNo;
    if (await Purchase.exists({ _id: { $ne: purchase._id }, vendor: isDirect ? null : vendorId, invoiceNo: resolvedInvoiceNo })) {
      return res.status(409).json({ message: duplicateInvoiceMessage(vendorId) });
    }

    // What was paid at purchase can be corrected freely; payments made later
    // through the supplier ledger can't be undone from here.
    const { atPurchase, paidLater } = await purchasePayments(purchase);
    if (paidLater > 0) {
      if (mode !== "Credit") {
        return res.status(400).json({ message: `₹${paidLater.toFixed(2)} has already been paid against this credit purchase, so it has to stay on Credit.` });
      }
      if (vendorChanged) {
        return res.status(400).json({ message: "Payments are already recorded against this purchase for its supplier, so the supplier can't be changed." });
      }
    }

    try {
      const originalOf = (item) => {
        const same = (i) => String(i.product) === String(item.product);
        return purchase.items.find((i) => same(i) && i.batchNo === String(item.batchNo || "").trim()) || purchase.items.find(same);
      };
      const context = await lineContext(items, vendorId);
      const read = [];
      for (const item of items) {
        const original = originalOf(item);
        const r = await readLine(item, {
          ...context,
          keepInactive: () => Boolean(original),
          keepRack: () => (original ? cleanRack(original.rack) : undefined),
        });
        if (r.error) return res.status(400).json({ message: r.error });
        if (!r.line.batchNo) r.line.batchNo = resolvedInvoiceNo.slice(0, 30);
        r.line.previousCostPrice = original ? original.previousCostPrice : undefined;
        r.rackChanged = Boolean(original) && cleanRack(original.rack) !== r.line.rack;
        read.push(r);
      }

      const subtotal = round2(read.reduce((s, r) => s + r.line.lineAmount, 0));
      const gstAmount = round2(read.reduce((s, r) => s + r.line.lineGst, 0));
      const total = round2(subtotal + gstAmount);
      const paidNow = mode === "Credit" ? round2(Math.max(Number(amountPaid) || 0, 0)) : 0;
      const resolvedAmountPaid = mode === "Credit" ? round2(paidLater + paidNow) : total;
      if (resolvedAmountPaid > total) {
        return res.status(400).json({
          message: paidLater > 0
            ? `₹${resolvedAmountPaid.toFixed(2)} has already been paid for this purchase, so the new total can't be less than that.`
            : "Amount paid can't be more than the purchase total.",
        });
      }

      // What this purchase actually put into each batch, and at what cost.
      const { qtyByBatch: oldQtyByBatch, costByBatch: oldCostByBatch, batches: oldBatches } = await broughtIn(purchase);

      // Corrected lines grouped by the lot they go into.
      const groups = new Map();
      for (const r of read) {
        const key = `${r.line.product}|${r.line.batchNo}`;
        const g = groups.get(key) || { product: r.product, batchNo: r.line.batchNo, qty: 0, value: 0, expiryDate: null, rack: r.line.rack, rackChanged: false, lines: [] };
        g.qty += r.addQty;
        g.value += r.addQty * netUnitCost(r.line);
        if (r.line.expiryDate) g.expiryDate = r.line.expiryDate;
        g.rack = r.line.rack;
        g.rackChanged = g.rackChanged || r.rackChanged;
        g.lines.push(r.line);
        groups.set(key, g);
      }
      for (const g of groups.values()) g.cost = g.qty > 0 ? g.value / g.qty : 0;

      const plan = [];
      const productDelta = new Map();
      const addDelta = (pid, d) => productDelta.set(String(pid), (productDelta.get(String(pid)) || 0) + d);
      for (const b of oldBatches) {
        const g = groups.get(`${b.product}|${b.batchNo}`);
        const oldQty = oldQtyByBatch.get(String(b._id)) || 0;
        const newQty = g ? g.qty : 0;
        const delta = newQty - oldQty;
        if (b.qtyRemaining + delta < 0) {
          const p = g?.product || (await Product.findById(b.product));
          const used = oldQty - b.qtyRemaining;
          return res.status(400).json({
            message: `${p?.name || "A product"} batch ${b.batchNo}: ${used} ${stockUnitName(p)} from this purchase ${used === 1 ? "has" : "have"} already been sold or used, so its quantity can't go below that.`,
          });
        }
        const c = oldCostByBatch.get(String(b._id));
        plan.push({ batch: b, group: g, oldQty, newQty, delta, oldCost: c && c.packs > 0 ? c.value / c.packs : b.costPrice });
        if (g) g.matched = true;
        addDelta(b.product, delta);
      }
      for (const g of groups.values()) if (!g.matched) addDelta(g.product._id, g.qty);
      for (const [pid, delta] of productDelta) {
        if (delta >= 0) continue;
        const p = await Product.findById(pid);
        if (p && p.qty + delta < 0) {
          return res.status(400).json({ message: `Only ${p.qty} ${stockUnitName(p)} of ${p.name} left in stock, so this purchase can't be reduced that much.` });
        }
      }

      const cleanSupplierName = isDirect ? String(supplierName ?? purchase.supplierName ?? "").trim() : "";
      const newLines = read.map((r) => r.line).filter((l) => l.previousCostPrice === undefined);
      if (newLines.length) await attachPreviousRates(newLines, supplierFilterFor(vendorId, cleanSupplierName), purchase._id);

      const purchaseDate = date ? new Date(date) : purchase.date;
      const reason = `Edit of purchase ${resolvedInvoiceNo}`;
      for (const pl of plan) {
        const b = pl.batch;
        const g = pl.group;
        const receivedBefore = b.qtyReceived;
        const onlyThis = receivedBefore <= pl.oldQty; // this purchase is the lot's only delivery
        const newReceived = Math.max(receivedBefore + pl.delta, 0);
        if (newReceived > 0) {
          const value = onlyThis ? pl.newQty * (g?.cost ?? 0) : receivedBefore * b.costPrice - pl.oldQty * pl.oldCost + pl.newQty * (g?.cost ?? 0);
          b.costPrice = Number(Math.max(value / newReceived, 0).toFixed(4));
        }
        b.qtyReceived = newReceived;
        b.qtyRemaining += pl.delta;
        if (g) {
          if (onlyThis) {
            b.expiryDate = g.expiryDate || null;
            b.receivedAt = purchaseDate;
          } else if (g.expiryDate) {
            b.expiryDate = g.expiryDate;
          }
          b.isDeleted = false;
        } else if (b.qtyReceived <= 0 && b.qtyRemaining <= 0) {
          // The line was removed and nothing of it was sold: retire the lot.
          b.isDeleted = true;
        }
        await b.save();

        // A corrected rack moves this purchase's stock to the new position.
        if (g && g.rackChanged && g.rack !== (b.rack || "")) {
          const from = b.rack || "";
          const here = effectiveLocations(b).find((l) => l.rack === from)?.qty || 0;
          const move = Math.min(here, g.qty);
          if (move > 0) await moveBetweenLocations(b._id, from, g.rack, move);
          await Batch.updateOne({ _id: b._id }, { $set: { rack: g.rack } });
        }
        if (g) for (const l of g.lines) l.batch = b._id;
        if (pl.delta !== 0) {
          await StockLedger.create({
            product: b.product,
            batch: b._id,
            type: "purchase-edit",
            qtyChange: pl.delta,
            rack: g ? g.rack : b.rack || "",
            reason,
            refId: purchase._id,
            performedBy: req.user._id,
          });
        }
      }

      for (const g of groups.values()) {
        if (g.matched) continue;
        const batch = await upsertBatch({
          product: g.product,
          batchNo: g.batchNo,
          expiryDate: g.expiryDate,
          costPrice: Number(g.cost.toFixed(4)),
          addQty: g.qty,
          receivedAt: purchaseDate,
          purchase: purchase._id,
          rack: g.rack,
        });
        for (const l of g.lines) l.batch = batch._id;
        await StockLedger.create({
          product: g.product._id,
          batch: batch._id,
          type: "purchase-edit",
          qtyChange: g.qty,
          rack: g.rack || "",
          reason,
          refId: purchase._id,
          performedBy: req.user._id,
        });
      }

      for (const [pid, delta] of productDelta) if (delta !== 0) await Product.updateOne({ _id: pid }, { $inc: { qty: delta } });
      for (const r of read) {
        const price = priceUpdate(r.product, r.sellingPrice);
        if (Object.keys(price).length) await Product.updateOne({ _id: r.product._id }, { $set: price });
      }
      for (const g of groups.values()) {
        if (g.rack && (g.rackChanged || !g.matched)) await Product.updateOne({ _id: g.product._id }, { $set: { rack: g.rack } });
      }
      const touched = new Set([...productDelta].filter(([, d]) => d !== 0).map(([pid]) => pid));
      for (const r of read) if (r.rackChanged) touched.add(String(r.line.product));
      for (const pid of touched) {
        const p = await Product.findById(pid);
        if (p) await refreshProductRack(p);
      }

      purchase.set({
        vendor: isDirect ? null : vendorId,
        supplierName: isDirect ? cleanSupplierName : purchase.supplierName,
        invoiceNo: resolvedInvoiceNo,
        date: purchaseDate,
        items: read.map((r) => ({ ...r.line, batch: r.line.batch || null })),
        subtotal,
        gstAmount,
        tdsAmount: isDirect ? 0 : Math.max(Number(tdsAmount) || 0, 0),
        total,
        paymentMode: mode,
        amountPaid: resolvedAmountPaid,
        editedAt: new Date(),
        editedBy: req.user._id,
      });
      await purchase.save();
      await markInvoiceChanged("purchase", purchase._id, "edited");

      await SupplierPayment.deleteMany({ _id: { $in: atPurchase.map((p) => p._id) } });
      if (mode === "Credit" && paidNow > 0) {
        await SupplierPayment.create({
          paymentNo: atPurchase[0]?.paymentNo || (await generatePaymentNo("supplier")),
          vendor: vendorId,
          purchase: purchase._id,
          amount: paidNow,
          mode: paidMode(req.body.paidMode || atPurchase[0]?.mode),
          date: atPurchase[0]?.date || purchaseDate,
          note: PAID_AT_PURCHASE_NOTE,
          recordedBy: req.user._id,
        });
      }

      const populated = await Purchase.findById(purchase._id).populate("vendor", "name");
      await populated.populate("items.product", "name productCode packUnit soldAs unitsPerPack");
      res.json(populated);
    } catch (e) {
      rethrowIfRetryable(e);
      if (isDuplicateOf(e, "invoiceNo")) return res.status(409).json({ message: duplicateInvoiceMessage(vendorId) });
      if (e.name === "ValidationError") return res.status(400).json({ message: Object.values(e.errors)[0].message });
      console.error(e);
      res.status(500).json({ message: "Something went wrong. Nothing was changed - please try again." });
    }
  })
);

// Payments on a purchase: made with it (editable here) and later through the
// supplier ledger (protected).
async function purchasePayments(purchase) {
  const linked = purchase.vendor ? await SupplierPayment.find({ purchase: purchase._id }) : [];
  const atPurchase = linked.filter((p) => p.note === PAID_AT_PURCHASE_NOTE);
  const paidAtPurchase = round2(atPurchase.reduce((s, p) => s + p.amount, 0));
  const paidLater = purchase.paymentMode === "Credit" ? round2((purchase.amountPaid ?? 0) - paidAtPurchase) : 0;
  return { atPurchase, paidAtPurchase, paidLater, otherPayments: linked.length - atPurchase.length };
}

// What a purchase put into each batch (from its own stock ledger entries, so
// earlier edits are included), and at what cost per pack.
async function broughtIn(purchase) {
  const ledger = await StockLedger.find({ refId: purchase._id, type: { $in: ["purchase", "purchase-edit"] } });
  const qtyByBatch = new Map();
  for (const e of ledger) if (e.batch) qtyByBatch.set(String(e.batch), (qtyByBatch.get(String(e.batch)) || 0) + e.qtyChange);
  const costByBatch = new Map();
  for (const i of purchase.items) {
    if (!i.batch) continue;
    const c = costByBatch.get(String(i.batch)) || { value: 0, packs: 0 };
    c.value += i.qtyPacks * netUnitCost(i);
    c.packs += i.qtyPacks;
    costByBatch.set(String(i.batch), c);
  }
  const batches = await Batch.find({ _id: { $in: [...qtyByBatch.keys()] } });
  return { qtyByBatch, costByBatch, batches };
}

// Removes a purchase completely (Admin): every unit it brought in comes off
// its batches again, and what was paid with it goes too. Refused while any of
// that stock has been sold or used (correct the quantity with Edit instead),
// or while payments made later through the supplier ledger point at it.
router.delete(
  "/:id",
  transactional(async (req, res) => {
    const purchase = await Purchase.findById(req.params.id);
    if (!purchase) return res.status(404).json({ message: "No records found." });

    const { atPurchase, paidLater, otherPayments } = await purchasePayments(purchase);
    if (paidLater > 0 || otherPayments > 0) {
      return res.status(400).json({
        message: "Payments were made against this purchase from the supplier ledger. Delete those payments first, then delete the purchase.",
      });
    }

    const { qtyByBatch, costByBatch, batches } = await broughtIn(purchase);
    const productDelta = new Map();
    for (const b of batches) {
      const qty = qtyByBatch.get(String(b._id)) || 0;
      if (b.qtyRemaining < qty) {
        const p = await Product.findById(b.product);
        const used = qty - b.qtyRemaining;
        return res.status(400).json({
          message: `${p?.name || "A product"} batch ${b.batchNo}: ${used} ${stockUnitName(p)} from this purchase ${used === 1 ? "has" : "have"} already been sold or used, so it can't be deleted. Use Edit to correct it instead.`,
        });
      }
      productDelta.set(String(b.product), (productDelta.get(String(b.product)) || 0) - qty);
    }
    for (const [pid, delta] of productDelta) {
      const p = await Product.findById(pid);
      if (p && p.qty + delta < 0) {
        return res.status(400).json({ message: `Only ${p.qty} ${stockUnitName(p)} of ${p.name} left in stock, so this purchase can't be deleted.` });
      }
    }

    const reason = `Deleted purchase ${purchase.invoiceNo}`;
    for (const b of batches) {
      const qty = qtyByBatch.get(String(b._id)) || 0;
      if (qty === 0) continue;
      const c = costByBatch.get(String(b._id));
      const cost = c && c.packs > 0 ? c.value / c.packs : b.costPrice;
      const left = b.qtyReceived - qty;
      // Take this delivery's cost back out of the lot's blended cost.
      if (left > 0) b.costPrice = Number(Math.max((b.qtyReceived * b.costPrice - qty * cost) / left, 0).toFixed(4));
      b.qtyReceived = Math.max(left, 0);
      b.qtyRemaining -= qty;
      if (b.qtyReceived <= 0 && b.qtyRemaining <= 0) b.isDeleted = true;
      await b.save();
      await StockLedger.create({
        product: b.product,
        batch: b._id,
        type: "purchase-edit",
        qtyChange: -qty,
        rack: b.rack || "",
        reason,
        refId: purchase._id,
        performedBy: req.user._id,
      });
    }
    for (const [pid, delta] of productDelta) {
      if (delta !== 0) await Product.updateOne({ _id: pid }, { $inc: { qty: delta } });
      const p = await Product.findById(pid);
      if (p) await refreshProductRack(p);
    }
    await SupplierPayment.deleteMany({ _id: { $in: atPurchase.map((p) => p._id) } });
    await Purchase.deleteOne({ _id: purchase._id });
    res.json({ message: `Purchase ${purchase.invoiceNo} deleted.` });
  })
);

export default router;
