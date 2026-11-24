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
import { shopDay, streamExcelReport, streamPdfReport } from "../utils/reportExport.js";
import { dayRange } from "../utils/queryFilters.js";
import { transactional, runInTransaction, rethrowIfRetryable, isDuplicateOf, cleanClientRef } from "../utils/transaction.js";
import { findOrCreateCustomer } from "../utils/parties.js";

const router = Router();
router.use(requireAuth);

const SALE_PAYMENT_MODES = ["Cash", "Card", "UPI", "Other", "Credit"];
const MAX_BULK = 200;
const BILLING_RECEIPT_NOTE = "Received at billing";
const round2 = (n) => Number(Number(n).toFixed(2));
// How money received with a credit bill was paid.
const RECEIPT_MODES = ["Cash", "Card", "UPI", "Bank Transfer", "Other"];
const receiptMode = (m) => (RECEIPT_MODES.includes(m) ? m : "Cash");

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
    date: shopDay(s.createdAt),
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

// Ids of every bill matching the list's filters, for "select all" (Admin).
router.get("/ids", requireRole("admin"), async (req, res) => {
  const rows = await Sale.find(await buildSaleFilter(req), "_id").sort({ createdAt: -1 }).lean();
  res.json(rows.map((r) => r._id));
});

// Registered before GET "/:id", like "/export" above.
router.get("/:id", async (req, res) => {
  const sale = await Sale.findById(req.params.id).populate("customer", "name phone").populate("createdBy", "username");
  if (!sale) return res.status(404).json({ message: "No records found." });
  if (!canAccessSale(sale, req.user)) return res.status(403).json({ message: "You do not have permission to perform this action." });
  // Split of amountPaid for the edit form: received at billing (editable) vs
  // collected later through the customer ledger (protected).
  const { receiptTotal: receivedAtBilling, collectedLater } = await saleReceipts(sale);
  res.json({ ...sale.toObject(), billText: buildBillText(sale), receivedAtBilling, collectedLater });
});

router.get("/:id/pdf", async (req, res) => {
  const sale = await Sale.findById(req.params.id).populate("customer", "name phone").populate("createdBy", "username");
  if (!sale) return res.status(404).json({ message: "No records found." });
  if (!canAccessSale(sale, req.user)) return res.status(403).json({ message: "You do not have permission to perform this action." });
  streamBillPdf(sale, res);
});

// Saving a bill IS the sales entry. In one transaction it takes the stock
// (batch by batch), records the sale, the money received and the stock
// movements; customer balances, the Day Book, the dashboard and every report
// are worked out from these same records, so nothing is ever entered twice.
router.post(
  "/",
  transactional(async (req, res) => {
    const { customer, items, paymentMode, discount, overrideExpiredReason, amountReceived } = req.body;

    // The same form sent again: answer with the bill it already made.
    const clientRef = cleanClientRef(req.body.clientRef);
    if (clientRef) {
      const saved = await Sale.findOne({ clientRef, createdBy: req.user._id }).populate("customer", "name phone");
      if (saved) return res.status(200).json({ ...saved.toObject(), alreadySaved: true });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Add at least one product to the bill." });
    }
    let customerId = null;
    if (customer) {
      const customerDoc = mongoose.isValidObjectId(customer) ? await Customer.findById(customer) : null;
      if (!customerDoc) return res.status(400).json({ message: "The selected customer was not found. Please choose the customer again." });
      customerId = customerDoc._id;
    } else if (req.body.newCustomer) {
      // A name (and phone) typed on the bill: linked to that customer if there
      // is one, else added to the Customer List along with the bill.
      const typed = await findOrCreateCustomer(req.body.newCustomer);
      if (typed.error) return res.status(400).json({ message: typed.error });
      customerId = typed.customer._id;
    }
    if (paymentMode === "Credit" && !customerId) {
      return res.status(400).json({ message: "A customer must be selected for a credit sale." });
    }
    if (paymentMode && !SALE_PAYMENT_MODES.includes(paymentMode)) {
      return res.status(400).json({ message: "Please choose a valid payment mode." });
    }
    if (items.some((i) => i?.unitType !== "pack" && i?.unitType !== "loose")) {
      return res.status(400).json({ message: "Please choose pack or loose for each line." });
    }

    const isAdmin = req.user.role === "admin";
    const now = new Date();

    // Admins can date a bill (an earlier day's bill, or the Excel upload,
    // which also keeps the file's invoice number as importRef).
    const importRef = isAdmin && req.body.importRef ? String(req.body.importRef).trim().slice(0, 60) : "";
    let billDate = null;
    if (isAdmin && req.body.date) {
      const m = String(req.body.date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0) : null;
      if (!d || Number.isNaN(d.getTime()) || d.getMonth() !== Number(m[2]) - 1) return res.status(400).json({ message: "Please enter a valid bill date." });
      if (d.getTime() > now.getTime() + 86400000) return res.status(400).json({ message: "The bill date can't be in the future." });
      // Today's date = now; an earlier day = midday of that day (shop time).
      const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
      billDate = sameDay ? null : d;
    }
    if (importRef && (await Sale.exists({ importRef: new RegExp(`^${importRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }))) {
      return res.status(409).json({ message: `Invoice ${importRef} has already been imported.` });
    }

    try {
      const resolved = [];
      const ids = items.map((i) => i.product).filter((id) => mongoose.isValidObjectId(id));
      const products = new Map((await Product.find({ _id: { $in: ids } })).map((p) => [String(p._id), p]));
      for (const item of items) {
        const product = products.get(String(item.product));
        if (!product || !product.isActive) {
          return res.status(400).json({ message: "This product is no longer available." });
        }
        if (item.unitType === "loose" && product.soldAs !== "pack-and-loose") {
          return res.status(400).json({ message: `${product.name} cannot be sold loose.` });
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
        const nextBatch = pickedBatch || (await earliestActiveBatch(product._id));
        const isExpired = Boolean(nextBatch?.expiryDate) && new Date(nextBatch.expiryDate) < now;
        // An admin can knowingly sell expired stock; the reason note is optional.
        const overriding = isAdmin && (req.body.overrideExpired === true || Boolean(overrideExpiredReason));
        if (isExpired && !overriding) {
          return res.status(400).json({ message: `Batch ${nextBatch.batchNo} of ${product.name} has expired and cannot be sold.`, expired: true });
        }

        const qty = Number(item.qty);
        if (!(qty > 0) || (item.unitType === "pack" && !Number.isInteger(qty))) return res.status(400).json({ message: `Enter the quantity for ${product.name}.` });

        const internalQty = saleLineInternalQty(product, item.unitType, qty);
        // An admin can type the selling rate on the bill; everyone else sells
        // at the product's own price.
        const hasRate = isAdmin && item.rate !== undefined && item.rate !== null && item.rate !== "";
        const rate = hasRate ? round2(Number(item.rate)) : item.unitType === "pack" ? product.packRate : product.looseRate;
        if (!(rate >= 0)) return res.status(400).json({ message: `Please enter a valid rate for ${product.name}.` });
        const amount = round2(qty * rate);

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
          product,
          internalQty,
          unitName,
          batchId: pickedBatch?._id || null,
          rack: pickedRack,
          line: {
            product: product._id,
            name: product.name,
            hsnCode: product.hsnCode || "",
            unitType: item.unitType,
            unitLabel: item.unitType === "pack" ? product.packUnit : product.looseUnitName,
            qty,
            rate,
            gstPercent: product.gstPercent,
            amount,
            gstAmount: round2((amount * product.gstPercent) / 100),
          },
        });
      }

      const appliedDiscount = isAdmin ? round2(Number(discount) || 0) : 0;
      const subtotal = round2(resolved.reduce((s, r) => s + r.line.amount, 0));
      const gstAmount = round2(resolved.reduce((s, r) => s + r.line.gstAmount, 0));
      if (appliedDiscount < 0 || appliedDiscount > subtotal + gstAmount) {
        return res.status(400).json({ message: "The discount can't be more than the bill amount." });
      }

      // Take the stock: the product's total, and the exact lot(s) it came from
      // so cost and expiry are always attributed correctly. Any refusal below
      // undoes everything (see transactional).
      for (const { product, internalQty, unitName, line, batchId, rack } of resolved) {
        const updated = await Product.findOneAndUpdate({ _id: product._id, qty: { $gte: internalQty } }, { $inc: { qty: -internalQty } }, { new: true });
        if (!updated) {
          const fresh = await Product.findById(product._id);
          return res.status(400).json({ message: `Only ${fresh.qty} ${unitName} of ${product.name} available in stock.` });
        }
        const breakdown = batchId ? await allocateFromBatch(product, batchId, internalQty, rack) : await allocateFefo(product, internalQty);
        if (!breakdown) {
          return res.status(400).json({
            message: batchId
              ? `The selected batch${rack !== null ? "/rack" : ""} of ${product.name} doesn't have enough stock left.`
              : `The batches of ${product.name} hold less than its total stock. Check this product in Stock before selling it.`,
          });
        }
        line.internalQtyDeducted = internalQty;
        line.costAmount = round2(breakdown.reduce((sum, b) => sum + b.qty * b.costPricePerUnit, 0));
        line.batchBreakdown = breakdown;
      }

      const total = round2(subtotal + gstAmount - appliedDiscount);
      const mode = paymentMode || "Cash";
      const amountPaid = mode === "Credit" ? round2(Math.min(Math.max(Number(amountReceived) || 0, 0), total)) : total;

      const billNo = await generateBillNo();
      const sale = new Sale({
        ...(importRef ? { importRef } : {}),
        ...(clientRef ? { clientRef } : {}),
        ...(billDate ? { createdAt: billDate } : {}),
        billNo,
        customer: customerId,
        items: resolved.map((r) => r.line),
        subtotal,
        gstAmount,
        discount: appliedDiscount,
        total,
        paymentMode: mode,
        amountPaid,
        createdBy: req.user._id,
      });
      await sale.save();

      if (mode === "Credit" && amountPaid > 0) {
        await CustomerPayment.create({
          paymentNo: await generatePaymentNo("customer"),
          customer: customerId,
          sale: sale._id,
          amount: amountPaid,
          mode: receiptMode(req.body.receivedMode),
          ...(billDate ? { date: billDate } : {}),
          note: BILLING_RECEIPT_NOTE,
          recordedBy: req.user._id,
        });
      }
      await StockLedger.insertMany(saleLedger(resolved, sale, `Sale ${billNo}`, req.user._id));

      await sale.populate("customer", "name phone");
      res.status(201).json(sale.toObject());
    } catch (e) {
      rethrowIfRetryable(e);
      if (isDuplicateOf(e, "importRef")) return res.status(409).json({ message: `Invoice ${importRef} has already been imported.` });
      if (isDuplicateOf(e, "clientRef")) return res.status(409).json({ message: "This bill has already been saved. Check Bills." });
      console.error(e);
      res.status(500).json({ message: "Something went wrong. Nothing was saved - please try again." });
    }
  })
);

// Corrects a completed bill (wrong item, quantity, rate, customer, discount
// or payment mode). The bill keeps its number and date. Stock is put back
// exactly where the original lines took it from, then the corrected lines
// are taken - preferring those same lots/racks, then earliest expiry first.
// If any corrected line can't be filled, everything is undone and the bill
// stays as it was. Money already collected later through the customer
// ledger is protected: such a bill stays on Credit for the same customer and
// its total can't drop below what was collected.
router.put(
  "/:id",
  requireRole("admin"),
  transactional(async (req, res) => {
    const { customer, items, paymentMode, discount, amountReceived, overrideExpired } = req.body;

    const sale = await Sale.findById(req.params.id);
    if (!sale) return res.status(404).json({ message: "No records found." });
    if (sale.paymentStatus === "void") return res.status(400).json({ message: "A voided bill can't be edited." });
    if (sale.items.some((i) => !i.batchBreakdown || i.batchBreakdown.length === 0)) {
      return res.status(400).json({ message: "This bill was made before batch tracking and can't be edited. Void it and bill again instead." });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "A bill needs at least one product. To cancel the whole bill, void it instead." });
    }

    let customerId = null;
    if (customer) {
      const customerDoc = mongoose.isValidObjectId(customer) ? await Customer.findById(customer) : null;
      if (!customerDoc) return res.status(400).json({ message: "The selected customer was not found. Please choose the customer again." });
      customerId = customerDoc._id;
    } else if (req.body.newCustomer) {
      const typed = await findOrCreateCustomer(req.body.newCustomer);
      if (typed.error) return res.status(400).json({ message: typed.error });
      customerId = typed.customer._id;
    }
    const mode = paymentMode || "Cash";
    if (!SALE_PAYMENT_MODES.includes(mode)) return res.status(400).json({ message: "Please choose a valid payment mode." });
    if (mode === "Credit" && !customerId) return res.status(400).json({ message: "A customer must be selected for a credit sale." });

    // What was received at billing can be corrected freely; anything collected
    // afterwards (customer ledger payments) can't be undone from here.
    const { billingReceipts, collectedLater } = await saleReceipts(sale);
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
      if (!(qty > 0) || (item.unitType === "pack" && !Number.isInteger(qty))) return res.status(400).json({ message: `Enter the quantity for ${product.name}.` });
      // The rate can be corrected too; otherwise the bill's own rate is kept
      // (a new line uses the product's current price).
      const hasRate = item.rate !== undefined && item.rate !== null && item.rate !== "";
      const currentRate = item.unitType === "pack" ? product.packRate : product.looseRate;
      const rate = hasRate ? round2(Number(item.rate)) : original ? original.rate : currentRate;
      if (!(rate >= 0)) return res.status(400).json({ message: `Please enter a valid rate for ${product.name}.` });
      const gstPercent = original ? original.gstPercent : product.gstPercent;
      const amount = round2(qty * rate);
      resolved.push({
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
          gstAmount: round2((amount * gstPercent) / 100),
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
      // Lots/racks the original lines came from, per product - the corrected
      // lines take from these first so unchanged lines keep their batches.
      const pool = new Map();
      const returned = [];
      for (const i of sale.items) {
        const breakdown = i.batchBreakdown.map((b) => ({ batch: b.batch, qty: b.qty, rack: b.rack }));
        await Product.updateOne({ _id: i.product }, { $inc: { qty: i.internalQtyDeducted } });
        await reverseBreakdown(breakdown);
        const key = String(i.product);
        pool.set(key, [...(pool.get(key) || []), ...breakdown.map((b) => ({ ...b }))]);
        for (const b of breakdown) {
          returned.push({
            product: i.product,
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

      // Any refusal here undoes everything, including the returns above.
      for (const { product, internalQty, line } of resolved) {
        const unitName = product.soldAs === "pack-and-loose" ? product.looseUnitName : product.packUnit;
        const updated = await Product.findOneAndUpdate({ _id: product._id, qty: { $gte: internalQty } }, { $inc: { qty: -internalQty } }, { new: true });
        if (!updated) {
          const fresh = await Product.findById(product._id);
          return res.status(400).json({ message: `Only ${fresh.qty} ${unitName} of ${product.name} available in stock.` });
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
            return res.status(400).json({ message: `The next batch of ${product.name} has expired. Tick "Allow expired stock" to sell it anyway.`, expired: true });
          }
          const more = await allocateFefo(product, remaining);
          if (!more) return res.status(400).json({ message: `Not enough stock of ${product.name} for this quantity.`, expired: false });
          breakdown.push(...more);
        }
        line.internalQtyDeducted = internalQty;
        line.costAmount = round2(breakdown.reduce((s, b) => s + b.qty * b.costPricePerUnit, 0));
        line.batchBreakdown = breakdown;
      }

      await StockLedger.insertMany([...returned, ...saleLedger(resolved, sale, `Sale ${sale.billNo} (edited)`, req.user._id)]);

      await CustomerPayment.deleteMany({ _id: { $in: billingReceipts.map((p) => p._id) } });
      if (mode === "Credit" && receivedNow > 0) {
        await CustomerPayment.create({
          paymentNo: billingReceipts[0]?.paymentNo || (await generatePaymentNo("customer")),
          customer: customerId,
          sale: sale._id,
          amount: receivedNow,
          mode: receiptMode(req.body.receivedMode || billingReceipts[0]?.mode),
          date: billingReceipts[0]?.date || sale.createdAt,
          note: BILLING_RECEIPT_NOTE,
          recordedBy: req.user._id,
        });
      }

      sale.set({
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
      await markInvoiceChanged("sales", sale._id, "edited");

      const populated = await Sale.findById(sale._id).populate("customer", "name phone");
      await populated.populate("createdBy", "username");
      res.json({ ...populated.toObject(), billText: buildBillText(populated) });
    } catch (e) {
      rethrowIfRetryable(e);
      console.error(e);
      res.status(500).json({ message: "Something went wrong. Nothing was changed - please try again." });
    }
  })
);

// What was received for a bill: at billing (its own receipts) and later,
// through the customer ledger.
async function saleReceipts(sale) {
  const linked = await CustomerPayment.find({ sale: sale._id });
  const billingReceipts = linked.filter((p) => p.note === BILLING_RECEIPT_NOTE);
  const receiptTotal = round2(billingReceipts.reduce((s, p) => s + p.amount, 0));
  const collectedLater =
    sale.paymentStatus !== "void" && sale.paymentMode === "Credit" ? round2((sale.amountPaid ?? 0) - receiptTotal) : 0;
  return { billingReceipts, receiptTotal, collectedLater, otherPayments: linked.length - billingReceipts.length };
}

// Stock ledger rows for a bill's lines, one per batch/rack taken from.
function saleLedger(resolved, sale, reason, userId) {
  return resolved.flatMap(({ line }) =>
    line.batchBreakdown.map((b) => ({
      product: line.product,
      batch: b.batch,
      type: "sale",
      qtyChange: -b.qty,
      rack: b.rack,
      reason,
      refId: sale._id,
      performedBy: userId,
    }))
  );
}

// Puts every unit a bill took back where it came from, logging each return
// with `label` (e.g. "Void of GM-000012: wrong customer").
async function returnSaleStock(sale, label, userId) {
  for (const item of sale.items) {
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

// Cancels a bill: the bill stays on record marked VOID, its stock goes back,
// and it stops counting in sales, balances, the Day Book and every report.
router.post(
  "/:id/void",
  requireRole("admin"),
  transactional(async (req, res) => {
    // The reason is optional; it is recorded when given.
    const reason = String(req.body.reason || "").trim() || "No reason given";

    const sale = await Sale.findById(req.params.id);
    if (!sale) return res.status(404).json({ message: "No records found." });
    if (sale.paymentStatus === "void") return res.status(400).json({ message: "This bill has already been voided." });

    const { billingReceipts, collectedLater, otherPayments } = await saleReceipts(sale);
    if (collectedLater > 0 || otherPayments > 0) {
      return res.status(400).json({
        message: "Payments were collected against this bill from the customer ledger. Delete those payments first, then void the bill.",
      });
    }

    await returnSaleStock(sale, `Void of ${sale.billNo}: ${reason}`, req.user._id);
    // Money taken at billing is handed back with the bill, so it leaves the
    // customer's account and the Day Book too.
    await CustomerPayment.deleteMany({ _id: { $in: billingReceipts.map((p) => p._id) } });

    sale.set({
      paymentStatus: "void",
      voidReason: reason,
      voidedBy: req.user._id,
      voidedAt: new Date(),
      // Never shows money owed on a bill that no longer stands.
      amountPaid: sale.total,
    });
    await sale.save();
    await markInvoiceChanged("sales", sale._id, "void");

    const populated = await Sale.findById(sale._id).populate("customer", "name phone");
    await populated.populate("createdBy", "username");
    res.json({ ...populated.toObject(), billText: buildBillText(populated) });
  })
);

// Removes a bill completely. A bill that still stands has its stock put back
// first; what was received at billing goes with it. Money collected later
// through the customer ledger has to be deleted there first, so the
// customer's account never shows a payment for a bill that doesn't exist.
// Runs in a transaction; returns { error, status, ref } or { ref }.
async function deleteSale(id, userId) {
  const sale = await Sale.findById(id);
  if (!sale) return { error: "No records found.", status: 404 };
  const { billingReceipts, collectedLater, otherPayments } = await saleReceipts(sale);
  if (collectedLater > 0 || otherPayments > 0) {
    return { ref: sale.billNo, status: 400, error: "Payments were collected against this bill from the customer ledger. Delete those payments first, then delete the bill." };
  }
  if (sale.paymentStatus !== "void") await returnSaleStock(sale, `Deleted bill ${sale.billNo}`, userId);
  await CustomerPayment.deleteMany({ _id: { $in: billingReceipts.map((p) => p._id) } });
  await Sale.deleteOne({ _id: sale._id });
  return { ref: sale.billNo };
}

router.delete(
  "/:id",
  requireRole("admin"),
  transactional(async (req, res) => {
    const out = await deleteSale(req.params.id, req.user._id);
    if (out.error) return res.status(out.status).json({ message: out.error });
    res.json({ message: `Bill ${out.ref} deleted.` });
  })
);

// Deletes many at once (Admin). Each one is its own all-or-nothing delete with
// the same rules as deleting it alone; the ones that can't go are returned
// with the reason, and the rest are deleted.
router.post("/bulk-delete", requireRole("admin"), runBulkDelete);
async function runBulkDelete(req, res) {
  const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(String))].filter((id) => mongoose.isValidObjectId(id)) : [];
  if (!ids.length) return res.status(400).json({ message: "Select at least one record to delete." });
  if (ids.length > MAX_BULK) return res.status(400).json({ message: `Delete at most ${MAX_BULK} at a time.` });
  let deleted = 0;
  const failed = [];
  for (const id of ids) {
    try {
      // Refusals are decided before anything is written.
      const out = await runInTransaction(() => deleteSale(id, req.user._id));
      if (out.error) failed.push({ id, ref: out.ref || "", message: out.error });
      else deleted += 1;
    } catch (e) {
      console.error(e);
      failed.push({ id, ref: "", message: "Something went wrong. Please try again." });
    }
  }
  res.json({ deleted, failed });
}

export default router;
