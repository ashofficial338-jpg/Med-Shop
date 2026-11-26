import { Router } from "express";
import mongoose from "mongoose";
import PurchaseOrder, { PO_STATUSES } from "../models/PurchaseOrder.js";
import Purchase from "../models/Purchase.js";
import CancelledPurchase from "../models/CancelledPurchase.js";
import Product from "../models/Product.js";
import Vendor from "../models/Vendor.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { dayRange } from "../utils/queryFilters.js";
import { shopDay, streamExcelReport, streamPdfReport, periodLabel } from "../utils/reportExport.js";
import { streamPurchaseDocPdf } from "../utils/purchaseDocPdf.js";
import { receivedByPo, progressOf, statusFrom, nextPoNo, poDocument } from "../utils/purchaseOrders.js";
import { cleanClientRef, isDuplicateOf } from "../utils/transaction.js";

// Purchase Orders. Raising, editing or cancelling one never touches stock,
// supplier balances or any report of purchases - only a Purchase Invoice
// saved against it (routes/purchases.js) brings stock in.
const router = Router();
router.use(requireAuth, requireRole("admin"));

const GST_VALUES = [0, 5, 12, 18, 28];
const r2 = (n) => Number(Number(n || 0).toFixed(2));
const escapeRegex = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isDay = (v) => /^\d{4}-\d{2}-\d{2}/.test(String(v || "")) && !Number.isNaN(new Date(v).getTime());
const PRODUCT_FIELDS = "name productCode packUnit hsnCode gstPercent soldAs unitsPerPack";

async function buildFilter(q) {
  const filter = {};
  if (q.status && PO_STATUSES.includes(q.status)) filter.status = q.status;
  else if (q.status === "open") filter.status = { $in: ["Pending", "Partially Received"] };
  if (q.vendor && mongoose.isValidObjectId(q.vendor)) filter.vendor = q.vendor;
  if (q.product && mongoose.isValidObjectId(q.product)) filter["items.product"] = q.product;
  const range = dayRange(isDay(q.from) ? q.from : null, isDay(q.to) ? q.to : null);
  if (range) filter.date = range;
  const text = String(q.q || "").trim().slice(0, 60);
  if (text) {
    const re = new RegExp(escapeRegex(text), "i");
    const vendors = await Vendor.find({ name: re }, "_id").lean();
    filter.$or = [{ poNo: re }, { vendor: { $in: vendors.map((v) => v._id) } }, { notes: re }];
  }
  return filter;
}

async function withProgress(pos) {
  const received = await receivedByPo(pos.map((p) => p._id));
  return pos.map((po) => {
    const pr = progressOf(po, received.get(String(po._id)));
    const o = po.toObject ? po.toObject() : po;
    return { ...o, progress: { ordered: pr.ordered, received: pr.received, pending: pr.pending }, items: o.items.map((i, k) => ({ ...i, ...pr.lines[k] })) };
  });
}

router.get("/", async (req, res) => {
  const pos = await PurchaseOrder.find(await buildFilter(req.query))
    .populate("vendor", "name phone")
    .populate("items.product", PRODUCT_FIELDS)
    .sort({ date: -1, createdAt: -1 })
    .limit(500);
  res.json(await withProgress(pos));
});

router.get("/export", async (req, res) => {
  const pos = await withProgress(
    await PurchaseOrder.find(await buildFilter(req.query)).populate("vendor", "name").sort({ date: -1, createdAt: -1 }).lean()
  );
  const rows = pos.map((p) => ({
    poNo: p.poNo,
    date: shopDay(p.date),
    expected: p.expectedDate ? shopDay(p.expectedDate) : "",
    vendor: p.vendor?.name || "",
    items: p.items.length,
    ordered: p.progress.ordered,
    received: p.progress.received,
    pending: p.progress.pending,
    subtotal: p.subtotal,
    gst: p.gstAmount,
    total: p.total,
    status: p.status,
  }));
  const total = r2(rows.reduce((s, r) => s + r.total, 0));
  const subtitle = [periodLabel(req.query.from, req.query.to), req.query.status ? `Status: ${req.query.status}` : ""].filter(Boolean).join(" · ");
  if (req.query.format === "pdf") {
    return streamPdfReport(res, "GuganMedicals_Purchase_Orders.pdf", {
      title: "Gugan Medicals - Purchase Order Report",
      subtitle,
      columns: [
        { header: "PO No", key: "poNo" },
        { header: "Date", key: "date" },
        { header: "Supplier", key: "vendor", flex: 1.8 },
        { header: "Ordered", key: "ordered", align: "right", flex: 0.7 },
        { header: "Received", key: "received", align: "right", flex: 0.7 },
        { header: "Pending", key: "pending", align: "right", flex: 0.7 },
        { header: "Total", key: "total", align: "right" },
        { header: "Status", key: "status", flex: 1.2 },
      ],
      rows: rows.map((r) => ({ ...r, total: r.total.toFixed(2) })),
      summaryLines: [`Total value: Rs. ${total.toFixed(2)}`],
    });
  }
  return streamExcelReport(res, "GuganMedicals_Purchase_Orders.xlsx", [
    {
      name: "Purchase Orders",
      columns: [
        { header: "PO No", key: "poNo", width: 14 },
        { header: "Date", key: "date", width: 12 },
        { header: "Expected By", key: "expected", width: 12 },
        { header: "Supplier", key: "vendor", width: 26 },
        { header: "Lines", key: "items", width: 8 },
        { header: "Qty Ordered", key: "ordered", width: 12 },
        { header: "Qty Received", key: "received", width: 12 },
        { header: "Qty Pending", key: "pending", width: 12 },
        { header: "Subtotal", key: "subtotal", width: 12 },
        { header: "GST", key: "gst", width: 10 },
        { header: "Total", key: "total", width: 12 },
        { header: "Status", key: "status", width: 18 },
      ],
      rows,
    },
  ]);
});

async function loadFull(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  return PurchaseOrder.findById(id)
    .populate("vendor", "name contactPerson phone email address gstNumber")
    .populate("items.product", PRODUCT_FIELDS)
    .populate("createdBy", "username")
    .populate("cancelledBy", "username");
}

router.get("/:id", async (req, res) => {
  const po = await loadFull(req.params.id);
  if (!po) return res.status(404).json({ message: "No records found." });
  const [full] = await withProgress([po]);
  const [invoices, cancelled] = await Promise.all([
    Purchase.find({ purchaseOrder: po._id }, "piNo invoiceNo date total items.product items.qtyPacks").sort({ date: 1 }).lean(),
    CancelledPurchase.find({ purchaseOrder: po._id }, "piNo invoiceNo date total reason createdAt").sort({ createdAt: 1 }).lean(),
  ]);
  res.json({ ...full, invoices, cancelledInvoices: cancelled });
});

router.get("/:id/pdf", async (req, res) => {
  const po = await loadFull(req.params.id);
  if (!po) return res.status(404).json({ message: "No records found." });
  streamPurchaseDocPdf(res, `${po.poNo}.pdf`, poDocument(po), { download: req.query.download === "1" });
});

// Checks and prices the submitted lines. Returns { error } or the figures.
async function readOrder(body) {
  const { items } = body;
  if (!Array.isArray(items) || items.length === 0) return { error: "Add at least one item to the order." };
  if (items.length > 300) return { error: "An order can have at most 300 lines." };
  const ids = items.map((i) => i?.product).filter((id) => mongoose.isValidObjectId(id));
  const products = new Map((await Product.find({ _id: { $in: ids } })).map((p) => [String(p._id), p]));
  const lines = [];
  for (const item of items) {
    const product = products.get(String(item?.product));
    if (!product) return { error: "Choose the item for each line (or remove empty lines)." };
    const qty = Number(item.qty);
    const rate = item.rate === "" || item.rate == null ? 0 : Number(item.rate);
    const discountPercent = item.discountPercent === "" || item.discountPercent == null ? 0 : Number(item.discountPercent);
    const gstPercent = item.gstPercent === "" || item.gstPercent == null ? product.gstPercent || 0 : Number(item.gstPercent);
    if (!(Number.isInteger(qty) && qty > 0)) return { error: `Enter a whole quantity for ${product.name}.` };
    if (!(rate >= 0)) return { error: `Enter a valid rate for ${product.name}.` };
    if (!(discountPercent >= 0 && discountPercent <= 100)) return { error: `The discount on ${product.name} must be between 0 and 100%.` };
    if (!GST_VALUES.includes(gstPercent)) return { error: `Choose a valid GST rate for ${product.name}.` };
    const gross = qty * rate;
    const lineAmount = r2(gross * (1 - discountPercent / 100));
    const lineGst = r2((lineAmount * gstPercent) / 100);
    lines.push({ product: product._id, qty, rate, discountPercent, gstPercent, lineAmount, lineGst, lineTotal: r2(lineAmount + lineGst), gross });
  }
  const grossAmount = r2(lines.reduce((s, l) => s + l.gross, 0));
  const subtotal = r2(lines.reduce((s, l) => s + l.lineAmount, 0));
  const gstAmount = r2(lines.reduce((s, l) => s + l.lineGst, 0));
  if (body.date && !isDay(body.date)) return { error: "Please enter a valid date." };
  if (body.expectedDate && !isDay(body.expectedDate)) return { error: "Please enter a valid expected date." };
  if (body.date && body.expectedDate && body.expectedDate < body.date) return { error: "The expected date can't be before the order date." };
  return {
    items: lines.map(({ gross, ...l }) => l),
    grossAmount,
    discountAmount: r2(grossAmount - subtotal),
    subtotal,
    gstAmount,
    total: r2(subtotal + gstAmount),
    notes: String(body.notes || "").trim().slice(0, 1000),
    expectedDate: body.expectedDate || null,
  };
}

async function activeVendor(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  const v = await Vendor.findById(id);
  return v && v.isActive !== false ? v : null;
}

router.post("/", async (req, res) => {
  const clientRef = cleanClientRef(req.body.clientRef);
  if (clientRef) {
    const saved = await PurchaseOrder.findOne({ clientRef, createdBy: req.user._id });
    if (saved) return res.status(200).json({ ...saved.toObject(), alreadySaved: true });
  }
  const vendor = await activeVendor(req.body.vendor);
  if (!vendor) return res.status(400).json({ message: "Choose the supplier for this order." });
  const order = await readOrder(req.body);
  if (order.error) return res.status(400).json({ message: order.error });
  const status = req.body.status === "Draft" ? "Draft" : "Pending";
  try {
    const po = await PurchaseOrder.create({
      ...order,
      ...(clientRef ? { clientRef } : {}),
      poNo: await nextPoNo(),
      vendor: vendor._id,
      date: req.body.date || new Date(),
      status,
      createdBy: req.user._id,
    });
    res.status(201).json(po);
  } catch (e) {
    if (isDuplicateOf(e, "clientRef")) return res.status(409).json({ message: "This order has already been saved. Check Purchase Orders." });
    throw e;
  }
});

// Edit an order that isn't finished. Lines can't drop below what has already
// been received, and the supplier is fixed once anything has come in.
router.put("/:id", async (req, res) => {
  const po = mongoose.isValidObjectId(req.params.id) ? await PurchaseOrder.findById(req.params.id) : null;
  if (!po) return res.status(404).json({ message: "No records found." });
  if (["Completed", "Cancelled"].includes(po.status)) return res.status(400).json({ message: `A ${po.status.toLowerCase()} order can't be edited.` });
  const order = await readOrder(req.body);
  if (order.error) return res.status(400).json({ message: order.error });

  const received = (await receivedByPo([po._id])).get(String(po._id)) || new Map();
  let vendorId = po.vendor;
  if (req.body.vendor && String(req.body.vendor) !== String(po.vendor)) {
    if (received.size) return res.status(400).json({ message: "Goods have already been received against this order, so its supplier can't change." });
    const v = await activeVendor(req.body.vendor);
    if (!v) return res.status(400).json({ message: "Choose the supplier for this order." });
    vendorId = v._id;
  }
  const orderedNow = new Map();
  for (const l of order.items) orderedNow.set(String(l.product), (orderedNow.get(String(l.product)) || 0) + l.qty);
  for (const [pid, got] of received) {
    if ((orderedNow.get(pid) || 0) < got) {
      const p = await Product.findById(pid, "name");
      return res.status(400).json({ message: `${got} of ${p?.name || "an item"} have already been received, so it can't be ordered in a smaller quantity.` });
    }
  }
  po.set({ ...order, vendor: vendorId, date: req.body.date || po.date, editedAt: new Date(), editedBy: req.user._id });
  if (po.status === "Draft" && req.body.status === "Pending") po.status = "Pending";
  po.status = statusFrom(po, progressOf(po, received));
  await po.save();
  res.json(po);
});

// Draft -> Pending: the order is raised with the supplier.
router.post("/:id/raise", async (req, res) => {
  const po = mongoose.isValidObjectId(req.params.id) ? await PurchaseOrder.findById(req.params.id) : null;
  if (!po) return res.status(404).json({ message: "No records found." });
  if (po.status !== "Draft") return res.status(400).json({ message: "Only a draft order can be raised." });
  po.status = "Pending";
  await po.save();
  res.json(po);
});

// Cancels (or, once part has arrived, closes) an order: nothing more can be
// received against it. Invoices already saved against it stay as they are.
router.post("/:id/cancel", async (req, res) => {
  const po = mongoose.isValidObjectId(req.params.id) ? await PurchaseOrder.findById(req.params.id) : null;
  if (!po) return res.status(404).json({ message: "No records found." });
  if (["Completed", "Cancelled"].includes(po.status)) return res.status(400).json({ message: `This order is already ${po.status.toLowerCase()}.` });
  po.set({ status: "Cancelled", cancelledAt: new Date(), cancelledBy: req.user._id, cancelReason: String(req.body?.reason || "").trim().slice(0, 200) });
  await po.save();
  res.json(po);
});

// Only an order nothing was received against can be deleted.
router.delete("/:id", async (req, res) => {
  const po = mongoose.isValidObjectId(req.params.id) ? await PurchaseOrder.findById(req.params.id) : null;
  if (!po) return res.status(404).json({ message: "No records found." });
  if (!["Draft", "Cancelled", "Pending"].includes(po.status) || (await Purchase.exists({ purchaseOrder: po._id })) || (await CancelledPurchase.exists({ purchaseOrder: po._id }))) {
    return res.status(400).json({ message: "Invoices have been recorded against this order, so it can't be deleted. Cancel it instead." });
  }
  await PurchaseOrder.deleteOne({ _id: po._id });
  res.json({ message: `Purchase order ${po.poNo} deleted.` });
});

export default router;
