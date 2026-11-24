import { Router } from "express";
import StockLedger from "../models/StockLedger.js";
import Product from "../models/Product.js";
import Batch from "../models/Batch.js";
import { effectiveLocations } from "../utils/locations.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { upsertBatch } from "../utils/batchHelpers.js";
import { cleanRack, rackPositionError } from "../utils/rack.js";
import { streamExcelReport, streamPdfReport, formatDateTime } from "../utils/reportExport.js";
import { transactional } from "../utils/transaction.js";

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

export default router;
