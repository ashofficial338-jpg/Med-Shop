import mongoose from "mongoose";
import Purchase from "../models/Purchase.js";
import PurchaseOrder from "../models/PurchaseOrder.js";
import { nextSequence } from "../models/Counter.js";
import { pdfDay } from "./purchaseDocPdf.js";

// Purchase Order -> Purchase Invoice links. A PO never holds stock; what has
// been received against it is always read from the invoices saved against it,
// so editing or cancelling an invoice is reflected at once.

const r2 = (n) => Number(Number(n || 0).toFixed(2));

// Packs received per product on every invoice against these POs:
// Map(poId -> Map(productId -> packs)).
export async function receivedByPo(poIds) {
  const ids = poIds.map((id) => new mongoose.Types.ObjectId(String(id)));
  const rows = await Purchase.aggregate([
    { $match: { purchaseOrder: { $in: ids } } },
    { $unwind: "$items" },
    { $group: { _id: { po: "$purchaseOrder", product: "$items.product" }, packs: { $sum: "$items.qtyPacks" } } },
  ]);
  const out = new Map();
  for (const r of rows) {
    const po = String(r._id.po);
    if (!out.has(po)) out.set(po, new Map());
    out.get(po).set(String(r._id.product), r.packs);
  }
  return out;
}

// Ordered / received / pending for each line of one PO.
export function progressOf(po, received = new Map()) {
  const left = new Map(received); // one product on two lines: fill the first one first
  const lines = po.items.map((i) => {
    const pid = String(i.product?._id || i.product);
    const got = Math.min(left.get(pid) || 0, i.qty);
    left.set(pid, (left.get(pid) || 0) - got);
    return { ordered: i.qty, received: got, pending: Math.max(i.qty - got, 0) };
  });
  // Anything received beyond the ordered lines is counted on the last line of that product.
  for (const [pid, extra] of left) {
    if (extra <= 0) continue;
    const idx = po.items.map((i) => String(i.product?._id || i.product)).lastIndexOf(pid);
    if (idx >= 0) lines[idx].received += extra;
  }
  const ordered = lines.reduce((s, l) => s + l.ordered, 0);
  const got = lines.reduce((s, l) => s + Math.min(l.received, l.ordered), 0);
  return { lines, ordered, received: got, pending: ordered - got };
}

export function statusFrom(po, progress) {
  if (po.status === "Draft" || po.status === "Cancelled") return po.status;
  if (progress.received <= 0) return "Pending";
  return progress.pending <= 0 ? "Completed" : "Partially Received";
}

// Recomputes the status of these POs from their invoices (after any invoice
// is saved, edited, cancelled or deleted).
export async function refreshPoStatus(...poIds) {
  const ids = [...new Set(poIds.filter(Boolean).map(String))];
  if (!ids.length) return;
  const pos = await PurchaseOrder.find({ _id: { $in: ids } });
  const received = await receivedByPo(ids);
  for (const po of pos) {
    const next = statusFrom(po, progressOf(po, received.get(String(po._id))));
    if (next !== po.status) {
      po.status = next;
      await po.save();
    }
  }
}

export async function nextPoNo() {
  return `PO-${String(await nextSequence("purchaseOrderNo")).padStart(6, "0")}`;
}

// Purchases saved before PI numbers existed get one, oldest first. Runs on
// every boot and does nothing once all are numbered.
export async function backfillPiNumbers() {
  const missing = await Purchase.find({ piNo: { $exists: false } }, "_id").sort({ date: 1, createdAt: 1 }).lean();
  for (const p of missing) {
    const piNo = `PI-${String(await nextSequence("purchaseInvoiceNo")).padStart(6, "0")}`;
    await Purchase.updateOne({ _id: p._id, piNo: { $exists: false } }, { $set: { piNo } });
  }
  if (missing.length) console.log(`Purchase invoice numbers given to ${missing.length} earlier purchases.`);
}

// ---------- printable documents (utils/purchaseDocPdf.js) ----------

const supplierOf = (v, fallback) =>
  v ? { name: v.name, contactPerson: v.contactPerson, address: v.address, phone: v.phone, email: v.email, gstNumber: v.gstNumber } : { name: fallback || "No supplier" };
const unitOf = (p) => p?.packUnit || "";

export function poDocument(po) {
  return {
    title: "PURCHASE ORDER",
    number: po.poNo,
    date: po.date,
    status: po.status,
    supplier: supplierOf(po.vendor),
    meta: [
      ["PO Number", po.poNo],
      ["PO Date", pdfDay(po.date)],
      ["Expected By", po.expectedDate ? pdfDay(po.expectedDate) : ""],
      ["Status", po.status],
      ["Items", String(po.items.length)],
    ],
    columns: "order",
    items: po.items.map((i) => ({
      name: i.product?.name || "Item",
      code: i.product?.productCode,
      hsn: i.product?.hsnCode,
      qty: i.qty,
      unit: unitOf(i.product),
      rate: i.rate,
      discountPercent: i.discountPercent,
      taxable: i.lineAmount,
      gstPercent: i.gstPercent,
      gst: i.lineGst,
      amount: i.lineTotal,
    })),
    totals: { gross: po.grossAmount, discount: po.discountAmount, taxable: po.subtotal, gst: po.gstAmount, total: po.total },
    notes: [po.notes, po.status === "Cancelled" && po.cancelReason ? `Cancelled: ${po.cancelReason}` : ""].filter(Boolean).join("\n"),
    notesLabel: "TERMS & NOTES",
    footerNote: "Please quote the PO number on your invoice and delivery challan.",
  };
}

export function piDocument(p, { returns = [] } = {}) {
  const items = p.items.map((i) => {
    const gross = i.qtyPacks * i.costPrice;
    return {
      name: i.product?.name || "Item",
      code: i.product?.productCode,
      hsn: i.product?.hsnCode,
      batchNo: i.batchNo,
      expiry: i.expiryDate ? new Date(i.expiryDate).toLocaleDateString("en-GB", { month: "2-digit", year: "numeric", timeZone: "Asia/Kolkata" }) : "",
      qty: i.qtyPacks,
      unit: unitOf(i.product),
      rate: i.costPrice,
      discountPercent: i.discountPercent,
      gross,
      taxable: i.lineAmount,
      gstPercent: i.lineAmount ? r2((i.lineGst / i.lineAmount) * 100) : i.product?.gstPercent || 0,
      gst: i.lineGst,
      amount: r2(i.lineAmount + i.lineGst),
    };
  });
  const gross = r2(items.reduce((s, i) => s + i.gross, 0));
  const returned = r2(returns.reduce((s, r) => s + r.total, 0));
  return {
    title: "PURCHASE INVOICE",
    number: p.piNo || p.invoiceNo,
    date: p.date,
    status: "Confirmed",
    supplier: supplierOf(p.vendor, p.supplierName),
    meta: [
      ["PI Number", p.piNo],
      ["Invoice Date", pdfDay(p.date)],
      ["Supplier Inv No", p.invoiceNo],
      ["PO Reference", p.purchaseOrder?.poNo || ""],
      ["Payment", p.paymentMode],
      ["Balance Due", p.paymentMode === "Credit" ? `Rs. ${r2(p.total - (p.amountPaid ?? p.total)).toFixed(2)}` : ""],
      ["Returned", returned ? `Rs. ${returned.toFixed(2)} (${returns.map((r) => r.returnNo).join(", ")})` : ""],
    ],
    columns: "invoice",
    items,
    totals: { gross, discount: r2(gross - p.subtotal), taxable: p.subtotal, gst: p.gstAmount, total: p.total },
    notes: p.tdsAmount ? `TDS: Rs. ${Number(p.tdsAmount).toFixed(2)} (tracked separately)` : "",
    footerNote: "Goods received in good condition. Stock was added when this invoice was confirmed.",
  };
}

export function prDocument(r) {
  return {
    title: "PURCHASE RETURN",
    number: r.returnNo,
    date: r.date,
    status: r.status,
    supplier: supplierOf(r.vendor),
    supplierLabel: "RETURNED TO",
    meta: [
      ["Return No", r.returnNo],
      ["Return Date", pdfDay(r.date)],
      ["Against PI", r.piNo || ""],
      ["Supplier Inv No", r.invoiceNo],
      ["PO Reference", r.purchaseOrder?.poNo || ""],
      ["Reason", r.reason],
    ],
    columns: "return",
    items: r.items.map((i) => ({
      name: i.product?.name || "Item",
      code: i.product?.productCode,
      hsn: i.product?.hsnCode,
      batchNo: i.batchNo,
      qty: i.qtyPacks,
      unit: unitOf(i.product),
      rate: i.rate,
      taxable: i.lineAmount,
      gstPercent: i.gstPercent,
      gst: i.lineGst,
      amount: r2(i.lineAmount + i.lineGst),
    })),
    totals: { gross: r.subtotal, discount: 0, taxable: r.subtotal, gst: r.gstAmount, total: r.total },
    totalLabel: "Return Value",
    notes: [r.notes, r.status === "Cancelled" && r.cancelReason ? `Cancelled: ${r.cancelReason}` : ""].filter(Boolean).join("\n"),
    footerNote: "Goods returned to the supplier. Stock was reduced when this return was confirmed.",
  };
}
