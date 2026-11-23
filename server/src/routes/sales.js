import { Router } from "express";
import mongoose from "mongoose";
import Sale from "../models/Sale.js";
import Product from "../models/Product.js";
import Customer from "../models/Customer.js";
import StockLedger from "../models/StockLedger.js";
import CustomerPayment from "../models/CustomerPayment.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { saleLineInternalQty, generateBillNo, buildBillText } from "../utils/saleHelpers.js";
import { streamBillPdf } from "../utils/billPdf.js";
import { markInvoiceChanged } from "../utils/invoiceArchive.js";
import { allocateFefo, allocateFromBatch, reverseBreakdown, earliestActiveBatch, landLegacyReturn } from "../utils/batchHelpers.js";
import Batch from "../models/Batch.js";
import { effectiveLocations } from "../utils/locations.js";
import { cleanRack } from "../utils/rack.js";
import { generatePaymentNo } from "../utils/ledgerHelpers.js";
import { streamExcelReport, streamPdfReport } from "../utils/reportExport.js";
import { dayRange } from "../utils/queryFilters.js";

const router = Router();
router.use(requireAuth);

function canAccessSale(sale, user) {
  return user.role === "admin" || String(sale.createdBy) === String(user._id);
}

// Shared by the list and its export, so a download always matches the screen.
// paymentMode/status/category let dashboard links open a pre-filtered list.
async function buildSaleFilter(req) {
  const { q, from, to, paymentMode, status, category, payment } = req.query;
  const filter = {};
  if (req.user.role === "staff") filter.createdBy = req.user._id;
  // Search by bill number or customer name / phone.
  if (q && String(q).trim()) {
    const re = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const customers = await Customer.find({ $or: [{ name: re }, { phone: re }] }, "_id").limit(200);
    filter.$or = [{ billNo: re }, { customer: { $in: customers.map((c) => c._id) } }];
  }
  // Payment status: fully paid, partly paid, or nothing paid yet (credit).
  const paid = { $ifNull: ["$amountPaid", "$total"] };
  if (payment === "paid") filter.$expr = { $gte: [paid, "$total"] };
  if (payment === "partial") filter.$expr = { $and: [{ $gt: [paid, 0] }, { $lt: [paid, "$total"] }] };
  if (payment === "unpaid") filter.$expr = { $and: [{ $lte: [paid, 0] }, { $gt: ["$total", 0] }] };
  const range = dayRange(from, to);
  if (range) filter.createdAt = range;
  if (paymentMode) filter.paymentMode = paymentMode;
  if (status === "completed" || status === "void") filter.paymentStatus = status;
  if (category && mongoose.isValidObjectId(category)) {
    const ids = (await Product.find({ category }, "_id")).map((p) => p._id);
    filter["items.product"] = { $in: ids };
  }
  return filter;
}

router.get("/", async (req, res) => {
  const filter = await buildSaleFilter(req);

  const sales = await Sale.find(filter)
    .populate("customer", "name phone")
    .populate("createdBy", "username")
    .sort({ createdAt: -1 })
    .limit(200);
  res.json(sales);
});

// Registered before GET "/:id" - both are single-segment GET routes, and
// Express matches in registration order, so this must come first or "/:id"
// would treat "export" as a sale id.
router.get("/export", async (req, res) => {
  const { format } = req.query;
  const filter = await buildSaleFilter(req);

  const sales = await Sale.find(filter).populate("customer", "name phone").populate("createdBy", "username").sort({ createdAt: -1 });
  const rows = sales.map((s) => ({
    billNo: s.billNo,
    date: s.createdAt.toISOString().slice(0, 10),
    customer: s.customer?.name || "Walk-in",
    paymentMode: s.paymentMode,
    subtotal: s.subtotal,
    gst: s.gstAmount,
    discount: s.discount,
    total: s.total,
    amountPaid: s.amountPaid ?? s.total,
    balanceDue: s.balanceDue,
    status: s.paymentStatus,
  }));

  if (format === "pdf") {
    return streamPdfReport(res, "GuganMedicals_Sales_Report.pdf", {
      title: "Gugan Medicals - Sales Report",
      subtitle: `${rows.length} bill(s)`,
      columns: [
        { header: "Bill No", key: "billNo" },
        { header: "Date", key: "date" },
        { header: "Customer", key: "customer" },
        { header: "Mode", key: "paymentMode" },
        { header: "Total", key: "total", align: "right" },
        { header: "Balance Due", key: "balanceDue", align: "right" },
        { header: "Status", key: "status" },
      ],
      rows,
    });
  }

  return streamExcelReport(res, "GuganMedicals_Sales_Report.xlsx", [
    {
      name: "Sales",
      columns: [
        { header: "Bill No", key: "billNo", width: 16 },
        { header: "Date", key: "date", width: 14 },
        { header: "Customer", key: "customer", width: 20 },
        { header: "Payment Mode", key: "paymentMode", width: 14 },
        { header: "Subtotal", key: "subtotal", width: 12 },
        { header: "GST", key: "gst", width: 12 },
        { header: "Discount", key: "discount", width: 12 },
        { header: "Total", key: "total", width: 12 },
        { header: "Amount Paid", key: "amountPaid", width: 12 },
        { header: "Balance Due", key: "balanceDue", width: 12 },
        { header: "Status", key: "status", width: 12 },
      ],
      rows,
    },
  ]);
});

router.get("/:id", async (req, res) => {
  const sale = await Sale.findById(req.params.id).populate("customer", "name phone").populate("createdBy", "username");
  if (!sale) return res.status(404).json({ message: "No records found." });
  if (!canAccessSale(sale, req.user)) return res.status(403).json({ message: "You do not have permission to perform this action." });
  // Split of amountPaid for the edit form: received at billing (editable) vs
  // collected later through the customer ledger (protected).
  const atBilling = await CustomerPayment.find({ sale: sale._id, note: "Received at billing" });
  const receivedAtBilling = Number(atBilling.reduce((s, p) => s + p.amount, 0).toFixed(2));
  const collectedLater = sale.paymentMode === "Credit" ? Number(((sale.amountPaid ?? 0) - receivedAtBilling).toFixed(2)) : 0;
  res.json({ ...sale.toObject(), billText: buildBillText(sale), receivedAtBilling, collectedLater });
});

router.get("/:id/pdf", async (req, res) => {
  const sale = await Sale.findById(req.params.id).populate("customer", "name phone").populate("createdBy", "username");
  if (!sale) return res.status(404).json({ message: "No records found." });
  if (!canAccessSale(sale, req.user)) return res.status(403).json({ message: "You do not have permission to perform this action." });
  streamBillPdf(sale, res);
});

// Also used by Sales Entry (routes/salesEntries.js), which calls these
// handlers directly with req.fromSalesEntry set: the rate, GST and discount
// typed on the entry are then used instead of the product's own, and the
// bill carries the entry's SALES number. Plain API requests can't set it.
// A Sales Entry line can also be marked noStock: it's sold without touching
// stock (no stock recorded for it), so it has no batches and no cost.
const linkedEntryMessage = (sale) =>
  `This bill was made from Sales Entry ${sale.archiveNo || ""}. Edit or delete it from Sales Entry so both stay the same.`;

export async function createSaleHandler(req, res) {
  const { customer, items, paymentMode, discount, overrideExpiredReason, amountReceived } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "Add at least one product to the cart before completing payment." });
  }
  let customerId = null;
  if (customer) {
    const customerDoc = typeof customer === "string" ? await Customer.findById(customer).catch(() => null) : null;
    if (!customerDoc) return res.status(400).json({ message: "No records found." });
    customerId = customerDoc._id;
  }
  if (paymentMode === "Credit" && !customerId) {
    return res.status(400).json({ message: "A customer must be selected for a credit sale." });
  }

  const isAdmin = req.user.role === "admin";
  const now = new Date();
  const resolved = [];

  try {
    for (const item of items) {
      const product = await Product.findById(item.product);
      if (!product || !product.isActive) {
        return res.status(400).json({ message: "This product is no longer available." });
      }
      if (item.unitType === "loose" && product.soldAs !== "pack-and-loose") {
        return res.status(400).json({ message: "This product cannot be sold loose." });
      }

      // FEFO means the batch that's about to run out first is always the one
      // a sale would actually draw from, so that's the expiry that matters here.
      // A line can name the exact lot the cashier picked; otherwise FEFO.
      let pickedBatch = null;
      if (item.batch) {
        pickedBatch = mongoose.isValidObjectId(item.batch)
          ? await Batch.findOne({ _id: item.batch, product: product._id, isDeleted: { $ne: true } })
          : null;
        if (!pickedBatch) return res.status(400).json({ message: `The selected batch of ${product.name} is no longer available.` });
      }
      const noStock = Boolean(req.fromSalesEntry && item.noStock);
      const nextBatch = noStock ? null : pickedBatch || (await earliestActiveBatch(product._id));
      const isExpired = Boolean(nextBatch?.expiryDate) && new Date(nextBatch.expiryDate) < now;
      // An admin can knowingly sell expired stock; the reason note is optional.
      const overriding = isAdmin && (req.body.overrideExpired === true || Boolean(overrideExpiredReason));
      if (isExpired && !overriding) {
        return res.status(400).json({ message: `The next batch of ${product.name} has expired and cannot be sold. Clear the expired stock in Inventory first.` });
      }

      const qty = Number(item.qty);
      if (!(qty > 0)) return res.status(400).json({ message: "Please enter a valid number." });

      const internalQty = saleLineInternalQty(product, item.unitType, qty);
      const fromEntry = Boolean(req.fromSalesEntry);
      const rate = fromEntry && item.rate != null ? Number(item.rate) : item.unitType === "pack" ? product.packRate : product.looseRate;
      const unitLabel = item.unitType === "pack" ? product.packUnit : product.looseUnitName;
      const amount = Number((qty * rate).toFixed(2));
      const lineGstPercent = fromEntry && item.gstPercent != null ? Number(item.gstPercent) : product.gstPercent;
      const gstAmount = fromEntry && item.gstAmount != null ? Number(Number(item.gstAmount).toFixed(2)) : Number(((amount * lineGstPercent) / 100).toFixed(2));

      const unitName = product.soldAs === "pack-and-loose" ? product.looseUnitName : product.packUnit;
      if (pickedBatch && pickedBatch.qtyRemaining < internalQty) {
        return res.status(400).json({ message: `Only ${pickedBatch.qtyRemaining} ${unitName} left in batch ${pickedBatch.batchNo} of ${product.name}.` });
      }
      // An exact rack position may be picked too (only with a batch).
      const pickedRack = pickedBatch && item.rack !== undefined && item.rack !== null ? cleanRack(item.rack) : null;
      if (pickedRack !== null) {
        const here = effectiveLocations(pickedBatch).find((l) => l.rack === pickedRack)?.qty || 0;
        if (here < internalQty) {
          return res.status(400).json({ message: `Only ${here} ${unitName} of ${product.name} batch ${pickedBatch.batchNo} on ${pickedRack || "No Rack"}.` });
        }
      }

      resolved.push({
        noStock,
        product,
        internalQty,
        batchId: pickedBatch?._id || null,
        rack: pickedRack,
        line: {
          product: product._id,
          name: product.name,
          hsnCode: product.hsnCode || "",
          unitType: item.unitType,
          unitLabel,
          qty,
          rate,
          gstPercent: lineGstPercent,
          amount,
          gstAmount,
        },
      });
    }

    // Guarded, atomic decrement per line against the product's total (race-safe
    // against concurrent sales), then FEFO-allocate that same quantity across
    // the product's batches so cost/expiry are always attributed to the actual
    // lot(s) it came from. If anything fails partway, everything already
    // reserved for earlier lines - both the product total and batch qtys - is put back.
    const settled = [];
    for (const { product, internalQty, line, batchId, rack, noStock } of resolved) {
      if (noStock) {
        line.internalQtyDeducted = 0;
        line.costAmount = 0;
        line.batchBreakdown = [];
        continue;
      }
      const updated = await Product.findOneAndUpdate(
        { _id: product._id, qty: { $gte: internalQty } },
        { $inc: { qty: -internalQty } },
        { new: true }
      );
      if (!updated) {
        for (const s of settled) {
          await Product.updateOne({ _id: s.product._id }, { $inc: { qty: s.internalQty } });
          await reverseBreakdown(s.breakdown);
        }
        const fresh = await Product.findById(product._id);
        return res.status(400).json({ message: `Only ${fresh.qty} ${product.soldAs === "pack-and-loose" ? product.looseUnitName : product.packUnit} of ${product.name} available in stock.` });
      }

      const breakdown = batchId ? await allocateFromBatch(product, batchId, internalQty, rack) : await allocateFefo(product, internalQty);
      if (!breakdown) {
        if (batchId) {
          // The picked lot sold out meanwhile - undo and say so.
          await Product.updateOne({ _id: product._id }, { $inc: { qty: internalQty } });
          for (const s of settled) {
            await Product.updateOne({ _id: s.product._id }, { $inc: { qty: s.internalQty } });
            await reverseBreakdown(s.breakdown);
          }
          return res.status(400).json({ message: `The selected batch${rack !== null ? "/rack" : ""} of ${product.name} doesn't have enough stock left.` });
        }
        // Product-level total said there was enough, but the batch records
        // disagree (data drift) - undo this line and everything before it.
        await Product.updateOne({ _id: product._id }, { $inc: { qty: internalQty } });
        for (const s of settled) {
          await Product.updateOne({ _id: s.product._id }, { $inc: { qty: s.internalQty } });
          await reverseBreakdown(s.breakdown);
        }
        return res.status(500).json({ message: "Something went wrong. Please try again." });
      }

      line.internalQtyDeducted = internalQty;
      line.costAmount = Number(breakdown.reduce((sum, b) => sum + b.qty * b.costPricePerUnit, 0).toFixed(2));
      line.batchBreakdown = breakdown;

      settled.push({ product, internalQty, breakdown, line });
    }

    const isDiscountAllowed = isAdmin || Boolean(req.fromSalesEntry);
    const appliedDiscount = isDiscountAllowed ? Number(discount) || 0 : 0;

    const subtotal = Number(resolved.reduce((s, r) => s + r.line.amount, 0).toFixed(2));
    const gstAmount = Number(resolved.reduce((s, r) => s + r.line.gstAmount, 0).toFixed(2));
    const total = Number((subtotal + gstAmount - appliedDiscount).toFixed(2));

    const resolvedPaymentMode = paymentMode || "Cash";
    const amountPaid =
      resolvedPaymentMode === "Credit" ? Math.min(Math.max(Number(amountReceived) || 0, 0), total) : total;

    const billNo = await generateBillNo();
    const sale = await Sale.create({
      billNo,
      customer: customerId,
      items: resolved.map((r) => r.line),
      subtotal,
      gstAmount,
      discount: appliedDiscount,
      total,
      paymentMode: resolvedPaymentMode,
      amountPaid,
      createdBy: req.user._id,
      ...(req.fromSalesEntry?.saleFields || {}),
    });

    if (resolvedPaymentMode === "Credit" && amountPaid > 0) {
      const paymentNo = await generatePaymentNo("customer");
      await CustomerPayment.create({
        paymentNo,
        customer: customerId,
        sale: sale._id,
        amount: amountPaid,
        note: "Received at billing",
        recordedBy: req.user._id,
      });
    }

    for (const { line } of resolved) {
      for (const b of line.batchBreakdown) {
        await StockLedger.create({
          product: line.product,
          batch: b.batch,
          type: "sale",
          qtyChange: -b.qty,
          rack: b.rack,
          reason: `Sale ${billNo}`,
          refId: sale._id,
          performedBy: req.user._id,
        });
      }
    }

    const populated = await sale.populate("customer", "name phone");
    res.status(201).json(populated);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Something went wrong. Please try again." });
  }
}
router.post("/", createSaleHandler);


const SALE_PAYMENT_MODES = ["Cash", "Card", "UPI", "Bank Transfer", "Other", "Credit"];
const BILLING_RECEIPT_NOTE = "Received at billing";
const round2 = (n) => Number(Number(n).toFixed(2));

// Corrects a completed bill (wrong item, quantity, rate, customer, discount
// or payment mode). The bill keeps its number and date. Stock is put back
// exactly where the original lines took it from, then the corrected lines
// are taken - preferring those same lots/racks, then earliest expiry first.
// If any corrected line can't be filled, everything is undone and the bill
// stays as it was. Money already collected later through the customer
// ledger is protected: such a bill stays on Credit for the same customer and
// its total can't drop below what was collected.
export async function updateSaleHandler(req, res) {
  const { customer, items, paymentMode, discount, amountReceived, overrideExpired } = req.body;

  const sale = await Sale.findById(req.params.id);
  if (!sale) return res.status(404).json({ message: "No records found." });
  if (sale.salesEntry && !req.fromSalesEntry) return res.status(400).json({ message: linkedEntryMessage(sale) });
  if (sale.paymentStatus === "void") return res.status(400).json({ message: "A voided bill can't be edited." });
  // (Lines sold without stock - internalQtyDeducted 0 - have no batches by design.)
  if (sale.items.some((i) => (!i.batchBreakdown || i.batchBreakdown.length === 0) && i.internalQtyDeducted > 0)) {
    return res.status(400).json({ message: "This bill was made before batch tracking and can't be edited. Void it and bill again instead." });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "A bill needs at least one product. To cancel the whole bill, void it instead." });
  }

  let customerId = null;
  if (customer) {
    const customerDoc = mongoose.isValidObjectId(customer) ? await Customer.findById(customer) : null;
    if (!customerDoc) return res.status(400).json({ message: "No records found." });
    customerId = customerDoc._id;
  }
  const mode = paymentMode || "Cash";
  if (!SALE_PAYMENT_MODES.includes(mode)) return res.status(400).json({ message: "Please choose a valid payment mode." });
  if (mode === "Credit" && !customerId) return res.status(400).json({ message: "A customer must be selected for a credit sale." });

  // What was received at billing can be corrected freely; anything collected
  // afterwards (customer ledger payments) can't be undone from here.
  const billingReceipts = await CustomerPayment.find({ sale: sale._id, note: BILLING_RECEIPT_NOTE });
  const receiptTotal = round2(billingReceipts.reduce((s, p) => s + p.amount, 0));
  const collectedLater = sale.paymentMode === "Credit" ? round2((sale.amountPaid ?? 0) - receiptTotal) : 0;
  if (collectedLater > 0) {
    if (mode !== "Credit") {
      return res.status(400).json({ message: `₹${collectedLater.toFixed(2)} has already been collected against this credit bill, so it has to stay on Credit.` });
    }
    if (String(customerId) !== String(sale.customer)) {
      return res.status(400).json({ message: "Payments are already recorded against this bill for its customer, so the customer can't be changed." });
    }
  }

  // Validate every corrected line before touching any stock.
  const resolved = [];
  for (const item of items) {
    const product = mongoose.isValidObjectId(item.product) ? await Product.findById(item.product) : null;
    const original = sale.items.find((i) => String(i.product) === String(item.product) && i.unitType === item.unitType);
    if (!product || (!product.isActive && !original)) return res.status(400).json({ message: "This product is no longer available." });
    if (item.unitType !== "pack" && item.unitType !== "loose") return res.status(400).json({ message: "Please choose pack or loose for each line." });
    if (item.unitType === "loose" && product.soldAs !== "pack-and-loose") {
      return res.status(400).json({ message: `${product.name} cannot be sold loose.` });
    }
    const qty = Number(item.qty);
    if (!(qty > 0)) return res.status(400).json({ message: `Enter the quantity for ${product.name}.` });
    // The rate can be corrected too; otherwise the bill's own rate is kept
    // (a new line uses the product's current price).
    const hasRate = item.rate !== undefined && item.rate !== null && item.rate !== "";
    const currentRate = item.unitType === "pack" ? product.packRate : product.looseRate;
    const rate = hasRate ? Number(item.rate) : original ? original.rate : currentRate;
    if (!(rate >= 0)) return res.status(400).json({ message: `Please enter a valid rate for ${product.name}.` });
    const gstPercent = req.fromSalesEntry && item.gstPercent != null ? Number(item.gstPercent) : original ? original.gstPercent : product.gstPercent;
    const amount = round2(qty * rate);
    resolved.push({
      noStock: Boolean(req.fromSalesEntry && item.noStock),
      product,
      internalQty: saleLineInternalQty(product, item.unitType, qty),
      line: {
        product: product._id,
        name: product.name,
        hsnCode: product.hsnCode || "",
        unitType: item.unitType,
        unitLabel: item.unitType === "pack" ? product.packUnit : product.looseUnitName,
        qty,
        rate,
        gstPercent,
        amount,
        gstAmount: req.fromSalesEntry && item.gstAmount != null ? round2(Number(item.gstAmount)) : round2((amount * gstPercent) / 100),
      },
    });
  }

  const subtotal = round2(resolved.reduce((s, r) => s + r.line.amount, 0));
  const gstAmount = round2(resolved.reduce((s, r) => s + r.line.gstAmount, 0));
  const appliedDiscount = round2(Number(discount) || 0);
  if (appliedDiscount < 0 || appliedDiscount > subtotal + gstAmount) {
    return res.status(400).json({ message: "The discount can't be more than the bill amount." });
  }
  const total = round2(subtotal + gstAmount - appliedDiscount);
  const receivedNow = mode === "Credit" ? round2(Math.max(Number(amountReceived) || 0, 0)) : 0;
  const amountPaid = mode === "Credit" ? round2(collectedLater + receivedNow) : total;
  if (amountPaid > total) {
    return res.status(400).json({
      message: collectedLater > 0
        ? `₹${amountPaid.toFixed(2)} has already been received for this bill, so the new total can't be less than that.`
        : "Amount received can't be more than the bill total.",
    });
  }

  try {
    const now = new Date();
    const originals = sale.items.map((i) => ({
      productId: i.product,
      internalQty: i.internalQtyDeducted,
      breakdown: i.batchBreakdown.map((b) => ({ batch: b.batch, qty: b.qty, rack: b.rack })),
    }));
    // Lots/racks the original lines came from, per product - the corrected
    // lines take from these first so unchanged lines keep their batches.
    const pool = new Map();
    for (const o of originals) {
      const list = pool.get(String(o.productId)) || [];
      list.push(...o.breakdown.map((b) => ({ ...b })));
      pool.set(String(o.productId), list);
    }

    const restoreOriginal = async () => {
      for (const o of originals) {
        await Product.updateOne({ _id: o.productId }, { $inc: { qty: o.internalQty } });
        await reverseBreakdown(o.breakdown);
      }
    };
    // Only used to roll back a failed edit: takes the original stock again.
    const retakeOriginal = async () => {
      for (const o of originals) {
        const product = await Product.findById(o.productId);
        await Product.updateOne({ _id: o.productId }, { $inc: { qty: -o.internalQty } });
        for (const b of o.breakdown) {
          const got = await allocateFromBatch(product, b.batch, b.qty, b.rack);
          if (!got) console.error(`Sale edit rollback: could not re-take ${b.qty} from batch ${b.batch} for sale ${sale.billNo}`);
        }
      }
    };
    const releaseLine = async (productId, internalQty, breakdown) => {
      await Product.updateOne({ _id: productId }, { $inc: { qty: internalQty } });
      await reverseBreakdown(breakdown);
    };

    const takeLine = async (product, internalQty) => {
      const unitName = product.soldAs === "pack-and-loose" ? product.looseUnitName : product.packUnit;
      const updated = await Product.findOneAndUpdate({ _id: product._id, qty: { $gte: internalQty } }, { $inc: { qty: -internalQty } }, { new: true });
      if (!updated) {
        const fresh = await Product.findById(product._id);
        return { message: `Only ${fresh.qty} ${unitName} of ${product.name} available in stock.` };
      }
      const breakdown = [];
      let remaining = internalQty;
      for (const entry of pool.get(String(product._id)) || []) {
        if (remaining <= 0) break;
        const take = Math.min(entry.qty, remaining);
        if (take <= 0) continue;
        const got = await allocateFromBatch(product, entry.batch, take, entry.rack);
        if (!got) continue;
        breakdown.push(...got);
        entry.qty -= take;
        remaining -= take;
      }
      if (remaining > 0) {
        const next = await earliestActiveBatch(product._id);
        if (next?.expiryDate && new Date(next.expiryDate) < now && !overrideExpired) {
          await releaseLine(product._id, internalQty - remaining, breakdown);
          await Product.updateOne({ _id: product._id }, { $inc: { qty: remaining } });
          return { message: `The next batch of ${product.name} has expired. Tick "Allow expired stock" to sell it anyway.`, expired: true };
        }
        const more = await allocateFefo(product, remaining);
        if (!more) {
          await releaseLine(product._id, internalQty - remaining, breakdown);
          await Product.updateOne({ _id: product._id }, { $inc: { qty: remaining } });
          return { message: `Not enough stock of ${product.name} for this quantity.` };
        }
        breakdown.push(...more);
      }
      return { breakdown };
    };

    await restoreOriginal();
    const settled = [];
    for (const r of resolved) {
      if (r.noStock) {
        r.line.internalQtyDeducted = 0;
        r.line.costAmount = 0;
        r.line.batchBreakdown = [];
        continue;
      }
      const out = await takeLine(r.product, r.internalQty);
      if (!out.breakdown) {
        for (const s of settled) await releaseLine(s.product._id, s.internalQty, s.line.batchBreakdown);
        await retakeOriginal();
        return res.status(400).json({ message: out.message, expired: Boolean(out.expired) });
      }
      r.line.internalQtyDeducted = r.internalQty;
      r.line.costAmount = round2(out.breakdown.reduce((s, b) => s + b.qty * b.costPricePerUnit, 0));
      r.line.batchBreakdown = out.breakdown;
      settled.push(r);
    }

    for (const o of originals) {
      for (const b of o.breakdown) {
        await StockLedger.create({
          product: o.productId,
          batch: b.batch,
          type: "sale-edit",
          qtyChange: b.qty,
          rack: b.rack,
          reason: `Edit of ${sale.billNo}: original line returned`,
          refId: sale._id,
          performedBy: req.user._id,
        });
      }
    }
    for (const { line } of resolved) {
      for (const b of line.batchBreakdown) {
        await StockLedger.create({
          product: line.product,
          batch: b.batch,
          type: "sale",
          qtyChange: -b.qty,
          rack: b.rack,
          reason: `Sale ${sale.billNo} (edited)`,
          refId: sale._id,
          performedBy: req.user._id,
        });
      }
    }

    const receiptMode = billingReceipts[0]?.mode || "Cash";
    const receiptDate = billingReceipts[0]?.date || sale.createdAt;
    await CustomerPayment.deleteMany({ _id: { $in: billingReceipts.map((p) => p._id) } });
    if (mode === "Credit" && receivedNow > 0) {
      await CustomerPayment.create({
        paymentNo: billingReceipts[0]?.paymentNo || (await generatePaymentNo("customer")),
        customer: customerId,
        sale: sale._id,
        amount: receivedNow,
        mode: receiptMode,
        date: receiptDate,
        note: BILLING_RECEIPT_NOTE,
        recordedBy: req.user._id,
      });
    }

    Object.assign(sale, {
      customer: customerId,
      items: resolved.map((r) => r.line),
      subtotal,
      gstAmount,
      discount: appliedDiscount,
      total,
      paymentMode: mode,
      amountPaid,
      editedAt: now,
      editedBy: req.user._id,
    });
    await sale.save();
    // A Sales Entry's bill has no saved files (it's data only).
    if (!req.fromSalesEntry) await markInvoiceChanged("sales", sale._id, "edited");

    const populated = await Sale.findById(sale._id).populate("customer", "name phone").populate("createdBy", "username");
    res.json({ ...populated.toObject(), billText: buildBillText(populated) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Something went wrong. Please try again." });
  }
}
router.put("/:id", requireRole("admin"), updateSaleHandler);


// Puts every unit a bill took back where it came from, logging each return
// with `label` (e.g. "Void of GM-000012: wrong customer").
async function returnSaleStock(sale, label, userId) {
  for (const item of sale.items) {
    if (!(item.internalQtyDeducted > 0)) continue; // sold without stock - nothing to return
    await Product.updateOne({ _id: item.product }, { $inc: { qty: item.internalQtyDeducted } });

    if (item.batchBreakdown && item.batchBreakdown.length > 0) {
      await reverseBreakdown(item.batchBreakdown);
      for (const b of item.batchBreakdown) {
        await StockLedger.create({
          product: item.product,
          batch: b.batch,
          type: "void-reversal",
          qtyChange: b.qty,
          rack: b.rack,
          reason: label,
          refId: sale._id,
          performedBy: userId,
        });
      }
    } else {
      // Sold before batch tracking existed - no per-batch breakdown to restore.
      const product = await Product.findById(item.product);
      const batch = await landLegacyReturn(product, item.internalQtyDeducted, item);
      await StockLedger.create({
        product: item.product,
        batch: batch._id,
        type: "void-reversal",
        qtyChange: item.internalQtyDeducted,
        reason: `${label} (pre-batch-tracking sale, returned to batch ${batch.batchNo})`,
        refId: sale._id,
        performedBy: userId,
      });
    }
  }
}

router.post("/:id/void", requireRole("admin"), async (req, res) => {
  // The reason is optional; it is recorded when given.
  const reason = String(req.body.reason || "").trim() || "No reason given";

  const sale = await Sale.findById(req.params.id).populate("customer", "name phone").populate("createdBy", "username");
  if (!sale) return res.status(404).json({ message: "No records found." });
  if (sale.salesEntry) return res.status(400).json({ message: linkedEntryMessage(sale) });
  if (sale.paymentStatus === "void") {
    return res.status(400).json({ message: "This bill has already been voided." });
  }

  await returnSaleStock(sale, `Void of ${sale.billNo}: ${reason}`, req.user._id);

  sale.paymentStatus = "void";
  sale.voidReason = reason;
  sale.voidedBy = req.user._id;
  sale.voidedAt = new Date();
  // A voided bill is dropped from the receivables ledger entirely (see
  // ledgerHelpers.js's paymentStatus filter) - clear its balance too so it
  // never shows outstanding money owed on a sale that no longer stands.
  sale.amountPaid = sale.total;
  await sale.save();
  await markInvoiceChanged("sales", sale._id, "void");

  res.json({ ...sale.toObject(), billText: buildBillText(sale) });
});

// Removes a bill completely (Admin). A bill that still stands has its stock
// put back first; what was received at billing goes with it. Money collected
// later through the customer ledger has to be deleted there first, so the
// customer's account never shows a payment for a bill that doesn't exist.
export async function deleteSaleHandler(req, res) {
  const sale = await Sale.findById(req.params.id);
  if (!sale) return res.status(404).json({ message: "No records found." });
  if (sale.salesEntry && !req.fromSalesEntry) return res.status(400).json({ message: linkedEntryMessage(sale) });

  const linked = await CustomerPayment.find({ sale: sale._id });
  const atBilling = linked.filter((p) => p.note === BILLING_RECEIPT_NOTE);
  const receiptTotal = round2(atBilling.reduce((s, p) => s + p.amount, 0));
  const collectedLater =
    sale.paymentStatus !== "void" && sale.paymentMode === "Credit" ? round2((sale.amountPaid ?? 0) - receiptTotal) : 0;
  if (collectedLater > 0 || linked.length > atBilling.length) {
    return res.status(400).json({
      message: "Payments were collected against this bill from the customer ledger. Delete those payments first, then delete the bill.",
    });
  }

  try {
    if (sale.paymentStatus !== "void") await returnSaleStock(sale, `Deleted bill ${sale.billNo}`, req.user._id);
    await CustomerPayment.deleteMany({ _id: { $in: atBilling.map((p) => p._id) } });
    await Sale.deleteOne({ _id: sale._id });
    res.json({ message: `Bill ${sale.billNo} deleted.` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Something went wrong. Please try again." });
  }
}
router.delete("/:id", requireRole("admin"), deleteSaleHandler);


export default router;
