import { Router } from "express";
import mongoose from "mongoose";
import SalesEntry from "../models/SalesEntry.js";
import Customer from "../models/Customer.js";
import Counter, { nextSequence } from "../models/Counter.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { calcInvoice, GST_RATES, PAYMENT_MODES } from "../utils/salesEntryCalc.js";
import { salesEntryPdf, salesEntryXlsx } from "../utils/salesEntryDocs.js";
import { KINDS, formatArchiveNo } from "../utils/invoiceArchive.js";
import { dayRange } from "../utils/queryFilters.js";
import { SHOP } from "../utils/saleHelpers.js";
import Product from "../models/Product.js";
import { findOrCreateProduct, findProductByName } from "../utils/productAutoCreate.js";
import { hasPermission } from "../utils/permissions.js";

// Sales Entry (Tally-style sales voucher) - see models/SalesEntry.js.
// Anyone signed in can make one; staff see only their own. Editing an
// existing entry is Admin-only, like every other edit in the app.
const router = Router();
router.use(requireAuth);

const { prefix, counter } = KINDS["sales-entry"];
const escapeRe = (s) => String(s).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;

const canSee = (entry, user) => user.role === "admin" || String(entry.createdBy?._id || entry.createdBy) === String(user._id);

// Links every line to a product in the Product List: a picked product is
// checked, a typed name is matched to an existing product (ignoring case and
// spaces) or added as a new one. Adding products needs the "Add products"
// permission (Admins always have it). Returns { error } or { created }.
async function linkProducts(items, user) {
  const all = await Product.find({ isActive: true }, "name").lean();
  const missing = [];
  for (const it of items) {
    if (it.product && all.some((p) => String(p._id) === String(it.product))) continue;
    it.product = null;
    if (!(await findProductByName(it.name, all))) missing.push(it.name);
  }
  if (missing.length && !hasPermission(user, "products.add")) {
    return { error: `${[...new Set(missing)].join(", ")} ${missing.length === 1 ? "is" : "are"} not in the Product List, and you don't have permission to add products. Pick an existing product or ask an Admin.` };
  }
  const cache = new Map();
  const created = [];
  for (const it of items) {
    if (it.product) continue;
    const { product, created: isNew } = await findOrCreateProduct(it.name, { hsnCode: it.hsnCode, unit: it.unit, gstPercent: it.gstPercent, rate: it.rate }, cache);
    it.product = product._id;
    if (isNew) created.push({ _id: product._id, name: product.name, productCode: product.productCode });
  }
  return { created };
}

// "2026-11-23" -> noon India time that day, so the date reads the same in
// every time zone (and in the dated folder the saver picks).
function parseInvoiceDate(value) {
  if (!value) return new Date();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  const d = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00+05:30`) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Checks the form and works out every amount. Returns { error } or { data }.
function buildEntry(body) {
  const customer = body.customer || {};
  const c = {
    name: String(customer.name || "").trim(),
    address: String(customer.address || "").trim(),
    gstin: String(customer.gstin || "").trim().toUpperCase(),
    mobile: String(customer.mobile || "").replace(/\D/g, ""),
  };
  if (c.gstin && !GSTIN_RE.test(c.gstin)) return { error: "Customer GST number should be 15 characters, e.g. 33ABCDE1234F1Z5." };
  if (c.mobile && c.mobile.length !== 10) return { error: "Mobile number should be 10 digits." };
  if (c.name.length > 120 || c.address.length > 300) return { error: "Customer name or address is too long." };

  // The simple form has no payment mode field - Cash unless one is sent.
  const paymentMode = body.paymentMode == null || body.paymentMode === "" ? "Cash" : PAYMENT_MODES.includes(body.paymentMode) ? body.paymentMode : null;
  if (!paymentMode) return { error: "Choose a payment mode: Cash, UPI, Card, Bank Transfer or Credit." };
  if (paymentMode === "Credit" && !c.name) return { error: "Enter the customer's name for a credit sale." };

  const invoiceDate = parseInvoiceDate(body.invoiceDate);
  if (!invoiceDate) return { error: "Enter a valid invoice date." };

  const raw = Array.isArray(body.items) ? body.items : [];
  // Rows left completely empty on the form are simply ignored.
  const rows = raw.filter((it) => String(it?.name || "").trim() || Number(it?.qty) || Number(it?.rate));
  if (!rows.length) return { error: "Add at least one item." };
  if (rows.length > 200) return { error: "An invoice can have at most 200 items." };
  const items = [];
  for (const [i, it] of rows.entries()) {
    const n = i + 1;
    const name = String(it.name || "").trim();
    const qty = Number(it.qty);
    const rate = Number(it.rate);
    const discountPercent = it.discountPercent === "" || it.discountPercent == null ? 0 : Number(it.discountPercent);
    const gstPercent = Number(it.gstPercent);
    if (!name) return { error: `Item ${n}: enter the item name.` };
    if (!(qty > 0)) return { error: `Item ${n} (${name}): enter a quantity above 0.` };
    if (!(rate >= 0) || !Number.isFinite(rate)) return { error: `Item ${n} (${name}): enter a valid rate.` };
    if (!(discountPercent >= 0 && discountPercent <= 100)) return { error: `Item ${n} (${name}): discount must be between 0 and 100%.` };
    if (!GST_RATES.includes(gstPercent)) return { error: `Item ${n} (${name}): GST must be 0, 5, 12, 18 or 28%.` };
    items.push({
      product: mongoose.isValidObjectId(it.product) ? it.product : null,
      name: name.slice(0, 200),
      hsnCode: String(it.hsnCode || "").trim().slice(0, 20),
      unit: String(it.unit || "").trim().slice(0, 30) || "Nos",
      qty,
      rate,
      discountPercent,
      gstPercent,
    });
  }

  const interState = Boolean(body.interState);
  const calc = calcInvoice(items, interState);
  return {
    data: {
      invoiceDate,
      customer: c,
      interState,
      items: calc.lines,
      subtotal: calc.subtotal,
      discountTotal: calc.discountTotal,
      taxableTotal: calc.taxableTotal,
      cgstTotal: calc.cgstTotal,
      sgstTotal: calc.sgstTotal,
      igstTotal: calc.igstTotal,
      roundOff: calc.roundOff,
      grandTotal: calc.grandTotal,
      amountInWords: calc.amountInWords,
      paymentMode,
      notes: String(body.notes || "").trim().slice(0, 500),
    },
  };
}

// Number the next entry would get (POS bills share the series, so it's
// confirmed only when the entry is saved), plus the shop's GSTIN for the
// IGST check on the form.
router.get("/meta", async (req, res) => {
  const current = await Counter.findById(counter);
  res.json({ nextInvoiceNo: formatArchiveNo(prefix, (current?.seq || 0) + 1), shopGstin: SHOP.gstin || "", gstRates: GST_RATES, paymentModes: PAYMENT_MODES });
});

// Customer suggestions for the form: earlier Sales Entry customers (with
// their GSTIN) first, then the shop's customer list.
router.get("/customers", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json([]);
  const re = new RegExp(escapeRe(q), "i");
  const own = req.user.role === "admin" ? {} : { createdBy: req.user._id };
  const past = await SalesEntry.aggregate([
    { $match: { ...own, $or: [{ "customer.name": re }, { "customer.mobile": re }] } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: { name: { $toLower: "$customer.name" }, mobile: "$customer.mobile" }, customer: { $first: "$customer" } } },
    { $limit: 8 },
  ]);
  const list = past.map((p) => p.customer).filter((c) => c.name);
  const directory = await Customer.find({ isActive: true, $or: [{ name: re }, { phone: re }] }, "name phone address").limit(8);
  for (const d of directory) {
    if (list.some((c) => c.name.toLowerCase() === (d.name || "").toLowerCase() && (c.mobile || "") === (d.phone || ""))) continue;
    list.push({ name: d.name, mobile: d.phone || "", address: d.address || "", gstin: "" });
  }
  res.json(list.slice(0, 10));
});

async function buildFilter(req) {
  const { q, from, to, paymentMode } = req.query;
  const filter = {};
  if (req.user.role !== "admin") filter.createdBy = req.user._id;
  if (q && String(q).trim()) {
    const re = new RegExp(escapeRe(q), "i");
    filter.$or = [{ archiveNo: re }, { "customer.name": re }, { "customer.mobile": re }];
  }
  const range = dayRange(from, to);
  if (range) filter.invoiceDate = range;
  if (PAYMENT_MODES.includes(paymentMode)) filter.paymentMode = paymentMode;
  return filter;
}

router.get("/", async (req, res) => {
  const entries = await SalesEntry.find(await buildFilter(req), "-items")
    .populate("createdBy", "username")
    .sort({ invoiceDate: -1, createdAt: -1 })
    .limit(500);
  res.json(entries);
});

// Sales history as one Excel sheet (registered before "/:id").
router.get("/export", async (req, res) => {
  const ExcelJS = (await import("exceljs")).default;
  const entries = await SalesEntry.find(await buildFilter(req)).sort({ invoiceDate: -1, createdAt: -1 });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sales Entries");
  ws.columns = [
    { header: "Invoice No", key: "no", width: 13 },
    { header: "Date", key: "date", width: 12 },
    { header: "Customer", key: "name", width: 26 },
    { header: "Mobile", key: "mobile", width: 13 },
    { header: "GSTIN", key: "gstin", width: 18 },
    { header: "Payment Mode", key: "mode", width: 14 },
    { header: "Taxable", key: "taxable", width: 13 },
    { header: "CGST", key: "cgst", width: 11 },
    { header: "SGST", key: "sgst", width: 11 },
    { header: "IGST", key: "igst", width: 11 },
    { header: "Grand Total", key: "total", width: 14 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const e of entries) {
    ws.addRow({
      no: e.archiveNo,
      date: e.invoiceDate.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }),
      name: e.customer?.name || "Cash Customer",
      mobile: e.customer?.mobile || "",
      gstin: e.customer?.gstin || "",
      mode: e.paymentMode,
      taxable: e.taxableTotal,
      cgst: e.cgstTotal,
      sgst: e.sgstTotal,
      igst: e.igstTotal,
      total: e.grandTotal,
    });
  }
  ["taxable", "cgst", "sgst", "igst", "total"].forEach((k) => (ws.getColumn(k).numFmt = "#,##0.00"));
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="Sales_Entries.xlsx"');
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
});

async function findEntry(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ message: "No records found." });
    return null;
  }
  const entry = await SalesEntry.findById(req.params.id).populate("createdBy", "username").populate("editedBy", "username");
  if (!entry) {
    res.status(404).json({ message: "No records found." });
    return null;
  }
  if (!canSee(entry, req.user)) {
    res.status(403).json({ message: "You do not have permission to perform this action." });
    return null;
  }
  return entry;
}

router.get("/:id", async (req, res) => {
  const entry = await findEntry(req, res);
  if (entry) res.json(entry);
});

// SALES-001.pdf / SALES-001.xlsx (?inline=1 shows the PDF instead of saving it).
router.get("/:id/file.:format(pdf|xlsx)", async (req, res) => {
  const entry = await findEntry(req, res);
  if (!entry) return;
  const pdf = req.params.format === "pdf";
  const body = pdf ? await salesEntryPdf(entry) : await salesEntryXlsx(entry);
  res.setHeader("Content-Type", pdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `${pdf && req.query.inline ? "inline" : "attachment"}; filename="${entry.archiveNo}.${req.params.format}"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(body);
});

router.post("/", async (req, res) => {
  const { error, data } = buildEntry(req.body);
  if (error) return res.status(400).json({ message: error });
  const linked = await linkProducts(data.items, req.user);
  if (linked.error) return res.status(400).json({ message: linked.error });
  const archiveNo = formatArchiveNo(prefix, await nextSequence(counter));
  const entry = await SalesEntry.create({ ...data, archiveNo, createdBy: req.user._id });
  res.status(201).json({ ...entry.toObject(), createdProducts: linked.created });
});

// Corrects a saved entry (Admin). The invoice number stays the same.
router.put("/:id", requireRole("admin"), async (req, res) => {
  const entry = await findEntry(req, res);
  if (!entry) return;
  // Conflicting edits: refuse if someone saved this entry after it was opened.
  if (req.body.expectedUpdatedAt && new Date(req.body.expectedUpdatedAt).getTime() !== entry.updatedAt.getTime()) {
    return res.status(409).json({ message: `${entry.archiveNo} was changed by another user while you were editing. Reload it to see the latest values, then make your change again.` });
  }
  const { error, data } = buildEntry(req.body);
  if (error) return res.status(400).json({ message: error });
  const linked = await linkProducts(data.items, req.user);
  if (linked.error) return res.status(400).json({ message: linked.error });
  entry.set({ ...data, editedAt: new Date(), editedBy: req.user._id });
  await entry.save();
  const saved = await SalesEntry.findById(entry._id).populate("createdBy", "username").populate("editedBy", "username");
  res.json({ ...saved.toObject(), createdProducts: linked.created });
});

export default router;
