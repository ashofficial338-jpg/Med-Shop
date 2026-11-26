import { Router } from "express";
import mongoose from "mongoose";
import Product from "../models/Product.js";
import Purchase from "../models/Purchase.js";
import Vendor from "../models/Vendor.js";
import ExtraImport from "../models/ExtraImport.js";
import IncompletePurchase from "../models/IncompletePurchase.js";
import { nextSequence } from "../models/Counter.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { normalizeName } from "../utils/productAutoCreate.js";
import { partyKey } from "../utils/parties.js";
import { mapHeaders, rowFields, text, num, parseDate, todayIso, streamTemplate } from "../utils/excelImport.js";
import { streamPdfReport, formatDateTime } from "../utils/reportExport.js";
import { savePurchase } from "./purchases.js";

// Extra Purchase - flexible Excel upload. Every column is optional:
//
//   template -> fill anything -> upload -> preview (edit) -> confirm import
//
// A row that names an item (by code or name) and a whole quantity becomes a
// line on a purchase - saved through the normal Purchase save, so stock,
// batches, the stock ledger, supplier and every report update exactly as for
// a hand-entered purchase. Rows of the same supplier + invoice number (or the
// same supplier + date when there's no number) form one purchase. A row
// without enough to identify an item and a quantity is kept as an Incomplete
// Purchase record - no stock change - to be completed or discarded later.
// Only values that were actually entered and are wrong produce warnings; a
// blank is never an error, and one bad row never stops the rest.

const router = Router();
router.use(requireAuth, requireRole("admin"));

const GST_SLABS = [0, 5, 12, 18, 28];
const MAX_ROWS = 5000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const r2 = (n) => Number(Number(n || 0).toFixed(2));
const FIELDS = ["date", "supplier", "invoiceNo", "itemCode", "itemName", "category", "qty", "unit", "rate", "discount", "gst", "total", "remarks"];

const ALIASES = {
  date: ["purchasedate", "date", "invoicedate", "billdate", "invdate"],
  supplier: ["suppliername", "supplier", "vendor", "vendorname", "distributor", "party", "partyname"],
  invoiceNo: ["supplierinvoicenumber", "supplierinvoiceno", "invoicenumber", "invoiceno", "invoice", "billno", "billnumber", "invno"],
  itemCode: ["itemcode", "productcode", "code", "sku", "barcode"],
  itemName: ["itemname", "productname", "item", "product", "medicine", "medicinename", "name", "description"],
  category: ["category", "itemcategory", "productcategory"],
  qty: ["quantity", "qty", "qtypacks", "packs"],
  unit: ["unit", "packunit", "uom", "pack"],
  rate: ["purchaserate", "rate", "costprice", "cost", "purchaseprice", "ptr"],
  discount: ["discount", "discountpercent", "disc", "discpercent"],
  gst: ["gst", "gstpercent", "gstrate", "tax", "taxpercent"],
  total: ["totalamount", "total", "amount", "netamount", "linetotal", "value"],
  remarks: ["remarks", "remark", "notes", "note", "comments", "comment"],
};

// ---------- template ----------

router.get("/template", async (req, res) => {
  await streamTemplate(res, "GuganMedicals_Extra_Purchase_Template.xlsx", {
    sheetName: "Extra Purchases",
    columns: [
      { header: "Purchase Date", key: "date", width: 14, date: true, note: "Optional. DD-MM-YYYY." },
      { header: "Supplier Name", key: "supplier", width: 24, note: "Optional. Blank = purchase without a supplier." },
      { header: "Supplier Invoice Number", key: "invoiceNo", width: 22, note: "Optional. Rows with the same supplier and invoice number become one purchase." },
      { header: "Item Code", key: "itemCode", width: 12, note: "Optional. Matches an existing item by its code." },
      { header: "Item Name", key: "itemName", width: 26, note: "Optional. Matches an existing item by name, or adds a new item." },
      { header: "Category", key: "category", width: 16, note: "Optional. Used for a new item." },
      { header: "Quantity", key: "qty", width: 10, note: "Optional. Whole packs. Without an item and a quantity the row is kept as an incomplete record (no stock change)." },
      { header: "Unit", key: "unit", width: 10, note: "Optional. Strip, Bottle, Box... (for a new item)." },
      { header: "Purchase Rate", key: "rate", width: 14, note: "Optional. Per pack, before discount and GST." },
      { header: "Discount", key: "discount", width: 10, note: "Optional. Percent, e.g. 5 = 5%. Blank = 0." },
      { header: "GST %", key: "gst", width: 8, note: "Optional. Blank = 0." },
      { header: "Total Amount", key: "total", width: 14, note: "Optional. If the rate is blank, the rate is worked out from this." },
      { header: "Remarks", key: "remarks", width: 28, note: "Optional." },
    ],
    samples: [
      { date: "20-11-2026", supplier: "Sri Balaji Pharma", invoiceNo: "SB-5521", itemCode: "", itemName: "Dolo 650", category: "Tablets", qty: 20, unit: "Strip", rate: 22.5, discount: 5, gst: 12, total: "", remarks: "Monthly stock" },
      { date: "20-11-2026", supplier: "Sri Balaji Pharma", invoiceNo: "SB-5521", itemName: "Cough Syrup", qty: 10, unit: "Bottle", gst: 5, total: 630 },
      { itemName: "Hand Sanitizer" },
      { supplier: "Local market", total: 450, remarks: "Bill to be checked" },
    ],
    instructions: [
      "Extra Purchase upload - every column is optional",
      "Fill whatever you have. Blank cells are fine and are never shown as errors.",
      "A row with an item (code or name) and a quantity is imported as a purchase line and adds stock.",
      "A row without an item or quantity is saved as an Incomplete record - no stock change - and can be completed later on the Extra Purchases page.",
      "Rows with the same Supplier Name and Supplier Invoice Number become one purchase. Without an invoice number, rows of the same supplier and date go together.",
      "You can check and edit every row in the preview before anything is saved.",
      "The Example sheet is not uploaded.",
    ],
  });
});

// ---------- reading and checking rows ----------

// Raw Excel rows ({ row, cells }) -> plain editable rows (strings as entered).
function fromCells(raw) {
  const headers = [...new Set(raw.flatMap((r) => Object.keys(r.cells || {})))];
  const { fieldByHeader } = mapHeaders(headers, ALIASES);
  return raw.map((r) => {
    const f = rowFields(r.cells, fieldByHeader);
    const out = { row: Number(r.row) || 0 };
    for (const k of FIELDS) out[k] = f[k] === undefined ? "" : String(f[k]);
    return out;
  });
}

const cleanRow = (r, i) => {
  const out = { row: Number(r?.row) || i + 2 };
  for (const k of FIELDS) out[k] = text(r?.[k]).slice(0, 300);
  if (r?.productId && mongoose.isValidObjectId(r.productId)) out.productId = String(r.productId);
  return out;
};

async function lookups() {
  const [products, vendors] = await Promise.all([
    Product.find({ isActive: true }, "name productCode gstPercent packUnit").lean(),
    Vendor.find({}, "name").lean(),
  ]);
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const byCode = new Map(products.filter((p) => p.productCode).map((p) => [String(p.productCode).toLowerCase(), p]));
  const byName = new Map(products.map((p) => [normalizeName(p.name), p]));
  const vendorByKey = new Map(vendors.map((v) => [partyKey(v.name), v]));
  return { byId, byCode, byName, vendorByKey };
}

// Works out what each row is: ready to import, incomplete, a duplicate of an
// invoice already recorded, or empty. Warnings only for entered values that
// are wrong; blanks are fine.
async function analyze(rows) {
  const L = await lookups();
  const today = todayIso();
  const out = rows.map((r) => {
    const warnings = [];
    const a = { ...r, warnings, status: "ready", missing: [] };
    if (FIELDS.every((k) => !r[k])) return { ...a, status: "empty" };

    // Date
    a.dateIso = "";
    if (r.date) {
      const d = parseDate(r.date);
      if (!d) warnings.push(`Purchase Date "${r.date}" isn't a date - the import date will be used.`);
      else {
        a.dateIso = d;
        if (d > today) warnings.push("Purchase Date is in the future.");
      }
    }

    // Numbers: entered but wrong -> warning, treated as blank.
    const number = (v, label, ok, fix) => {
      if (!v) return null;
      const n = num(v);
      if (n === undefined) return null;
      if (Number.isNaN(n) || !ok(n)) {
        warnings.push(`${label} "${v}" ${fix}`);
        return null;
      }
      return n;
    };
    a.qtyN = number(r.qty, "Quantity", (n) => n > 0 && Number.isInteger(n), "must be a whole number above 0.");
    a.rateN = number(r.rate, "Purchase Rate", (n) => n >= 0, "isn't a valid amount.");
    a.discountN = number(r.discount, "Discount", (n) => n >= 0 && n <= 100, "must be a percent from 0 to 100.") ?? 0;
    let gst = number(r.gst, "GST %", (n) => n >= 0 && n <= 100, "isn't a valid percent.");
    a.totalN = number(r.total, "Total Amount", (n) => n >= 0, "isn't a valid amount.");

    // Item: picked in the preview, else by code, else by name, else a new item.
    let product = r.productId ? L.byId.get(r.productId) : null;
    a.match = product ? "chosen" : null;
    if (!product && r.itemCode) {
      product = L.byCode.get(r.itemCode.toLowerCase()) || null;
      if (product) a.match = "code";
      else warnings.push(`Item Code "${r.itemCode}" isn't in the item list${r.itemName ? " - matched by name instead" : ""}.`);
    }
    if (!product && r.itemName) {
      product = L.byName.get(normalizeName(r.itemName)) || null;
      a.match = product ? "name" : normalizeName(r.itemName) ? "new" : null;
    }
    a.product = product ? { _id: product._id, name: product.name, productCode: product.productCode, gstPercent: product.gstPercent } : null;

    // GST: an existing item keeps its saved rate; a new item takes the entered slab.
    if (product) {
      if (gst !== null && gst !== product.gstPercent) warnings.push(`GST ${gst}% differs from the item's saved ${product.gstPercent}% - the saved rate is used.`);
      gst = product.gstPercent || 0;
    } else if (gst !== null && !GST_SLABS.includes(gst)) {
      if (a.match === "new") warnings.push(`GST ${gst}% isn't a GST slab (0, 5, 12, 18, 28) - 0% is used for the new item.`);
      gst = a.match === "new" ? 0 : gst;
    }
    a.gstN = gst ?? 0;

    // Rate from the total when only the total was given.
    const kept = 1 - a.discountN / 100;
    if (a.rateN === null && a.totalN !== null && a.qtyN && kept > 0) {
      a.rateN = r2(a.totalN / (a.qtyN * kept * (1 + a.gstN / 100)));
      a.rateFromTotal = true;
    }
    const amount = a.qtyN && a.rateN !== null ? r2(a.qtyN * a.rateN * (1 - a.discountN / 100) * (1 + a.gstN / 100)) : null;
    a.amount = amount ?? a.totalN;
    if (amount !== null && a.totalN !== null && !a.rateFromTotal && Math.abs(amount - a.totalN) > 1) {
      warnings.push(`Total Amount ${a.totalN} differs from Quantity x Rate (${amount}); the purchase is saved at ${amount}.`);
    }

    if (!product && a.match !== "new") a.missing.push("item");
    if (!a.qtyN) a.missing.push("quantity");
    if (a.missing.length) a.status = "incomplete";
    return a;
  });

  // Group the ready rows into purchases; skip invoices already recorded.
  const groups = new Map();
  for (const a of out) {
    if (a.status !== "ready") continue;
    const sKey = partyKey(a.supplier);
    const key = a.invoiceNo ? `${sKey}|#${a.invoiceNo.toLowerCase()}` : `${sKey}|@${a.dateIso || today}`;
    if (!groups.has(key)) groups.set(key, { key, supplier: a.supplier, invoiceNo: a.invoiceNo, date: a.dateIso || today, rows: [] });
    groups.get(key).rows.push(a);
    a.group = key;
  }
  const numbered = [...groups.values()].filter((g) => g.invoiceNo);
  if (numbered.length) {
    const recorded = await Purchase.find({ invoiceNo: { $in: numbered.map((g) => g.invoiceNo) } }, "vendor invoiceNo piNo").lean();
    for (const g of numbered) {
      const vendor = g.supplier ? L.vendorByKey.get(partyKey(g.supplier)) : null;
      const hit = recorded.find((p) => p.invoiceNo.toLowerCase() === g.invoiceNo.toLowerCase() && String(p.vendor || "") === String(vendor?._id || ""));
      if (!hit) continue;
      g.duplicate = hit.piNo || hit.invoiceNo;
      for (const a of g.rows) {
        a.status = "duplicate";
        a.warnings.push(`Invoice ${g.invoiceNo} is already recorded (${g.duplicate}) - skipped so it isn't added twice.`);
      }
    }
  }
  const live = out.filter((a) => a.status !== "empty");
  return {
    rows: live,
    groups: [...groups.values()].filter((g) => !g.duplicate).map((g) => ({ key: g.key, supplier: g.supplier, invoiceNo: g.invoiceNo, date: g.date, rows: g.rows.map((a) => a.row), total: r2(g.rows.reduce((s, a) => s + (a.amount || 0), 0)) })),
    summary: {
      rows: live.length,
      ready: live.filter((a) => a.status === "ready").length,
      incomplete: live.filter((a) => a.status === "incomplete").length,
      duplicate: live.filter((a) => a.status === "duplicate").length,
      warnings: live.reduce((s, a) => s + a.warnings.length, 0),
      items: new Set(live.filter((a) => a.status === "ready").map((a) => (a.product ? String(a.product._id) : `new:${normalizeName(a.itemName)}`))).size,
      qty: live.filter((a) => a.status === "ready").reduce((s, a) => s + a.qtyN, 0),
      value: r2(live.reduce((s, a) => s + (a.status === "duplicate" ? 0 : a.amount || 0), 0)),
    },
  };
}

function readBody(req) {
  if (Array.isArray(req.body?.raw)) return fromCells(req.body.raw).map(cleanRow);
  if (Array.isArray(req.body?.rows)) return req.body.rows.map(cleanRow);
  return null;
}

// Check the rows - nothing is saved.
router.post("/preview", async (req, res) => {
  const rows = readBody(req);
  if (!rows) return res.status(400).json({ message: "Choose an Excel file to upload." });
  if (rows.length > MAX_ROWS) return res.status(400).json({ message: `The file has ${rows.length} rows; upload at most ${MAX_ROWS} at a time.` });
  res.json(await analyze(rows));
});

// ---------- import ----------

const lineOf = (a) => ({
  ...(a.product ? { product: a.product._id } : { newProduct: { name: a.itemName.slice(0, 150), gstPercent: a.gstN, packUnit: a.unit || undefined, category: a.category || undefined } }),
  qtyPacks: a.qtyN,
  costPrice: a.rateN ?? 0,
  discountPercent: a.discountN,
  remarks: a.remarks || undefined,
});

// Saves one purchase through the normal Purchase save (its own transaction).
async function savePurchaseFor(req, extraImport, body) {
  const held = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await savePurchase({ body, user: req.user, extraImport }, held);
  if (held.code >= 400) throw new Error(held.body?.message || "Could not be saved.");
  return held.body;
}

const incompleteDoc = (a, importBatch, userId, refNo) => ({
  refNo,
  importBatch,
  row: a.row,
  purchaseDate: a.dateIso || "",
  supplierName: a.supplier,
  invoiceNo: a.invoiceNo,
  itemCode: a.itemCode,
  itemName: a.itemName,
  category: a.category,
  qty: a.qtyN,
  unit: a.unit,
  rate: a.rateN,
  discount: a.discount ? a.discountN : null,
  gst: a.gst ? a.gstN : null,
  totalAmount: a.totalN,
  remarks: a.remarks,
  missing: a.missing.join(" and "),
  createdBy: userId,
});

router.post("/import", async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows.map(cleanRow) : null;
  if (!rows || !rows.length) return res.status(400).json({ message: "There is nothing to import." });
  if (rows.length > MAX_ROWS) return res.status(400).json({ message: `Import at most ${MAX_ROWS} rows at a time.` });
  const clientRef = typeof req.body.clientRef === "string" ? req.body.clientRef.slice(0, 80) : "";
  if (clientRef) {
    const done = await ExtraImport.findOne({ clientRef, status: "Done" });
    if (done) return res.json({ import: done, alreadySaved: true });
  }
  let file = null;
  if (req.body.fileData) {
    file = Buffer.from(String(req.body.fileData), "base64");
    if (file.length > MAX_FILE_BYTES) file = null; // too big to keep; the rows are still imported
  }
  const paymentMode = req.body.paymentMode === "Cash" ? "Cash" : "Credit";

  const checked = await analyze(rows);
  let imp = clientRef ? await ExtraImport.findOne({ clientRef }) : null;
  if (!imp) {
    imp = await ExtraImport.create({
      refNo: `IMP-${String(await nextSequence("extraImportNo")).padStart(6, "0")}`,
      fileName: String(req.body.fileName || "").slice(0, 200),
      fileType: String(req.body.fileType || "").slice(0, 120),
      fileSize: file?.length || 0,
      ...(file ? { file } : {}),
      totalRows: checked.rows.length,
      paymentMode,
      ...(clientRef ? { clientRef } : {}),
      uploadedBy: req.user._id,
    });
  }

  const failures = [];
  const purchases = [];
  let imported = 0;
  let value = 0;
  const byRow = new Map(checked.rows.map((a) => [a.row, a]));
  for (const [i, g] of checked.groups.entries()) {
    const members = g.rows.map((n) => byRow.get(n));
    const body = {
      clientRef: `${imp.refNo}-${i + 1}`,
      invoiceNo: g.invoiceNo,
      date: g.date,
      paymentMode: g.supplier ? paymentMode : "Cash",
      ...(g.supplier ? { supplierName: g.supplier } : {}),
      items: members.map(lineOf),
    };
    try {
      const p = await savePurchaseFor(req, { id: imp._id }, body);
      purchases.push(p._id);
      imported += members.length;
      value += p.total;
    } catch (e) {
      for (const a of members) failures.push({ row: a.row, reason: e.message });
    }
  }
  for (const a of checked.rows.filter((x) => x.status === "duplicate")) failures.push({ row: a.row, reason: a.warnings.at(-1) });

  const incomplete = checked.rows.filter((a) => a.status === "incomplete");
  const have = new Set((await IncompletePurchase.find({ importBatch: imp._id }, "row").lean()).map((d) => d.row));
  for (const a of incomplete) {
    if (have.has(a.row)) continue;
    await IncompletePurchase.create(incompleteDoc(a, imp._id, req.user._id, `INC-${String(await nextSequence("incompletePurchaseNo")).padStart(6, "0")}`));
  }
  value += incomplete.reduce((s, a) => s + (a.amount || 0), 0);

  imp.set({
    importedRows: imported,
    incompleteRows: incomplete.length,
    failedRows: failures.length,
    failures: failures.sort((x, y) => x.row - y.row),
    purchases,
    totalValue: r2(value),
    status: "Done",
  });
  await imp.save();
  const out = imp.toObject();
  delete out.file;
  res.status(201).json({ import: out });
});

// ---------- history ----------

router.get("/history", async (req, res) => {
  const list = await ExtraImport.find({}, "-file -failures").populate("uploadedBy", "username").sort({ createdAt: -1 }).limit(300).lean();
  res.json(list);
});

async function historyDetail(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  const imp = await ExtraImport.findById(id).populate("uploadedBy", "username").lean();
  if (!imp) return null;
  const [purchases, incomplete] = await Promise.all([
    Purchase.find({ importBatch: imp._id }).populate("vendor", "name").populate("items.product", "name productCode").sort({ createdAt: 1 }).lean(),
    IncompletePurchase.find({ importBatch: imp._id }).sort({ row: 1 }).lean(),
  ]);
  return { ...imp, purchases, incomplete };
}

router.get("/history/:id", async (req, res) => {
  const d = await historyDetail(req.params.id);
  if (!d) return res.status(404).json({ message: "No records found." });
  res.json(d);
});

// The original uploaded file.
router.get("/history/:id/file", async (req, res) => {
  const imp = mongoose.isValidObjectId(req.params.id) ? await ExtraImport.findById(req.params.id).select("+file fileName fileType").lean() : null;
  if (!imp) return res.status(404).json({ message: "No records found." });
  if (!imp.file) return res.status(404).json({ message: "The original file wasn't kept (it was larger than 8 MB)." });
  const name = imp.fileName || `${imp.refNo}.xlsx`;
  res.setHeader("Content-Type", imp.fileType || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${name.replace(/[^\w.-]+/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.end(Buffer.from(imp.file.buffer || imp.file));
});

// Everything one upload did, row by row (print / PDF).
router.get("/history/:id/pdf", async (req, res) => {
  const d = await historyDetail(req.params.id);
  if (!d) return res.status(404).json({ message: "No records found." });
  const rows = [];
  for (const p of d.purchases)
    for (const i of p.items)
      rows.push({ status: "Imported", ref: `${p.extraRef || ""} / ${p.piNo || ""}`, party: p.vendor?.name || "No supplier", item: i.product?.name || "", qty: String(i.qtyPacks), amount: r2(i.lineAmount + i.lineGst).toFixed(2), note: [p.invoiceNo, i.remarks].filter(Boolean).join(" · ") });
  for (const x of d.incomplete)
    rows.push({ status: `Incomplete (${x.status})`, ref: x.refNo, party: x.supplierName, item: x.itemName || x.itemCode, qty: x.qty ?? "", amount: x.totalAmount != null ? Number(x.totalAmount).toFixed(2) : "", note: [x.missing && `Missing ${x.missing}`, x.remarks].filter(Boolean).join(" · ") });
  for (const f of d.failures || []) rows.push({ status: "Not imported", ref: `Row ${f.row}`, party: "", item: "", qty: "", amount: "", note: f.reason });
  streamPdfReport(res, `${d.refNo}_Extra_Purchase_Import.pdf`, {
    title: `Gugan Medicals - Extra Purchase Import ${d.refNo}`,
    subtitle: `${d.fileName || "Upload"} · ${formatDateTime(d.createdAt)} · by ${d.uploadedBy?.username || ""}`,
    columns: [
      { header: "Status", key: "status" },
      { header: "Reference", key: "ref", flex: 1.4 },
      { header: "Supplier", key: "party", flex: 1.3 },
      { header: "Item", key: "item", flex: 1.6 },
      { header: "Qty", key: "qty", align: "right", flex: 0.5 },
      { header: "Amount", key: "amount", align: "right", flex: 0.8 },
      { header: "Note", key: "note", flex: 2 },
    ],
    rows,
    summaryLines: [`Rows: ${d.totalRows} · Imported: ${d.importedRows} · Incomplete: ${d.incompleteRows} · Not imported: ${d.failedRows}`, `Total value: Rs. ${Number(d.totalValue || 0).toFixed(2)}`],
  });
});

// ---------- incomplete records ----------

router.get("/incomplete", async (req, res) => {
  const status = ["Open", "Completed", "Discarded"].includes(req.query.status) ? req.query.status : "Open";
  const list = await IncompletePurchase.find({ status }).populate("importBatch", "refNo fileName").populate("purchase", "piNo extraRef").sort({ createdAt: -1 }).limit(1000).lean();
  res.json(list);
});

const asRow = (x) => ({
  row: x.row,
  date: x.purchaseDate || "",
  supplier: x.supplierName || "",
  invoiceNo: x.invoiceNo || "",
  itemCode: x.itemCode || "",
  itemName: x.itemName || "",
  category: x.category || "",
  qty: x.qty ?? "",
  unit: x.unit || "",
  rate: x.rate ?? "",
  discount: x.discount ?? "",
  gst: x.gst ?? "",
  total: x.totalAmount ?? "",
  remarks: x.remarks || "",
});

async function openRecord(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  return IncompletePurchase.findOne({ _id: id, status: "Open" });
}

// Save edits to an incomplete record (still no stock change).
router.put("/incomplete/:id", async (req, res) => {
  const x = await openRecord(req.params.id);
  if (!x) return res.status(404).json({ message: "No open record found." });
  const [a] = (await analyze([cleanRow({ ...req.body, row: x.row }, 0)])).rows;
  if (!a) return res.status(400).json({ message: "Enter at least one detail." });
  const d = incompleteDoc(a, x.importBatch, x.createdBy, x.refNo);
  delete d.createdBy;
  x.set({ ...d, missing: a.missing.join(" and ") });
  await x.save();
  res.json({ record: x, check: a });
});

// Complete it: becomes an Extra Purchase (stock added) and the record closes.
router.post("/incomplete/:id/complete", async (req, res) => {
  const x = await openRecord(req.params.id);
  if (!x) return res.status(404).json({ message: "No open record found." });
  const fields = { ...asRow(x), ...req.body, row: x.row };
  const checked = await analyze([cleanRow(fields, 0)]);
  const a = checked.rows[0];
  if (!a || a.status === "incomplete") return res.status(400).json({ message: `Still missing: ${a ? a.missing.join(" and ") : "item and quantity"}.` });
  if (a.status === "duplicate") return res.status(400).json({ message: a.warnings.at(-1) });
  const paymentMode = req.body.paymentMode === "Cash" ? "Cash" : "Credit";
  let p;
  try {
    p = await savePurchaseFor(req, { id: x.importBatch }, {
      clientRef: `${x.refNo}-done`,
      invoiceNo: a.invoiceNo,
      date: a.dateIso || todayIso(),
      paymentMode: a.supplier ? paymentMode : "Cash",
      ...(a.supplier ? { supplierName: a.supplier } : {}),
      items: [lineOf(a)],
    });
  } catch (e) {
    return res.status(400).json({ message: e.message });
  }
  x.set({ ...incompleteDoc(a, x.importBatch, x.createdBy, x.refNo), missing: "", status: "Completed", purchase: p._id, closedBy: req.user._id, closedAt: new Date() });
  await x.save();
  if (x.importBatch) {
    await ExtraImport.updateOne({ _id: x.importBatch }, { $inc: { importedRows: 1, incompleteRows: -1 }, $addToSet: { purchases: p._id } });
  }
  res.json({ record: x, purchase: p });
});

router.post("/incomplete/:id/discard", async (req, res) => {
  const x = await openRecord(req.params.id);
  if (!x) return res.status(404).json({ message: "No open record found." });
  x.set({ status: "Discarded", closedBy: req.user._id, closedAt: new Date() });
  await x.save();
  res.json({ record: x });
});

export default router;
