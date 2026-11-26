import { Router } from "express";
import mongoose from "mongoose";
import PurchaseReturn from "../models/PurchaseReturn.js";
import Purchase from "../models/Purchase.js";
import Product from "../models/Product.js";
import Batch from "../models/Batch.js";
import Vendor from "../models/Vendor.js";
import StockLedger from "../models/StockLedger.js";
import { nextSequence } from "../models/Counter.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { computeInternalQty } from "../utils/stockUnits.js";
import { effectiveLocations } from "../utils/locations.js";
import { refreshProductRack } from "../utils/batchHelpers.js";
import { dayRange } from "../utils/queryFilters.js";
import { shopDay, streamExcelReport, streamPdfReport, periodLabel } from "../utils/reportExport.js";
import { streamPurchaseDocPdf } from "../utils/purchaseDocPdf.js";
import { prDocument } from "../utils/purchaseOrders.js";
import { transactional, cleanClientRef, isDuplicateOf, rethrowIfRetryable } from "../utils/transaction.js";
import { broughtIn, purchasePartyName } from "./purchases.js";

// Purchase Returns: goods sent back to the supplier from one Purchase Invoice.
// Confirming takes the stock off the very batches that invoice brought in;
// cancelling puts it back. A return can never exceed what the invoice brought
// in, less what was already returned and less what has since been sold.
const router = Router();
router.use(requireAuth, requireRole("admin"));

const r2 = (n) => Number(Number(n || 0).toFixed(2));
const escapeRegex = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isDay = (v) => /^\d{4}-\d{2}-\d{2}/.test(String(v || "")) && !Number.isNaN(new Date(v).getTime());
const unitsPerPackOf = (p) => computeInternalQty({ soldAs: p.soldAs, unitsPerPack: p.unitsPerPack, qtyPacks: 1, qtyLooseExtra: 0 }) || 1;
export const RETURN_REASONS = ["Damaged", "Expired / Near Expiry", "Wrong Item", "Excess Quantity", "Quality Issue", "Rate Difference", "Other"];

// What can still go back from each batch of an invoice.
async function eligibility(purchase) {
  const { qtyByBatch, costByBatch, batches } = await broughtIn(purchase);
  const returned = await PurchaseReturn.aggregate([
    { $match: { purchase: purchase._id, status: "Confirmed" } },
    { $unwind: "$items" },
    { $group: { _id: "$items.batch", units: { $sum: "$items.qtyUnits" } } },
  ]);
  const back = new Map(returned.map((r) => [String(r._id), r.units]));
  const products = new Map((await Product.find({ _id: { $in: batches.map((b) => b.product) } })).map((p) => [String(p._id), p]));
  const lines = [];
  for (const b of batches) {
    const units = qtyByBatch.get(String(b._id)) || 0;
    if (units <= 0) continue;
    const product = products.get(String(b.product));
    if (!product) continue;
    const per = unitsPerPackOf(product);
    const c = costByBatch.get(String(b._id));
    const invLine = purchase.items.find((i) => String(i.batch) === String(b._id));
    const returnedUnits = back.get(String(b._id)) || 0;
    const canUnits = Math.max(Math.min(units - returnedUnits, b.qtyRemaining), 0);
    lines.push({
      batch: b._id,
      batchNo: b.batchNo,
      expiryDate: b.expiryDate,
      product: { _id: product._id, name: product.name, productCode: product.productCode, packUnit: product.packUnit, gstPercent: product.gstPercent },
      unitsPerPack: per,
      receivedPacks: Number((units / per).toFixed(2)),
      returnedPacks: Number((returnedUnits / per).toFixed(2)),
      onHandPacks: Number((b.qtyRemaining / per).toFixed(2)),
      eligiblePacks: Math.floor(canUnits / per),
      rate: r2(c && c.packs > 0 ? c.value / c.packs : b.costPrice),
      gstPercent: invLine && invLine.lineAmount ? r2((invLine.lineGst / invLine.lineAmount) * 100) : product.gstPercent || 0,
    });
  }
  return lines;
}

router.get("/reasons", (req, res) => res.json(RETURN_REASONS));

// An invoice's lines with what can still be returned (the Return form).
router.get("/invoice/:purchaseId", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.purchaseId)) return res.status(404).json({ message: "No records found." });
  const purchase = await Purchase.findById(req.params.purchaseId).populate("vendor", "name").populate("purchaseOrder", "poNo");
  if (!purchase) return res.status(404).json({ message: "No records found." });
  const [lines, previous] = await Promise.all([
    eligibility(purchase),
    PurchaseReturn.find({ purchase: purchase._id }, "returnNo date total status").sort({ date: 1 }).lean(),
  ]);
  res.json({
    purchase: { _id: purchase._id, piNo: purchase.piNo, invoiceNo: purchase.invoiceNo, date: purchase.date, total: purchase.total, supplier: purchasePartyName(purchase), vendor: purchase.vendor?._id || null, poNo: purchase.purchaseOrder?.poNo || "" },
    lines,
    previous,
  });
});

async function buildFilter(q) {
  const filter = {};
  if (["Confirmed", "Cancelled"].includes(q.status)) filter.status = q.status;
  if (mongoose.isValidObjectId(q.vendor)) filter.vendor = q.vendor;
  if (mongoose.isValidObjectId(q.purchase)) filter.purchase = q.purchase;
  if (mongoose.isValidObjectId(q.product)) filter["items.product"] = q.product;
  const range = dayRange(isDay(q.from) ? q.from : null, isDay(q.to) ? q.to : null);
  if (range) filter.date = range;
  const text = String(q.q || "").trim().slice(0, 60);
  if (text) {
    const re = new RegExp(escapeRegex(text), "i");
    const vendors = await Vendor.find({ name: re }, "_id").lean();
    filter.$or = [{ returnNo: re }, { invoiceNo: re }, { piNo: re }, { reason: re }, { vendor: { $in: vendors.map((v) => v._id) } }];
  }
  return filter;
}

router.get("/", async (req, res) => {
  const rows = await PurchaseReturn.find(await buildFilter(req.query))
    .populate("vendor", "name")
    .populate("items.product", "name productCode packUnit")
    .populate("createdBy", "username")
    .sort({ date: -1, createdAt: -1 })
    .limit(500)
    .lean();
  res.json(rows);
});

router.get("/export", async (req, res) => {
  const list = await PurchaseReturn.find(await buildFilter(req.query)).populate("vendor", "name").populate("createdBy", "username").sort({ date: -1, createdAt: -1 }).lean();
  const rows = list.map((r) => ({
    returnNo: r.returnNo,
    date: shopDay(r.date),
    vendor: r.vendor?.name || "",
    piNo: r.piNo || "",
    invoiceNo: r.invoiceNo,
    qty: r.items.reduce((s, i) => s + i.qtyPacks, 0),
    subtotal: r.subtotal,
    gst: r.gstAmount,
    total: r.total,
    reason: r.reason,
    status: r.status,
    by: r.createdBy?.username || "",
  }));
  const confirmed = r2(rows.filter((r) => r.status === "Confirmed").reduce((s, r) => s + r.total, 0));
  const subtitle = periodLabel(req.query.from, req.query.to);
  if (req.query.format === "pdf") {
    return streamPdfReport(res, "GuganMedicals_Purchase_Returns.pdf", {
      title: "Gugan Medicals - Purchase Return Report",
      subtitle,
      columns: [
        { header: "Return No", key: "returnNo" },
        { header: "Date", key: "date" },
        { header: "Supplier", key: "vendor", flex: 1.6 },
        { header: "Against PI", key: "piNo" },
        { header: "Qty", key: "qty", align: "right", flex: 0.6 },
        { header: "Total", key: "totalText", align: "right" },
        { header: "Reason", key: "reason", flex: 1.3 },
        { header: "Status", key: "status" },
      ],
      rows: rows.map((r) => ({ ...r, totalText: r.total.toFixed(2) })),
      summaryLines: [`Confirmed returns: Rs. ${confirmed.toFixed(2)}`],
    });
  }
  return streamExcelReport(res, "GuganMedicals_Purchase_Returns.xlsx", [
    {
      name: "Purchase Returns",
      columns: [
        { header: "Return No", key: "returnNo", width: 14 },
        { header: "Date", key: "date", width: 12 },
        { header: "Supplier", key: "vendor", width: 26 },
        { header: "Against PI", key: "piNo", width: 12 },
        { header: "Supplier Inv No", key: "invoiceNo", width: 16 },
        { header: "Qty (packs)", key: "qty", width: 11 },
        { header: "Subtotal", key: "subtotal", width: 12 },
        { header: "GST", key: "gst", width: 10 },
        { header: "Total", key: "total", width: 12 },
        { header: "Reason", key: "reason", width: 20 },
        { header: "Status", key: "status", width: 12 },
        { header: "Entered By", key: "by", width: 14 },
      ],
      rows,
    },
  ]);
});

async function loadFull(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  return PurchaseReturn.findById(id)
    .populate("vendor", "name contactPerson phone email address gstNumber")
    .populate("purchaseOrder", "poNo")
    .populate("items.product", "name productCode packUnit hsnCode")
    .populate("createdBy", "username")
    .populate("cancelledBy", "username");
}

router.get("/:id", async (req, res) => {
  const r = await loadFull(req.params.id);
  if (!r) return res.status(404).json({ message: "No records found." });
  res.json(r);
});

router.get("/:id/pdf", async (req, res) => {
  const r = await loadFull(req.params.id);
  if (!r) return res.status(404).json({ message: "No records found." });
  streamPurchaseDocPdf(res, `${r.returnNo}.pdf`, prDocument(r), { download: req.query.download === "1" });
});

// Takes units off one batch (primary rack first) and the product total.
async function takeOff(batch, units) {
  batch.qtyRemaining -= units;
  batch.locations = effectiveLocations(batch);
  await batch.save();
  await Product.updateOne({ _id: batch.product }, { $inc: { qty: -units } });
}

router.post(
  "/",
  transactional(async (req, res) => {
    const clientRef = cleanClientRef(req.body.clientRef);
    if (clientRef) {
      const saved = await PurchaseReturn.findOne({ clientRef, createdBy: req.user._id });
      if (saved) return res.status(200).json({ ...saved.toObject(), alreadySaved: true });
    }
    const purchase = mongoose.isValidObjectId(req.body.purchase) ? await Purchase.findById(req.body.purchase) : null;
    if (!purchase) return res.status(400).json({ message: "Choose the purchase invoice the goods are returned from." });
    if (req.body.date && !isDay(req.body.date)) return res.status(400).json({ message: "Please enter a valid return date." });
    const date = req.body.date ? new Date(req.body.date) : new Date();
    if (date < new Date(new Date(purchase.date).toDateString())) return res.status(400).json({ message: "The return date can't be before the invoice date." });

    const wanted = new Map();
    for (const it of Array.isArray(req.body.items) ? req.body.items : []) {
      const qty = Number(it?.qtyPacks);
      if (!qty) continue;
      if (!(Number.isInteger(qty) && qty > 0)) return res.status(400).json({ message: "Return quantities must be whole numbers." });
      wanted.set(String(it.batch), (wanted.get(String(it.batch)) || 0) + qty);
    }
    if (!wanted.size) return res.status(400).json({ message: "Enter the quantity to return for at least one item." });

    const lines = await eligibility(purchase);
    const items = [];
    for (const [batchId, qtyPacks] of wanted) {
      const line = lines.find((l) => String(l.batch) === batchId);
      if (!line) return res.status(400).json({ message: "An item is not on this invoice." });
      if (qtyPacks > line.eligiblePacks) {
        return res.status(400).json({
          message: `${line.product.name} (batch ${line.batchNo}): only ${line.eligiblePacks} can be returned - ${line.receivedPacks} received, ${line.returnedPacks} already returned, ${line.onHandPacks} still in stock.`,
        });
      }
      const lineAmount = r2(qtyPacks * line.rate);
      items.push({
        product: line.product._id,
        batch: line.batch,
        batchNo: line.batchNo,
        qtyPacks,
        qtyUnits: qtyPacks * line.unitsPerPack,
        rate: line.rate,
        gstPercent: line.gstPercent,
        lineAmount,
        lineGst: r2((lineAmount * line.gstPercent) / 100),
      });
    }
    const subtotal = r2(items.reduce((s, i) => s + i.lineAmount, 0));
    const gstAmount = r2(items.reduce((s, i) => s + i.lineGst, 0));

    try {
      const ret = await PurchaseReturn.create({
        ...(clientRef ? { clientRef } : {}),
        returnNo: `PR-${String(await nextSequence("purchaseReturnNo")).padStart(6, "0")}`,
        purchase: purchase._id,
        purchaseOrder: purchase.purchaseOrder || null,
        vendor: purchase.vendor || null,
        invoiceNo: purchase.invoiceNo,
        piNo: purchase.piNo || "",
        date,
        items,
        subtotal,
        gstAmount,
        total: r2(subtotal + gstAmount),
        reason: String(req.body.reason || "").trim().slice(0, 200),
        notes: String(req.body.notes || "").trim().slice(0, 1000),
        createdBy: req.user._id,
      });
      for (const i of items) {
        const batch = await Batch.findById(i.batch);
        const rack = effectiveLocations(batch)[0]?.rack ?? batch.rack ?? "";
        await takeOff(batch, i.qtyUnits);
        await StockLedger.create({
          product: i.product,
          batch: i.batch,
          type: "purchase-return",
          qtyChange: -i.qtyUnits,
          rack,
          reason: `Purchase return ${ret.returnNo} (invoice ${purchase.piNo || purchase.invoiceNo})`,
          refId: ret._id,
          performedBy: req.user._id,
        });
      }
      for (const pid of new Set(items.map((i) => String(i.product)))) {
        const p = await Product.findById(pid);
        if (p) await refreshProductRack(p);
      }
      res.status(201).json(ret);
    } catch (e) {
      rethrowIfRetryable(e);
      if (isDuplicateOf(e, "clientRef")) return res.status(409).json({ message: "This return has already been saved." });
      throw e;
    }
  })
);

// Cancels a confirmed return: its stock goes back onto the same batches.
router.post(
  "/:id/cancel",
  transactional(async (req, res) => {
    const ret = mongoose.isValidObjectId(req.params.id) ? await PurchaseReturn.findById(req.params.id) : null;
    if (!ret) return res.status(404).json({ message: "No records found." });
    if (ret.status === "Cancelled") return res.status(400).json({ message: "This return is already cancelled." });
    for (const i of ret.items) {
      const batch = await Batch.findById(i.batch);
      if (!batch) return res.status(400).json({ message: "A batch on this return no longer exists, so it can't be cancelled." });
      batch.qtyRemaining += i.qtyUnits;
      batch.isDeleted = false;
      batch.locations = effectiveLocations(batch);
      await batch.save();
      await Product.updateOne({ _id: i.product }, { $inc: { qty: i.qtyUnits } });
      await StockLedger.create({
        product: i.product,
        batch: i.batch,
        type: "purchase-return-cancel",
        qtyChange: i.qtyUnits,
        rack: batch.rack || "",
        reason: `Cancelled purchase return ${ret.returnNo}`,
        refId: ret._id,
        performedBy: req.user._id,
      });
    }
    ret.set({ status: "Cancelled", cancelledAt: new Date(), cancelledBy: req.user._id, cancelReason: String(req.body?.reason || "").trim().slice(0, 200) });
    await ret.save();
    for (const pid of new Set(ret.items.map((i) => String(i.product)))) {
      const p = await Product.findById(pid);
      if (p) await refreshProductRack(p);
    }
    res.json(ret);
  })
);

export default router;
