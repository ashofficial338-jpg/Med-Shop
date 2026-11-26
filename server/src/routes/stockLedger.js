import { Router } from "express";
import StockLedger from "../models/StockLedger.js";
import Product from "../models/Product.js";
import Batch from "../models/Batch.js";
import { effectiveLocations } from "../utils/locations.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { upsertBatch } from "../utils/batchHelpers.js";
import { cleanRack, rackPositionError } from "../utils/rack.js";
import { streamExcelReport, streamPdfReport, formatDateTime, shopDay, todayStamp, periodLabel } from "../utils/reportExport.js";
import { transactional } from "../utils/transaction.js";
import Purchase from "../models/Purchase.js";
import { dayRange } from "../utils/queryFilters.js";

const router = Router();
router.use(requireAuth, requireRole("admin"));

router.get("/", async (req, res) => {
  const { product, type } = req.query;
  const filter = {};
  if (product) filter.product = product;
  if (type) filter.type = type;

  const entries = await StockLedger.find(filter)
    .populate("product", "name productCode")
    .populate("batch", "batchNo expiryDate")
    .populate("performedBy", "username")
    .sort({ createdAt: -1 })
    .limit(200);
  res.json(entries);
});

// Full history (the on-screen list stops at the latest 200), with the same
// product/type filters as the list.
router.get("/export", async (req, res) => {
  const { product, type, format } = req.query;
  const filter = {};
  if (product) filter.product = product;
  if (type) filter.type = type;

  const entries = await StockLedger.find(filter)
    .populate("product", "name productCode")
    .populate("batch", "batchNo")
    .populate("performedBy", "username")
    .sort({ createdAt: -1 })
    .lean();
  const rows = entries.map((e) => ({
    date: formatDateTime(e.createdAt),
    product: e.product?.name || "",
    productCode: e.product?.productCode || "",
    batchNo: e.batch?.batchNo || "",
    type: e.type,
    qtyChange: e.qtyChange,
    qtyDisplay: e.qtyChange > 0 ? `+${e.qtyChange}` : String(e.qtyChange),
    reason: e.reason || "",
    costImpact: e.costImpact ?? "",
    performedBy: e.performedBy?.username || "",
  }));
  const subtitle = type ? `Type: ${type}` : "All movement types";

  if (format === "pdf") {
    return streamPdfReport(res, "GuganMedicals_Stock_Ledger.pdf", {
      title: "Gugan Medicals - Stock Ledger",
      subtitle,
      columns: [
        { header: "Date", key: "date", flex: 1.2 },
        { header: "Product", key: "product", flex: 1.8 },
        { header: "Code", key: "productCode" },
        { header: "Batch", key: "batchNo" },
        { header: "Type", key: "type" },
        { header: "Qty", key: "qtyDisplay", align: "right", flex: 0.6 },
        { header: "Reason", key: "reason", flex: 1.8 },
        { header: "By", key: "performedBy" },
      ],
      rows,
    });
  }

  return streamExcelReport(res, "GuganMedicals_Stock_Ledger.xlsx", [
    {
      name: "Stock Ledger",
      columns: [
        { header: "Date", key: "date", width: 18 },
        { header: "Product", key: "product", width: 28 },
        { header: "Code", key: "productCode", width: 12 },
        { header: "Batch", key: "batchNo", width: 14 },
        { header: "Type", key: "type", width: 16 },
        { header: "Qty Change", key: "qtyChange", width: 12 },
        { header: "Reason", key: "reason", width: 32 },
        { header: "Cost Impact", key: "costImpact", width: 14 },
        { header: "Performed By", key: "performedBy", width: 16 },
      ],
      rows,
    },
  ]);
});

router.post("/adjust", transactional(async (req, res) => {
  const { product: productId, adjustmentType, qty, reason, batchId, batchNo, expiryDate, costPrice } = req.body;
  const rack = cleanRack(req.body.rack);
  // "No Rack" is an explicit choice (sent as NONE); a blank field is not.
  const rackGiven = String(req.body.rack ?? "").trim() !== "";

  if (!productId) return res.status(400).json({ message: "Choose the product to adjust." });
  if (!["add", "reduce"].includes(adjustmentType)) {
    return res.status(400).json({ message: "Choose add or reduce." });
  }
  const quantity = Number(qty);
  if (!(quantity > 0)) return res.status(400).json({ message: "Please enter a valid number." });
  // Reason, rack, batch no, expiry and cost are optional; product, type,
  // quantity (and for a reduction, which batch) are what the adjustment is.
  if (adjustmentType === "add") {
    const rackError = await rackPositionError(req.body.rack, { required: false });
    if (rackError) return res.status(400).json({ message: rackError });
  }

  const product = await Product.findById(productId);
  if (!product) return res.status(404).json({ message: "No records found." });

  let batch;
  let ledgerRack = rack;

  if (adjustmentType === "reduce") {
    // Admin picks exactly which lot this came from - breakage/spoilage found
    // on the shelf is almost always traceable to one specific pack.
    if (!batchId) return res.status(400).json({ message: "Choose which batch to reduce." });
    batch = await Batch.findOne({ _id: batchId, product: product._id });
    if (!batch) return res.status(404).json({ message: "No records found." });
    if (quantity > batch.qtyRemaining) {
      return res.status(400).json({ message: "Cannot reduce below available stock." });
    }
    // Optionally from one exact rack position; otherwise the primary rack first.
    const locs = effectiveLocations(batch);
    if (req.body.fromRack !== undefined && req.body.fromRack !== null && req.body.fromRack !== "") {
      const from = cleanRack(req.body.fromRack);
      const loc = locs.find((l) => l.rack === from);
      if (!loc || loc.qty < quantity) return res.status(400).json({ message: `Only ${loc?.qty || 0} on ${from || "No Rack"} in this batch.` });
      loc.qty -= quantity;
      ledgerRack = from;
    } else {
      ledgerRack = locs[0]?.rack ?? "";
    }
    batch.qtyRemaining -= quantity;
    batch.locations = locs.filter((l) => l.qty > 0);
    await batch.save();
    product.qty -= quantity;
  } else {
    if (batchId) {
      batch = await Batch.findOne({ _id: batchId, product: product._id });
      if (!batch) return res.status(404).json({ message: "No records found." });
      batch.qtyReceived += quantity;
      batch.qtyRemaining += quantity;
      if (rackGiven) batch.rack = rack;
      await batch.save();
    } else {
      batch = await upsertBatch({
        product,
        batchNo: String(batchNo || "").trim() || `ADJ-${Date.now().toString(36).toUpperCase()}`,
        expiryDate: expiryDate || null,
        costPrice: Number(costPrice) || 0,
        addQty: quantity,
        receivedAt: new Date(),
        rack: rackGiven ? rack : product.rack || "",
      });
    }
    product.qty += quantity;
    // The rack is optional here: left blank, the product keeps its current
    // position instead of being moved to No Rack.
    if (rackGiven) product.rack = rack;
    else ledgerRack = batch.rack || "";
  }

  await product.save();

  const entry = await StockLedger.create({
    product: product._id,
    batch: batch._id,
    type: adjustmentType === "add" ? "manual-add" : "manual-reduce",
    qtyChange: adjustmentType === "add" ? quantity : -quantity,
    rack: ledgerRack,
    reason: String(reason || "").trim() || (adjustmentType === "add" ? "Stock added" : "Stock reduced"),
    performedBy: req.user._id,
  });

  res.status(201).json({ product, entry });
}));

// ---------- Extra Stock Addition ----------
// Stock added by hand, outside the purchase process: opening balance, a
// correction, stock found on the shelf, free goods. It only touches the
// product, its batch and this ledger - never a purchase, supplier, invoice or
// payment - and every entry is kept as its own history (type "extra-stock").

const EXTRA_STOCK_REASONS = ["Opening Balance", "Stock Correction", "Found Stock", "Free Items", "Adjustment", "Other"];

const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) && !Number.isNaN(new Date(v).getTime());

router.post("/extra", transactional(async (req, res) => {
  const { product: productId, qty, date, reason, remarks, batchId, batchNo, expiryDate, costPrice } = req.body;
  const rackGiven = String(req.body.rack ?? "").trim() !== "";
  const rack = cleanRack(req.body.rack);

  if (!productId) return res.status(400).json({ message: "Choose the item to add stock to." });
  const quantity = Number(qty);
  if (!(quantity > 0) || !Number.isInteger(quantity)) return res.status(400).json({ message: "Enter a whole quantity greater than 0." });
  if (!isDay(date)) return res.status(400).json({ message: "Choose the stock addition date." });
  if (date > todayStamp()) return res.status(400).json({ message: "The stock addition date can't be in the future." });
  const cleanReason = String(reason || "").trim();
  if (!EXTRA_STOCK_REASONS.includes(cleanReason)) return res.status(400).json({ message: "Choose a reason for the extra stock." });
  const cleanRemarks = String(remarks || "").trim().slice(0, 500);
  if (cleanReason === "Other" && !cleanRemarks) return res.status(400).json({ message: "Add a remark explaining the reason." });
  const rackError = await rackPositionError(req.body.rack, { required: false });
  if (rackError) return res.status(400).json({ message: rackError });

  const product = await Product.findById(productId);
  if (!product) return res.status(404).json({ message: "No records found." });

  const entryDate = new Date(date); // UTC midnight: the same calendar day in India
  let batch;
  const existing = batchId
    ? await Batch.findOne({ _id: batchId, product: product._id })
    : String(batchNo || "").trim()
      ? await Batch.findOne({ product: product._id, batchNo: String(batchNo).trim() })
      : null;
  if (batchId && !existing) return res.status(404).json({ message: "No records found." });

  if (existing) {
    // Top up the lot as it is: its cost stays what was paid for it.
    batch = existing;
    const locs = effectiveLocations(batch);
    const target = rackGiven ? rack : batch.rack || "";
    const loc = locs.find((l) => l.rack === target);
    if (loc) loc.qty += quantity;
    else locs.push({ rack: target, qty: quantity });
    batch.qtyReceived += quantity;
    batch.qtyRemaining += quantity;
    batch.locations = locs;
    batch.isDeleted = false;
    await batch.save();
  } else {
    // A new lot. Without a cost, value it like the item's latest lot (free
    // items can say 0 explicitly).
    let cost = Number(costPrice);
    if (costPrice === undefined || costPrice === null || costPrice === "" || !(cost >= 0)) {
      const last = await Batch.findOne({ product: product._id }).sort({ receivedAt: -1 }).select("costPrice").lean();
      cost = last?.costPrice || 0;
    }
    batch = await upsertBatch({
      product,
      batchNo: String(batchNo || "").trim() || `EXT-${Date.now().toString(36).toUpperCase()}`,
      expiryDate: expiryDate || null,
      costPrice: cost,
      addQty: quantity,
      receivedAt: entryDate,
      rack: rackGiven ? rack : product.rack || "",
    });
  }

  product.qty += quantity;
  if (rackGiven) product.rack = rack;
  await product.save();

  const entry = await StockLedger.create({
    product: product._id,
    batch: batch._id,
    type: "extra-stock",
    qtyChange: quantity,
    rack: rackGiven ? rack : batch.rack || "",
    reason: cleanReason,
    remarks: cleanRemarks,
    entryDate,
    performedBy: req.user._id,
  });

  res.status(201).json({ product, entry });
}));

function extraFilter({ from, to, product, reason }) {
  const filter = { type: "extra-stock" };
  const range = dayRange(from, to);
  if (range) filter.entryDate = range;
  if (product) filter.product = product;
  if (reason) filter.reason = reason;
  return filter;
}

const extraRow = (e) => ({
  id: String(e._id),
  date: shopDay(e.entryDate || e.createdAt),
  product: e.product?.name || "",
  productCode: e.product?.productCode || "",
  batchNo: e.batch?.batchNo || "",
  qty: e.qtyChange,
  reason: e.reason || "",
  remarks: e.remarks || "",
  rack: e.rack || "",
  user: e.performedBy?.username || "",
  recordedAt: formatDateTime(e.createdAt),
});

async function extraRows(query) {
  const entries = await StockLedger.find(extraFilter(query))
    .populate("product", "name productCode")
    .populate("batch", "batchNo")
    .populate("performedBy", "username")
    .sort({ entryDate: -1, createdAt: -1 })
    .lean();
  return entries.map(extraRow);
}

router.get("/extra", async (req, res) => {
  const rows = await extraRows(req.query);
  res.json({ reasons: EXTRA_STOCK_REASONS, rows, totalQty: rows.reduce((s, r) => s + r.qty, 0) });
});

router.get("/extra/export", async (req, res) => {
  const rows = await extraRows(req.query);
  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const subtitle = [periodLabel(req.query.from, req.query.to), req.query.reason ? `Reason: ${req.query.reason}` : ""].filter(Boolean).join(" · ");
  if (req.query.format === "pdf") {
    return streamPdfReport(res, "GuganMedicals_Extra_Stock_Additions.pdf", {
      title: "Gugan Medicals - Extra Stock Additions",
      subtitle,
      columns: [
        { header: "Date", key: "date" },
        { header: "Item", key: "product", flex: 1.8 },
        { header: "Batch", key: "batchNo" },
        { header: "Qty", key: "qty", align: "right", flex: 0.6 },
        { header: "Reason", key: "reason", flex: 1.2 },
        { header: "Remarks", key: "remarks", flex: 1.8 },
        { header: "By", key: "user" },
      ],
      rows,
      summaryLines: [`Total quantity added: ${totalQty}`],
    });
  }
  return streamExcelReport(res, "GuganMedicals_Extra_Stock_Additions.xlsx", [
    {
      name: "Extra Stock Additions",
      columns: [
        { header: "Date", key: "date", width: 12 },
        { header: "Item", key: "product", width: 28 },
        { header: "Code", key: "productCode", width: 12 },
        { header: "Batch", key: "batchNo", width: 14 },
        { header: "Qty Added", key: "qty", width: 11 },
        { header: "Reason", key: "reason", width: 18 },
        { header: "Remarks", key: "remarks", width: 32 },
        { header: "Rack", key: "rack", width: 10 },
        { header: "Added By", key: "user", width: 14 },
        { header: "Recorded At", key: "recordedAt", width: 18 },
      ],
      rows,
    },
  ]);
});

// ---------- Stock Inward report: Purchase Inward vs Extra Stock ----------
// Purchase inward comes from each purchase's own stock entries (so later
// edits are netted in) dated by the purchase date; deleted purchases drop out.

async function inwardReport(query) {
  const purchaseFilter = {};
  const range = dayRange(query.from, query.to);
  if (range) purchaseFilter.date = range;
  if (query.product) purchaseFilter["items.product"] = query.product;
  const purchases = await Purchase.find(purchaseFilter).select("invoiceNo date vendor supplierName").populate("vendor", "name").lean();
  const byId = new Map(purchases.map((p) => [String(p._id), p]));

  const ledgerFilter = { type: { $in: ["purchase", "purchase-edit"] }, refId: { $in: purchases.map((p) => p._id) } };
  if (query.product) ledgerFilter.product = query.product;
  const entries = await StockLedger.find(ledgerFilter).populate("product", "name productCode").populate("batch", "batchNo").populate("performedBy", "username").sort({ createdAt: 1 }).lean();

  const lines = new Map();
  for (const e of entries) {
    const key = `${e.refId}|${e.product?._id}|${e.batch?._id}`;
    const line = lines.get(key);
    if (line) line.qty += e.qtyChange;
    else {
      const p = byId.get(String(e.refId));
      lines.set(key, {
        id: key,
        date: shopDay(p.date),
        invoiceNo: p.invoiceNo,
        supplier: p.vendor?.name || p.supplierName || "Direct purchase",
        product: e.product?.name || "",
        productCode: e.product?.productCode || "",
        batchNo: e.batch?.batchNo || "",
        qty: e.qtyChange,
        user: e.performedBy?.username || "",
      });
    }
  }
  const purchaseRows = [...lines.values()].filter((l) => l.qty !== 0).sort((a, b) => b.date.localeCompare(a.date) || a.invoiceNo.localeCompare(b.invoiceNo));
  const extra = await extraRows({ from: query.from, to: query.to, product: query.product });

  const byReason = EXTRA_STOCK_REASONS.map((reason) => ({ reason, qty: extra.filter((r) => r.reason === reason).reduce((s, r) => s + r.qty, 0), count: extra.filter((r) => r.reason === reason).length })).filter((r) => r.count);
  const purchaseQty = purchaseRows.reduce((s, r) => s + r.qty, 0);
  const extraQty = extra.reduce((s, r) => s + r.qty, 0);
  return {
    purchase: { rows: purchaseRows, totalQty: purchaseQty, invoices: new Set(purchaseRows.map((r) => r.invoiceNo)).size },
    extra: { rows: extra, totalQty: extraQty, byReason },
    totalQty: purchaseQty + extraQty,
  };
}

router.get("/inward-report", async (req, res) => {
  res.json(await inwardReport(req.query));
});

router.get("/inward-report/export", async (req, res) => {
  const r = await inwardReport(req.query);
  const subtitle = periodLabel(req.query.from, req.query.to);
  const summaryLines = [
    `Purchase inward: ${r.purchase.totalQty} (${r.purchase.rows.length} lines, ${r.purchase.invoices} invoices)`,
    `Extra stock additions: ${r.extra.totalQty} (${r.extra.rows.length} entries)`,
    ...r.extra.byReason.map((b) => `  ${b.reason}: ${b.qty}`),
    `Total stock in: ${r.totalQty}`,
  ];
  if (req.query.format === "pdf") {
    const rows = [
      ...r.purchase.rows.map((p) => ({ source: "Purchase", date: p.date, product: p.product, batchNo: p.batchNo, qty: p.qty, detail: `${p.invoiceNo} · ${p.supplier}`, user: p.user })),
      ...r.extra.rows.map((e) => ({ source: "Extra stock", date: e.date, product: e.product, batchNo: e.batchNo, qty: e.qty, detail: [e.reason, e.remarks].filter(Boolean).join(" · "), user: e.user })),
    ];
    return streamPdfReport(res, "GuganMedicals_Stock_Inward.pdf", {
      title: "Gugan Medicals - Stock Inward (Purchase vs Extra Stock)",
      subtitle,
      columns: [
        { header: "Source", key: "source" },
        { header: "Date", key: "date" },
        { header: "Item", key: "product", flex: 1.8 },
        { header: "Batch", key: "batchNo" },
        { header: "Qty", key: "qty", align: "right", flex: 0.6 },
        { header: "Invoice / Reason", key: "detail", flex: 2 },
        { header: "By", key: "user" },
      ],
      rows,
      summaryLines,
    });
  }
  return streamExcelReport(res, "GuganMedicals_Stock_Inward.xlsx", [
    {
      name: "Summary",
      columns: [
        { header: "Source", key: "source", width: 26 },
        { header: "Entries", key: "count", width: 10 },
        { header: "Quantity", key: "qty", width: 12 },
      ],
      rows: [
        { source: "Purchase Inward", count: r.purchase.rows.length, qty: r.purchase.totalQty },
        { source: "Extra Stock Additions", count: r.extra.rows.length, qty: r.extra.totalQty },
        ...r.extra.byReason.map((b) => ({ source: `  ${b.reason}`, count: b.count, qty: b.qty })),
        { source: "Total Stock In", count: r.purchase.rows.length + r.extra.rows.length, qty: r.totalQty },
      ],
    },
    {
      name: "Purchase Inward",
      columns: [
        { header: "Date", key: "date", width: 12 },
        { header: "Invoice No", key: "invoiceNo", width: 16 },
        { header: "Supplier", key: "supplier", width: 24 },
        { header: "Item", key: "product", width: 28 },
        { header: "Code", key: "productCode", width: 12 },
        { header: "Batch", key: "batchNo", width: 14 },
        { header: "Qty In", key: "qty", width: 10 },
        { header: "Entered By", key: "user", width: 14 },
      ],
      rows: r.purchase.rows,
    },
    {
      name: "Extra Stock Additions",
      columns: [
        { header: "Date", key: "date", width: 12 },
        { header: "Item", key: "product", width: 28 },
        { header: "Code", key: "productCode", width: 12 },
        { header: "Batch", key: "batchNo", width: 14 },
        { header: "Qty Added", key: "qty", width: 11 },
        { header: "Reason", key: "reason", width: 18 },
        { header: "Remarks", key: "remarks", width: 32 },
        { header: "Added By", key: "user", width: 14 },
      ],
      rows: r.extra.rows,
    },
  ]);
});

export default router;
