import { Router } from "express";
import mongoose from "mongoose";
import Purchase from "../models/Purchase.js";
import Vendor from "../models/Vendor.js";
import Product from "../models/Product.js";
import StockLedger from "../models/StockLedger.js";
import SupplierPayment from "../models/SupplierPayment.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { computeInternalQty } from "../utils/stockUnits.js";
import { upsertBatch, weightedAvgCost } from "../utils/batchHelpers.js";
import Batch from "../models/Batch.js";
import { cleanRack, rackPositionError } from "../utils/rack.js";
import { generatePaymentNo } from "../utils/ledgerHelpers.js";
import { nextSequence } from "../models/Counter.js";
import { generateProductCode, resolveCategory, computeLooseRate, deriveSoldAs } from "../utils/productHelpers.js";
import { streamExcelReport, streamPdfReport, periodLabel } from "../utils/reportExport.js";
import { dayRange } from "../utils/queryFilters.js";

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
async function attachPreviousRates(lines, supplierFilter) {
  for (const line of lines) {
    const find = (extra) => Purchase.findOne({ "items.product": line.product, ...extra }).sort({ date: -1, createdAt: -1 });
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
  res.json(purchase);
});

router.post("/", async (req, res) => {
  const { vendor, invoiceNo, date, items, tdsAmount, paymentMode, amountPaid } = req.body;

  if (!vendor) return res.status(400).json({ message: "This field is required." });
  if (!invoiceNo || !invoiceNo.trim()) return res.status(400).json({ message: "This field is required." });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "Add at least one product line before saving." });
  }

  const vendorDoc = await Vendor.findById(vendor);
  if (!vendorDoc || !vendorDoc.isActive) {
    return res.status(400).json({ message: "No records found." });
  }

  try {
    const resolvedItems = [];
    let subtotal = 0;
    let gstAmount = 0;

    for (const item of items) {
      const product = await Product.findById(item.product);
      if (!product) {
        return res.status(400).json({ message: "This field is required." });
      }
      const qtyPacks = Number(item.qtyPacks);
      const costPrice = Number(item.costPrice);
      if (!(qtyPacks > 0)) return res.status(400).json({ message: "Please enter a valid number." });
      if (!(costPrice >= 0)) return res.status(400).json({ message: "Please enter a valid number." });
      if (!item.batchNo) return res.status(400).json({ message: "This field is required." });
      if (!item.expiryDate) return res.status(400).json({ message: "Please enter a valid date." });
      const rack = cleanRack(item.rack);
      const rackError = await rackPositionError(item.rack);
      if (rackError) return res.status(400).json({ message: rackError });

      const lineAmount = Number((qtyPacks * costPrice).toFixed(2));
      const lineGst = Number(((lineAmount * product.gstPercent) / 100).toFixed(2));

      subtotal += lineAmount;
      gstAmount += lineGst;

      resolvedItems.push({
        product: product._id,
        qtyPacks,
        costPrice,
        batchNo: item.batchNo,
        expiryDate: item.expiryDate,
        rack,
        lineAmount,
        lineGst,
        _productDoc: product,
      });
    }

    subtotal = Number(subtotal.toFixed(2));
    gstAmount = Number(gstAmount.toFixed(2));
    const total = Number((subtotal + gstAmount).toFixed(2));

    // A non-Credit purchase is settled in full immediately; Credit is the
    // only mode that can carry a payable balance forward.
    const resolvedPaymentMode = paymentMode || "Credit";
    const resolvedAmountPaid =
      resolvedPaymentMode === "Credit" ? Math.min(Math.max(Number(amountPaid) || 0, 0), total) : total;

    await attachPreviousRates(resolvedItems, { vendor });
    const purchase = await Purchase.create({
      vendor,
      invoiceNo: invoiceNo.trim(),
      date,
      items: resolvedItems.map(({ _productDoc, ...rest }) => rest),
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

    await stockInPurchase(purchase, resolvedItems, date, req.user._id);

    const populated = await purchase.populate([
      { path: "vendor", select: "name" },
      { path: "items.product", select: "name productCode" },
    ]);
    res.status(201).json(populated);
  } catch (e) {
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

  if (!date) return res.status(400).json({ message: "Please enter a valid date." });
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
    const qtyPacks = Number(item.qtyPacks);
    const costPrice = Number(item.costPrice);
    const hasSelling = item.sellingPrice !== undefined && item.sellingPrice !== null && item.sellingPrice !== "";
    const sellingPrice = Number(item.sellingPrice);
    if (!(qtyPacks > 0) || !Number.isInteger(qtyPacks)) return res.status(400).json({ message: "Please enter a valid quantity." });
    if (!(costPrice >= 0)) return res.status(400).json({ message: "Please enter a valid purchase price." });
    if (hasSelling && !(sellingPrice > 0)) return res.status(400).json({ message: "Please enter a valid selling price." });
    if (!item.expiryDate || Number.isNaN(new Date(item.expiryDate).getTime())) {
      return res.status(400).json({ message: "Please enter a valid expiry date." });
    }
    const rackError = await rackPositionError(item.rack);
    if (rackError) return res.status(400).json({ message: rackError });

    let product = null;
    let newProduct = null;
    if (item.product) {
      product = mongoose.isValidObjectId(item.product) ? await Product.findById(item.product) : null;
      if (!product || !product.isActive) return res.status(400).json({ message: "Selected product was not found." });
    } else {
      const np = item.newProduct || {};
      const name = String(np.name || "").trim();
      if (!name) return res.status(400).json({ message: "Please enter the product name." });
      if (!String(np.category || "").trim()) return res.status(400).json({ message: "Please choose a category." });
      if (!PACK_UNITS.includes(np.packUnit)) return res.status(400).json({ message: "Please choose a pack unit." });
      if (!GST_VALUES.includes(Number(np.gstPercent))) return res.status(400).json({ message: "Please choose a GST rate." });
      if (!hasSelling) return res.status(400).json({ message: "Please enter a valid selling price." });
      const soldAs = deriveSoldAs(np.unitsPerPack);
      if (soldAs === "pack-and-loose" && !LOOSE_UNITS.includes(np.looseUnitName)) {
        return res.status(400).json({ message: "Please choose the loose unit." });
      }
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
        product =
          madeHere.get(newProduct.name.toLowerCase()) ||
          (await Product.findOne({ isActive: true, name: new RegExp(`^${escapeRegex(newProduct.name)}$`, "i") }));
      }
      if (newProduct && !product) {
        const category = await resolveCategory(String(newProduct.category).trim());
        product = await Product.create({
          name: newProduct.name,
          brand: String(newProduct.brand || "").trim(),
          productCode: await generateProductCode(newProduct.name),
          category: category._id,
          soldAs: newProduct.soldAs,
          packUnit: newProduct.packUnit,
          unitsPerPack: newProduct.soldAs === "pack-and-loose" ? Number(newProduct.unitsPerPack) : undefined,
          looseUnitName: newProduct.soldAs === "pack-and-loose" ? newProduct.looseUnitName : "",
          qty: 0,
          packRate: sellingPrice,
          looseRate: computeLooseRate({ soldAs: newProduct.soldAs, packRate: sellingPrice, unitsPerPack: newProduct.unitsPerPack }),
          gstPercent: Number(newProduct.gstPercent),
          rack,
          vendor: null,
        });
        createdProductIds.push(product._id);
        madeHere.set(newProduct.name.toLowerCase(), product);
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
        expiryDate: item.expiryDate,
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
      date,
      items: resolvedItems.map(({ _productDoc, ...rest }) => rest),
      subtotal,
      gstAmount,
      tdsAmount: 0,
      total,
      paymentMode: mode,
      amountPaid: total,
      createdBy: req.user._id,
    });

    await stockInPurchase(purchase, resolvedItems, date, req.user._id);

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

export default router;
