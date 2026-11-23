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
import { upsertBatch, weightedAvgCost, moveBetweenLocations, refreshProductRack } from "../utils/batchHelpers.js";
import { effectiveLocations } from "../utils/locations.js";
import Batch from "../models/Batch.js";
import { cleanRack, rackPositionError } from "../utils/rack.js";
import { generatePaymentNo } from "../utils/ledgerHelpers.js";
import { nextSequence } from "../models/Counter.js";
import { generateProductCode, resolveCategory, computeLooseRate, deriveSoldAs } from "../utils/productHelpers.js";
import { streamExcelReport, streamPdfReport, periodLabel } from "../utils/reportExport.js";
import { dayRange } from "../utils/queryFilters.js";
import { findOrCreateProduct, findProductByName } from "../utils/productAutoCreate.js";

const router = Router();
router.use(requireAuth, requireRole("admin"));

const PACK_UNITS = ["Strip", "Bottle", "Box", "Tube", "Vial", "Jar", "Piece"];
const LOOSE_UNITS = ["Tablet", "Capsule", "ml", "Piece"];
const GST_VALUES = [0, 5, 12, 18, 28];
// A purchase without a supplier has nobody to owe, so it's always paid up front.
const DIRECT_PAYMENT_MODES = ["Cash", "UPI", "Bank Transfer", "Cheque", "Other"];

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

// Stock-in shared by supplier and direct purchases: each line creates (or
// tops up, if this exact batch number already exists for the product) its own
// Batch row, so an older lot's expiry is never overwritten by a newer
// delivery's. `lines` carry their Product doc as _productDoc.
async function stockInPurchase(purchase, lines, date, userId) {
  for (let i = 0; i < lines.length; i++) {
    const item = lines[i];
    const product = item._productDoc;
    const addQty = computeInternalQty({
      soldAs: product.soldAs,
      unitsPerPack: product.unitsPerPack,
      qtyPacks: item.qtyPacks,
      qtyLooseExtra: 0,
    });

    const batch = await upsertBatch({
      product,
      batchNo: item.batchNo,
      expiryDate: item.expiryDate,
      costPrice: item.costPrice,
      addQty,
      receivedAt: date,
      purchase: purchase._id,
      rack: item.rack,
    });
    purchase.items[i].batch = batch._id;

    product.qty += addQty;
    product.rack = item.rack;
    await product.save();

    await StockLedger.create({
      product: product._id,
      batch: batch._id,
      type: "purchase",
      qtyChange: addQty,
      rack: item.rack || "",
      reason: purchase.vendor ? `Purchase invoice ${purchase.invoiceNo}` : `Direct purchase ${purchase.invoiceNo} (no supplier)`,
      refId: purchase._id,
      performedBy: userId,
    });
  }
  await purchase.save();
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
  for (const line of lines) {
    const notThis = excludeId ? { _id: { $ne: excludeId } } : {};
    const find = (extra) => Purchase.findOne({ "items.product": line.product, ...notThis, ...extra }).sort({ date: -1, createdAt: -1 });
    const doc = (supplierFilter ? await find(supplierFilter) : null) || (await find({}));
    const item = doc && [...doc.items].reverse().find((i) => String(i.product) === String(line.product));
    line.previousCostPrice = item ? item.costPrice : null;
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
  const atPurchase = purchase.vendor ? await SupplierPayment.find({ purchase: purchase._id, note: "Paid at purchase" }) : [];
  const paidAtPurchase = Number(atPurchase.reduce((s, p) => s + p.amount, 0).toFixed(2));
  const paidLater = purchase.paymentMode === "Credit" ? Number(((purchase.amountPaid ?? 0) - paidAtPurchase).toFixed(2)) : 0;
  res.json({ ...purchase.toObject(), paidAtPurchase, paidLater });
});

router.post("/", async (req, res) => {
  const { vendor, invoiceNo, date, items, tdsAmount, paymentMode, amountPaid } = req.body;

  // The supplier is what this route is for (no supplier -> POST /direct).
  if (!vendor) return res.status(400).json({ message: "Choose a supplier, or use Purchase Without Supplier." });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "Add at least one product line before saving." });
  }

  const vendorDoc = await Vendor.findById(vendor);
  if (!vendorDoc || !vendorDoc.isActive) {
    return res.status(400).json({ message: "No records found." });
  }

  const createdProductIds = [];
  let purchase = null;
  try {
    const resolvedItems = [];
    let subtotal = 0;
    let gstAmount = 0;

    for (const item of items) {
      let product = mongoose.isValidObjectId(item.product) ? await Product.findById(item.product) : null;
      // A product typed by name: an existing one (ignoring case and spaces)
      // is used; a new name is added to the Product List once every line
      // has been checked (below), so a bad line never leaves products behind.
      let pendingNew = null;
      if (!product || !product.isActive) {
        const np = item.newProduct || {};
        const name = String(np.name || "").trim();
        if (!name) return res.status(400).json({ message: "Choose the product for each line (or remove empty lines)." });
        const match = await findProductByName(name);
        if (match) product = await Product.findById(match._id);
        else {
          const gst = np.gstPercent === undefined || np.gstPercent === "" || np.gstPercent === null ? 0 : Number(np.gstPercent);
          if (!GST_VALUES.includes(gst)) return res.status(400).json({ message: `Choose a valid GST rate for ${name}.` });
          pendingNew = { name, hsnCode: np.hsnCode, unit: np.unit, gstPercent: gst, rate: np.sellingPrice };
          product = { name, gstPercent: gst };
        }
      }
      // Product and quantity are what a stock-in is; everything else is
      // optional (cost 0, batch no = invoice no, no expiry, No Rack).
      const qtyPacks = Number(item.qtyPacks);
      const costPrice = optionalNumber(item.costPrice);
      if (!(qtyPacks > 0)) return res.status(400).json({ message: `Enter the quantity for ${product.name}.` });
      if (!(costPrice >= 0)) return res.status(400).json({ message: "Please enter a valid number." });
      if (item.expiryDate && Number.isNaN(new Date(item.expiryDate).getTime())) return res.status(400).json({ message: "Please enter a valid date." });
      const rack = cleanRack(item.rack);
      const rackError = await rackPositionError(item.rack, { required: false });
      if (rackError) return res.status(400).json({ message: rackError });

      const lineAmount = Number((qtyPacks * costPrice).toFixed(2));
      const lineGst = Number(((lineAmount * product.gstPercent) / 100).toFixed(2));

      subtotal += lineAmount;
      gstAmount += lineGst;

      resolvedItems.push({
        product: product._id,
        qtyPacks,
        costPrice,
        batchNo: String(item.batchNo || "").trim(),
        expiryDate: item.expiryDate || null,
        rack,
        lineAmount,
        lineGst,
        _productDoc: product,
        _pendingNew: pendingNew,
      });
    }

    // Every line is valid: add the new products to the Product List.
    const madeHere = new Map();
    for (const it of resolvedItems) {
      if (!it._pendingNew) continue;
      const { product, created } = await findOrCreateProduct(it._pendingNew.name, { ...it._pendingNew, vendor: vendorDoc._id }, madeHere);
      if (created) createdProductIds.push(product._id);
      it.product = product._id;
      it._productDoc = product;
    }

    subtotal = Number(subtotal.toFixed(2));
    gstAmount = Number(gstAmount.toFixed(2));
    const total = Number((subtotal + gstAmount).toFixed(2));

    // A non-Credit purchase is settled in full immediately; Credit is the
    // only mode that can carry a payable balance forward.
    const resolvedPaymentMode = paymentMode || "Credit";
    const resolvedAmountPaid =
      resolvedPaymentMode === "Credit" ? Math.min(Math.max(Number(amountPaid) || 0, 0), total) : total;

    const resolvedInvoiceNo = String(invoiceNo || "").trim() || `PUR-${String(await nextSequence("purchaseNo")).padStart(6, "0")}`;
    for (const it of resolvedItems) if (!it.batchNo) it.batchNo = resolvedInvoiceNo;
    await attachPreviousRates(resolvedItems, { vendor });
    purchase = await Purchase.create({
      vendor,
      invoiceNo: resolvedInvoiceNo,
      date: date || new Date(),
      items: resolvedItems.map(({ _productDoc, _pendingNew, ...rest }) => rest),
      subtotal,
      gstAmount,
      tdsAmount: Number(tdsAmount) || 0,
      total,
      paymentMode: resolvedPaymentMode,
      amountPaid: resolvedAmountPaid,
      createdBy: req.user._id,
    });

    if (resolvedPaymentMode === "Credit" && resolvedAmountPaid > 0) {
      const paymentNo = await generatePaymentNo("supplier");
      await SupplierPayment.create({
        paymentNo,
        vendor,
        purchase: purchase._id,
        amount: resolvedAmountPaid,
        note: "Paid at purchase",
        recordedBy: req.user._id,
      });
    }

    await stockInPurchase(purchase, resolvedItems, purchase.date, req.user._id);

    const populated = await purchase.populate([
      { path: "vendor", select: "name" },
      { path: "items.product", select: "name productCode" },
    ]);
    res.status(201).json({ ...populated.toObject(), createdProducts: createdProductIds.length });
  } catch (e) {
    // The purchase wasn't saved: take back products made just for it.
    if (!purchase && createdProductIds.length) await Product.deleteMany({ _id: { $in: createdProductIds } }).catch(() => {});
    if (e.code === 11000) {
      return res.status(409).json({ message: "This invoice number has already been recorded for this vendor." });
    }
    if (e.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(e.errors)[0].message });
    }
    console.error(e);
    res.status(500).json({ message: "Something went wrong. Please try again." });
  }
});

// Purchase from an unregistered supplier (supplierName given) or with no
// supplier at all. Each line is an existing product or a new one described
// inline; a "new" product whose name matches an existing product is not
// duplicated - the stock goes onto the existing master product. Always paid
// up front, so it never touches supplier ledgers.
router.post("/direct", async (req, res) => {
  const { invoiceNo, supplierName, date, items, paymentMode } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "Add at least one product line before saving." });
  }
  const mode = paymentMode || "Cash";
  if (!DIRECT_PAYMENT_MODES.includes(mode)) {
    return res.status(400).json({ message: "A purchase without a supplier is paid up front - choose Cash, UPI, Bank Transfer, Cheque or Other." });
  }

  // Validate every line before creating anything, so a bad line never leaves
  // half-made products behind.
  const prepared = [];
  for (const item of items) {
    // Only the quantity is needed for a stock-in; the rest is optional.
    const qtyPacks = Number(item.qtyPacks);
    const costPrice = optionalNumber(item.costPrice);
    const hasSelling = item.sellingPrice !== undefined && item.sellingPrice !== null && item.sellingPrice !== "";
    const sellingPrice = Number(item.sellingPrice);
    if (!(qtyPacks > 0) || !Number.isInteger(qtyPacks)) return res.status(400).json({ message: "Please enter a valid quantity." });
    if (!(costPrice >= 0)) return res.status(400).json({ message: "Please enter a valid purchase price." });
    if (hasSelling && !(sellingPrice >= 0)) return res.status(400).json({ message: "Please enter a valid selling price." });
    if (item.expiryDate && Number.isNaN(new Date(item.expiryDate).getTime())) {
      return res.status(400).json({ message: "Please enter a valid expiry date." });
    }
    const rackError = await rackPositionError(item.rack, { required: false });
    if (rackError) return res.status(400).json({ message: rackError });

    let product = null;
    let newProduct = null;
    if (item.product) {
      product = mongoose.isValidObjectId(item.product) ? await Product.findById(item.product) : null;
      if (!product || !product.isActive) return res.status(400).json({ message: "Selected product was not found." });
    } else {
      // A new product line: every detail optional, with the same defaults
      // as Add Product (auto name, Uncategorized, Strip, 0% GST, price 0).
      const np = { ...(item.newProduct || {}) };
      const name = String(np.name || "").trim();
      if (!String(np.category || "").trim()) np.category = "Uncategorized";
      if (!np.packUnit) np.packUnit = "Strip";
      if (np.gstPercent === undefined || np.gstPercent === null || np.gstPercent === "") np.gstPercent = 0;
      if (!PACK_UNITS.includes(np.packUnit)) return res.status(400).json({ message: "Please choose a valid pack unit." });
      if (!GST_VALUES.includes(Number(np.gstPercent))) return res.status(400).json({ message: "Please choose a valid GST rate." });
      const soldAs = deriveSoldAs(np.unitsPerPack);
      if (soldAs === "pack-and-loose" && !LOOSE_UNITS.includes(np.looseUnitName)) np.looseUnitName = "Piece";
      newProduct = { ...np, name, soldAs };
    }
    prepared.push({ item, qtyPacks, costPrice, sellingPrice: hasSelling ? sellingPrice : null, product, newProduct });
  }

  const createdProductIds = [];
  let purchase = null;
  try {
    const resolvedInvoiceNo =
      String(invoiceNo || "").trim() || `DP-${String(await nextSequence("directPurchaseNo")).padStart(6, "0")}`;

    const resolvedItems = [];
    let subtotal = 0;
    let gstAmount = 0;

    const madeHere = new Map(); // lowercased name -> product created by an earlier line
    for (const { item, qtyPacks, costPrice, sellingPrice, product: existing, newProduct } of prepared) {
      const rack = cleanRack(item.rack);
      let product = existing;
      if (newProduct) {
        product = newProduct.name
          ? madeHere.get(newProduct.name.toLowerCase()) ||
            // Same name ignoring case, spaces and punctuation = same product.
            (await Product.findOne({ _id: (await findProductByName(newProduct.name))?._id ?? null }))
          : null;
      }
      if (newProduct && !product) {
        const category = await resolveCategory(String(newProduct.category).trim());
        const productCode = await generateProductCode(newProduct.name);
        product = await Product.create({
          name: newProduct.name || `Product ${productCode}`,
          brand: String(newProduct.brand || "").trim(),
          productCode,
          category: category._id,
          soldAs: newProduct.soldAs,
          packUnit: newProduct.packUnit,
          unitsPerPack: newProduct.soldAs === "pack-and-loose" ? Number(newProduct.unitsPerPack) : undefined,
          looseUnitName: newProduct.soldAs === "pack-and-loose" ? newProduct.looseUnitName : "",
          qty: 0,
          packRate: sellingPrice ?? 0,
          looseRate: computeLooseRate({ soldAs: newProduct.soldAs, packRate: sellingPrice ?? 0, unitsPerPack: newProduct.unitsPerPack }) ?? 0,
          gstPercent: Number(newProduct.gstPercent),
          rack,
          vendor: null,
        });
        createdProductIds.push(product._id);
        if (newProduct.name) madeHere.set(newProduct.name.toLowerCase(), product);
      } else if (sellingPrice !== null && sellingPrice !== product.packRate) {
        // A new selling price entered for an existing product becomes its
        // current price (saved along with the stock-in below).
        product.packRate = sellingPrice;
        product.looseRate = computeLooseRate({ soldAs: product.soldAs, packRate: sellingPrice, unitsPerPack: product.unitsPerPack });
      }

      const lineAmount = Number((qtyPacks * costPrice).toFixed(2));
      const lineGst = Number(((lineAmount * product.gstPercent) / 100).toFixed(2));
      subtotal += lineAmount;
      gstAmount += lineGst;

      resolvedItems.push({
        product: product._id,
        qtyPacks,
        costPrice,
        batchNo: String(item.batchNo || "").trim() || resolvedInvoiceNo,
        expiryDate: item.expiryDate || null,
        rack,
        lineAmount,
        lineGst,
        _productDoc: product,
      });
    }

    subtotal = Number(subtotal.toFixed(2));
    gstAmount = Number(gstAmount.toFixed(2));
    const total = Number((subtotal + gstAmount).toFixed(2));

    const cleanSupplierName = String(supplierName || "").trim();
    await attachPreviousRates(
      resolvedItems,
      cleanSupplierName
        ? { vendor: null, supplierName: new RegExp(`^${escapeRegex(cleanSupplierName)}$`, "i") }
        : { vendor: null, supplierName: { $in: ["", null] } }
    );
    purchase = await Purchase.create({
      vendor: null,
      supplierName: String(supplierName || "").trim(),
      invoiceNo: resolvedInvoiceNo,
      date: date || new Date(),
      items: resolvedItems.map(({ _productDoc, ...rest }) => rest),
      subtotal,
      gstAmount,
      tdsAmount: 0,
      total,
      paymentMode: mode,
      amountPaid: total,
      createdBy: req.user._id,
    });

    await stockInPurchase(purchase, resolvedItems, purchase.date, req.user._id);

    const populated = await purchase.populate([{ path: "items.product", select: "name productCode" }]);
    res.status(201).json(populated);
  } catch (e) {
    // Nothing was stocked in yet, so products made for this purchase go too.
    if (!purchase && createdProductIds.length) await Product.deleteMany({ _id: { $in: createdProductIds } });
    if (e.code === 11000) {
      return res.status(409).json({ message: "This invoice number has already been recorded for a purchase without a supplier." });
    }
    if (e.name === "ValidationError") {
      return res.status(400).json({ message: Object.values(e.errors)[0].message });
    }
    console.error(e);
    res.status(500).json({ message: "Something went wrong. Please try again." });
  }
});

const PAID_AT_PURCHASE_NOTE = "Paid at purchase";
const round2 = (n) => Number(Number(n).toFixed(2));
const stockUnitName = (p) => (p?.soldAs === "pack-and-loose" ? p.looseUnitName : p?.packUnit) || "units";

// Corrects a saved purchase (supplier, invoice no, date, products, qty, rate,
// batch, expiry, rack, payment). Stock is reconciled per batch: each lot this
// purchase brought in is raised or lowered by the difference, so stock that
// was already sold from it stays accounted for - a quantity can't be cut
// below what's already gone. A supplier purchase can't become a direct one
// (or the reverse). Payments made later through the supplier ledger are
// protected: such a purchase stays on Credit with the same supplier and its
// total can't drop below what was paid.
router.put("/:id", async (req, res) => {
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
  const clash = await Purchase.exists({ _id: { $ne: purchase._id }, vendor: isDirect ? null : vendorId, invoiceNo: resolvedInvoiceNo });
  if (clash) {
    return res.status(409).json({
      message: isDirect ? "This invoice number has already been recorded for a purchase without a supplier." : "This invoice number has already been recorded for this vendor.",
    });
  }

  // What was paid at purchase can be corrected freely; payments made later
  // through the supplier ledger can't be undone from here.
  const billingPayments = isDirect ? [] : await SupplierPayment.find({ purchase: purchase._id, note: PAID_AT_PURCHASE_NOTE });
  const paidAtPurchase = round2(billingPayments.reduce((s, p) => s + p.amount, 0));
  const paidLater = purchase.paymentMode === "Credit" ? round2((purchase.amountPaid ?? 0) - paidAtPurchase) : 0;
  if (paidLater > 0) {
    if (mode !== "Credit") {
      return res.status(400).json({ message: `₹${paidLater.toFixed(2)} has already been paid against this credit purchase, so it has to stay on Credit.` });
    }
    if (vendorChanged) {
      return res.status(400).json({ message: "Payments are already recorded against this purchase for its supplier, so the supplier can't be changed." });
    }
  }

  // Validate every line before touching any stock.
  const lines = [];
  for (const item of items) {
    const product = mongoose.isValidObjectId(item.product) ? await Product.findById(item.product) : null;
    const sameProduct = (i) => String(i.product) === String(item.product);
    const original =
      purchase.items.find((i) => sameProduct(i) && i.batchNo === String(item.batchNo || "").trim()) || purchase.items.find(sameProduct);
    if (!product || (!product.isActive && !original)) {
      return res.status(400).json({ message: "Choose the product for each line (or remove empty lines)." });
    }
    const qtyPacks = Number(item.qtyPacks);
    const costPrice = optionalNumber(item.costPrice);
    if (!(qtyPacks > 0) || !Number.isInteger(qtyPacks)) return res.status(400).json({ message: `Enter the quantity for ${product.name}.` });
    if (!(costPrice >= 0)) return res.status(400).json({ message: "Please enter a valid purchase price." });
    if (item.expiryDate && Number.isNaN(new Date(item.expiryDate).getTime())) return res.status(400).json({ message: "Please enter a valid expiry date." });
    const rack = cleanRack(item.rack);
    const origRack = original ? cleanRack(original.rack) : undefined;
    if (origRack !== rack) {
      const rackError = await rackPositionError(item.rack, { required: false });
      if (rackError) return res.status(400).json({ message: rackError });
    }
    const batchNo = String(item.batchNo || "").trim() || resolvedInvoiceNo;
    if (batchNo.length > 30) return res.status(400).json({ message: "Batch number can be at most 30 characters." });

    const lineAmount = round2(qtyPacks * costPrice);
    lines.push({
      product: product._id,
      qtyPacks,
      costPrice,
      batchNo,
      expiryDate: item.expiryDate || null,
      rack,
      lineAmount,
      lineGst: round2((lineAmount * product.gstPercent) / 100),
      previousCostPrice: original ? original.previousCostPrice : undefined,
      _productDoc: product,
      _addQty: computeInternalQty({ soldAs: product.soldAs, unitsPerPack: product.unitsPerPack, qtyPacks, qtyLooseExtra: 0 }),
      _rackChanged: origRack !== undefined && origRack !== rack,
    });
  }

  const subtotal = round2(lines.reduce((s, l) => s + l.lineAmount, 0));
  const gstAmount = round2(lines.reduce((s, l) => s + l.lineGst, 0));
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

  // What this purchase actually put into each batch (from its own stock
  // ledger entries, so earlier edits are included) and at what rate.
  const ledger = await StockLedger.find({ refId: purchase._id, type: { $in: ["purchase", "purchase-edit"] } });
  const oldQtyByBatch = new Map();
  for (const e of ledger) if (e.batch) oldQtyByBatch.set(String(e.batch), (oldQtyByBatch.get(String(e.batch)) || 0) + e.qtyChange);
  const oldCostByBatch = new Map();
  for (const i of purchase.items) {
    if (!i.batch) continue;
    const c = oldCostByBatch.get(String(i.batch)) || { value: 0, packs: 0 };
    c.value += i.qtyPacks * i.costPrice;
    c.packs += i.qtyPacks;
    oldCostByBatch.set(String(i.batch), c);
  }
  const oldBatches = await Batch.find({ _id: { $in: [...oldQtyByBatch.keys()] } });

  // Corrected lines grouped by the lot they go into.
  const groups = new Map();
  for (const l of lines) {
    const key = `${l.product}|${l.batchNo}`;
    const g = groups.get(key) || { product: l._productDoc, batchNo: l.batchNo, qty: 0, value: 0, expiryDate: null, rack: l.rack, rackChanged: false, lines: [] };
    g.qty += l._addQty;
    g.value += l._addQty * l.costPrice;
    if (l.expiryDate) g.expiryDate = l.expiryDate;
    g.rack = l.rack;
    g.rackChanged = g.rackChanged || l._rackChanged;
    g.lines.push(l);
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

  const newLines = lines.filter((l) => l.previousCostPrice === undefined);
  if (newLines.length) {
    const cleanSupplierName = String(supplierName ?? purchase.supplierName ?? "").trim();
    const supplierFilter = !isDirect
      ? { vendor: vendorId }
      : cleanSupplierName
        ? { vendor: null, supplierName: new RegExp(`^${escapeRegex(cleanSupplierName)}$`, "i") }
        : { vendor: null, supplierName: { $in: ["", null] } };
    await attachPreviousRates(newLines, supplierFilter, purchase._id);
  }

  const purchaseDate = date ? new Date(date) : purchase.date;
  purchase.set({
    vendor: isDirect ? null : vendorId,
    supplierName: isDirect ? String(supplierName ?? purchase.supplierName ?? "").trim() : purchase.supplierName,
    invoiceNo: resolvedInvoiceNo,
    date: purchaseDate,
    items: lines.map(({ _productDoc, _addQty, _rackChanged, ...rest }) => rest),
    subtotal,
    gstAmount,
    tdsAmount: isDirect ? 0 : Number(tdsAmount) || 0,
    total,
    paymentMode: mode,
    amountPaid: resolvedAmountPaid,
    editedAt: new Date(),
    editedBy: req.user._id,
  });
  try {
    await purchase.validate();
  } catch (e) {
    return res.status(400).json({ message: e.errors ? Object.values(e.errors)[0].message : "Please check the details and try again." });
  }

  try {
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
    for (const g of groups.values()) {
      if (g.rack && (g.rackChanged || !g.matched)) await Product.updateOne({ _id: g.product._id }, { $set: { rack: g.rack } });
    }
    const touched = new Set([...productDelta.keys(), ...lines.map((l) => String(l.product))]);
    for (const pid of touched) {
      const p = await Product.findById(pid);
      if (p) await refreshProductRack(p);
    }

    lines.forEach((l, i) => (purchase.items[i].batch = l.batch || null));
    await purchase.save();
    await markInvoiceChanged("purchase", purchase._id, "edited");

    await SupplierPayment.deleteMany({ _id: { $in: billingPayments.map((p) => p._id) } });
    if (mode === "Credit" && paidNow > 0) {
      await SupplierPayment.create({
        paymentNo: billingPayments[0]?.paymentNo || (await generatePaymentNo("supplier")),
        vendor: vendorId,
        purchase: purchase._id,
        amount: paidNow,
        mode: billingPayments[0]?.mode || "Cash",
        date: billingPayments[0]?.date || purchaseDate,
        note: PAID_AT_PURCHASE_NOTE,
        recordedBy: req.user._id,
      });
    }

    const populated = await Purchase.findById(purchase._id)
      .populate("vendor", "name")
      .populate("items.product", "name productCode packUnit soldAs unitsPerPack");
    res.json(populated);
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ message: "This invoice number has already been recorded for this vendor." });
    console.error(e);
    res.status(500).json({ message: "Something went wrong. Please try again." });
  }
});

// Removes a purchase completely (Admin): every unit it brought in comes off
// its batches again, and what was paid with it goes too. Refused while any of
// that stock has been sold or used (correct the quantity with Edit instead),
// or while payments made later through the supplier ledger point at it.
router.delete("/:id", async (req, res) => {
  const purchase = await Purchase.findById(req.params.id);
  if (!purchase) return res.status(404).json({ message: "No records found." });

  const linked = purchase.vendor ? await SupplierPayment.find({ purchase: purchase._id }) : [];
  const atPurchase = linked.filter((p) => p.note === PAID_AT_PURCHASE_NOTE);
  const paidAtPurchase = round2(atPurchase.reduce((s, p) => s + p.amount, 0));
  const paidLater = purchase.paymentMode === "Credit" ? round2((purchase.amountPaid ?? 0) - paidAtPurchase) : 0;
  if (paidLater > 0 || linked.length > atPurchase.length) {
    return res.status(400).json({
      message: "Payments were made against this purchase from the supplier ledger. Delete those payments first, then delete the purchase.",
    });
  }

  const ledger = await StockLedger.find({ refId: purchase._id, type: { $in: ["purchase", "purchase-edit"] } });
  const qtyByBatch = new Map();
  for (const e of ledger) if (e.batch) qtyByBatch.set(String(e.batch), (qtyByBatch.get(String(e.batch)) || 0) + e.qtyChange);
  const costByBatch = new Map();
  for (const i of purchase.items) {
    if (!i.batch) continue;
    const c = costByBatch.get(String(i.batch)) || { value: 0, packs: 0 };
    c.value += i.qtyPacks * i.costPrice;
    c.packs += i.qtyPacks;
    costByBatch.set(String(i.batch), c);
  }
  const batches = await Batch.find({ _id: { $in: [...qtyByBatch.keys()] } });

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

  try {
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
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Something went wrong. Please try again." });
  }
});

export default router;
