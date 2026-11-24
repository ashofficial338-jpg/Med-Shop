import { Router } from "express";
import mongoose from "mongoose";
import Rack from "../models/Rack.js";
import Product from "../models/Product.js";
import Batch from "../models/Batch.js";
import StockLedger from "../models/StockLedger.js";
import StockAudit from "../models/StockAudit.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { requirePermission } from "../utils/permissions.js";
import { positionCode, rackLayout, describePosition, shelfPositions, parseRackCode, cleanRack, rackPositionError } from "../utils/rack.js";
import { effectiveLocations } from "../utils/locations.js";
import { moveBetweenLocations, syncedBatch, refreshProductRack } from "../utils/batchHelpers.js";
import { productSearchFilter } from "../utils/composition.js";
import { streamExcelReport, streamPdfReport } from "../utils/reportExport.js";
import { transactional } from "../utils/transaction.js";

const router = Router();
router.use(requireAuth);
const MAX_POSITIONS = 999;
const DAY = 24 * 60 * 60 * 1000;
const EXPIRY_SOON_DAYS = 90;
const r2 = (n) => Number(n.toFixed(2));

function parsePositions(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= MAX_POSITIONS ? n : null;
}

// Layout fields from a request. A full shelves x rows x bins layout decides
// the position count; otherwise `positions` alone (1 shelf, 1 row) as before.
function layoutFrom(body, current = {}) {
  const num = (v, min, max) => {
    if (v === undefined || v === null || v === "") return undefined;
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
  };
  const shelves = num(body.shelves, 1, 99);
  const rows = num(body.rowsPerShelf, 1, 99);
  const bins = num(body.binsPerRow, 1, MAX_POSITIONS);
  const binCapacity = num(body.binCapacity, 0, 100000);
  if ([shelves, rows, bins, binCapacity].some((v) => Number.isNaN(v))) return { error: "Shelves, rows, bins and bin capacity must be whole numbers in range." };
  const out = {};
  if (body.name !== undefined) out.name = String(body.name || "").trim().slice(0, 60);
  if (binCapacity !== undefined) out.binCapacity = binCapacity;
  if (shelves !== undefined || rows !== undefined || bins !== undefined) {
    const s = shelves ?? current.shelves ?? 1;
    const r = rows ?? current.rowsPerShelf ?? 1;
    const b = bins ?? current.binsPerRow ?? null;
    if (!b) return { error: "Please enter the number of bins per row." };
    if (s * r * b > MAX_POSITIONS) return { error: `A rack can have at most ${MAX_POSITIONS} positions (shelves × rows × bins).` };
    Object.assign(out, { shelves: s, rowsPerShelf: r, binsPerRow: b, positions: s * r * b });
  } else if (body.positions !== undefined) {
    const positions = parsePositions(body.positions);
    if (!positions) return { error: `Number of positions must be between 1 and ${MAX_POSITIONS}.` };
    Object.assign(out, { positions, shelves: 1, rowsPerShelf: 1, binsPerRow: null });
  }
  return { fields: out };
}

function rackJson(rack) {
  const obj = rack.toObject ? rack.toObject() : rack;
  return { ...obj, layout: rackLayout(obj) };
}

async function rackMap() {
  const racks = await Rack.find().sort({ letter: 1 });
  return new Map(racks.map((r) => [r.letter, r]));
}

// What a scope string covers: whole stock (null), No Rack (""), a rack
// letter, a shelf or a single position. `matches(code)` tests a position.
function resolveScope(scopeText, racks) {
  if (scopeText === undefined || scopeText === null || scopeText === "" || scopeText === "ALL") return { level: "all", label: "All racks", matches: () => true };
  const parsed = parseRackCode(scopeText);
  if (!parsed) return null;
  if (parsed.level === "none") return { ...parsed, label: "No Rack", matches: (c) => c === "" };
  const rack = racks.get(parsed.letter);
  if (parsed.level === "rack") return { ...parsed, rackDoc: rack || null, label: `Rack ${parsed.letter}${rack?.name ? ` (${rack.name})` : ""}`, matches: (c) => c.startsWith(`${parsed.letter}-`) };
  if (parsed.level === "shelf") {
    if (!rack) return null;
    const set = new Set(shelfPositions(rack, parsed.shelf));
    return { ...parsed, rackDoc: rack, label: `Rack ${parsed.letter} · Shelf ${parsed.shelf}`, positions: [...set], matches: (c) => set.has(c) };
  }
  return { ...parsed, rackDoc: rack || null, label: describePosition(parsed.code, rack).label, matches: (c) => c === parsed.code };
}

// The scope as a StockLedger rack filter (for history).
function ledgerRackFilter(scope) {
  if (scope.level === "all") return {};
  if (scope.level === "none") return { $or: [{ rack: "" }, { toRack: "" }] };
  if (scope.level === "rack") {
    const re = new RegExp(`^${scope.letter}-`);
    return { $or: [{ rack: re }, { toRack: re }] };
  }
  if (scope.level === "shelf") return { $or: [{ rack: { $in: scope.positions } }, { toRack: { $in: scope.positions } }] };
  return { $or: [{ rack: scope.code }, { toRack: scope.code }] };
}

function unitsLabel(p, units) {
  if (p.soldAs === "pack-and-loose" && p.unitsPerPack) {
    const packs = Math.floor(units / p.unitsPerPack);
    const loose = units % p.unitsPerPack;
    return `${packs} ${p.packUnit}${packs === 1 ? "" : "s"}${loose ? ` + ${loose} ${p.looseUnitName}` : ""}`;
  }
  return `${units} ${p.packUnit}${units === 1 ? "" : "s"}`;
}
const packsOf = (p, units) => (p.soldAs === "pack-and-loose" && p.unitsPerPack ? units / p.unitsPerPack : units);

const PRODUCT_FIELDS = "name productCode brand manufacturer composition genericName strengthValue strengthUnit dosageForm soldAs unitsPerPack packUnit looseUnitName packRate looseRate isActive rack";

// One row per (rack position, batch): what is physically where.
async function stockRows({ scope, racks, isAdmin, productFilter = null }) {
  const batches = await Batch.find({ qtyRemaining: { $gt: 0 }, isDeleted: { $ne: true }, ...(productFilter ? { product: productFilter } : {}) })
    .populate("product", PRODUCT_FIELDS)
    .sort({ expiryDate: 1 });
  const now = Date.now();
  const rows = [];
  for (const b of batches) {
    const p = b.product;
    if (!p?.isActive) continue;
    for (const loc of effectiveLocations(b)) {
      if (!scope.matches(loc.rack)) continue;
      const where = describePosition(loc.rack, racks.get(loc.rack.charAt(0)));
      // null when no expiry was entered: never counts as expiring.
      const days = b.expiryDate ? Math.floor((new Date(b.expiryDate).getTime() - now) / DAY) : null;
      const unitCost = p.soldAs === "pack-and-loose" ? b.costPrice / p.unitsPerPack : b.costPrice;
      const unitRate = p.soldAs === "pack-and-loose" ? p.looseRate : p.packRate;
      rows.push({
        rack: loc.rack,
        rackLetter: where.rack,
        location: where.label,
        shelf: where.shelf,
        row: where.row,
        bin: where.bin,
        productId: p._id,
        name: p.name,
        productCode: p.productCode,
        manufacturer: p.manufacturer || p.brand || "",
        composition: p.composition || p.genericName || "",
        batchId: b._id,
        batchNo: b.batchNo,
        expiryDate: b.expiryDate,
        daysToExpiry: days,
        expiryStatus: days === null ? "No expiry" : days < 0 ? "Expired" : days <= 30 ? "Expiring Soon" : days <= EXPIRY_SOON_DAYS ? `Within ${EXPIRY_SOON_DAYS} days` : "OK",
        qty: loc.qty,
        qtyDisplay: unitsLabel(p, loc.qty),
        packs: r2(packsOf(p, loc.qty)),
        packUnit: p.packUnit,
        soldAs: p.soldAs,
        unitsPerPack: p.unitsPerPack || 1,
        looseUnitName: p.looseUnitName || "",
        isPrimary: (b.rack || "") === loc.rack,
        valueMrp: r2(loc.qty * (unitRate || 0)),
        ...(isAdmin ? { valueCost: r2(loc.qty * unitCost) } : {}),
      });
    }
  }
  const t = (d) => (d ? new Date(d).getTime() : Infinity);
  rows.sort((a, b) => a.rack.localeCompare(b.rack) || a.name.localeCompare(b.name) || t(a.expiryDate) - t(b.expiryDate));
  return rows;
}

function exportRows(res, format, { title, subtitle, file, rows, isAdmin }) {
  const flat = rows.map((r) => ({ ...r, rack: r.rack || "No Rack", expiryDate: r.expiryDate ? new Date(r.expiryDate).toISOString().slice(0, 10) : "" }));
  if (format === "pdf") {
    return streamPdfReport(res, `${file}.pdf`, {
      title,
      subtitle,
      columns: [
        { header: "Position", key: "rack" },
        { header: "Product", key: "name" },
        { header: "Manufacturer", key: "manufacturer" },
        { header: "Batch", key: "batchNo" },
        { header: "Expiry", key: "expiryDate" },
        { header: "Qty", key: "qtyDisplay" },
        { header: "Status", key: "expiryStatus" },
      ],
      rows: flat,
    });
  }
  return streamExcelReport(res, `${file}.xlsx`, [
    {
      name: "Rack Stock",
      columns: [
        { header: "Position", key: "rack", width: 12 },
        { header: "Location", key: "location", width: 32 },
        { header: "Product", key: "name", width: 26 },
        { header: "Code", key: "productCode", width: 12 },
        { header: "Manufacturer", key: "manufacturer", width: 18 },
        { header: "Composition", key: "composition", width: 24 },
        { header: "Batch", key: "batchNo", width: 14 },
        { header: "Expiry", key: "expiryDate", width: 12 },
        { header: "Expiry Status", key: "expiryStatus", width: 16 },
        { header: "Qty", key: "qtyDisplay", width: 20 },
        { header: "Packs", key: "packs", width: 10 },
        { header: "Value (MRP)", key: "valueMrp", width: 12 },
        ...(isAdmin ? [{ header: "Value (Cost)", key: "valueCost", width: 12 }] : []),
      ],
      rows: flat,
    },
  ]);
}

// Highest position number any stock (product primary rack or batch
// location) currently uses on this rack.
async function highestUsedPosition(letter) {
  const re = new RegExp(`^${letter}-\\d{3}$`);
  const [products, batches] = await Promise.all([
    Product.find({ isActive: true, rack: re }).select("rack").lean(),
    Batch.find({ qtyRemaining: { $gt: 0 }, $or: [{ rack: re }, { "locations.rack": re }] }),
  ]);
  let max = products.reduce((m, p) => Math.max(m, Number(p.rack.slice(2))), 0);
  for (const b of batches) for (const l of effectiveLocations(b)) if (re.test(l.rack)) max = Math.max(max, Number(l.rack.slice(2)));
  return max;
}

router.get("/", async (req, res) => {
  const racks = await Rack.find().sort({ letter: 1 });
  res.json(racks.map(rackJson));
});

// Per-rack occupancy, capacity and expiry counts (plus a "No Rack" row).
router.get("/summary", async (req, res) => {
  const racks = await rackMap();
  const rows = await stockRows({ scope: { matches: () => true }, racks, isAdmin: req.user.role === "admin" });
  const soon = Date.now() + EXPIRY_SOON_DAYS * DAY;
  const stat = () => ({ packs: 0, positions: new Set(), products: new Set(), batches: 0, expired: 0, expiringSoon: 0, valueMrp: 0 });
  const byLetter = new Map();
  for (const r of rows) {
    const key = r.rack ? r.rack.charAt(0) : "";
    const s = byLetter.get(key) || stat();
    s.packs += r.packs;
    if (r.rack) s.positions.add(r.rack);
    s.products.add(String(r.productId));
    s.batches += 1;
    if (r.daysToExpiry === null) {
      /* no expiry entered */
    } else if (r.daysToExpiry < 0) s.expired += 1;
    else if (new Date(r.expiryDate).getTime() <= soon) s.expiringSoon += 1;
    s.valueMrp += r.valueMrp;
    byLetter.set(key, s);
  }
  const out = [...racks.values()].map((rack) => {
    const s = byLetter.get(rack.letter) || stat();
    const capacityPacks = rack.binCapacity ? rack.binCapacity * rack.positions : null;
    return {
      ...rackJson(rack),
      occupiedPositions: s.positions.size,
      freePositions: rack.positions - s.positions.size,
      packs: r2(s.packs),
      capacityPacks,
      freePacks: capacityPacks === null ? null : r2(Math.max(capacityPacks - s.packs, 0)),
      utilizationPct: capacityPacks ? r2((s.packs / capacityPacks) * 100) : r2((s.positions.size / rack.positions) * 100),
      products: s.products.size,
      batches: s.batches,
      expired: s.expired,
      expiringSoon: s.expiringSoon,
      valueMrp: r2(s.valueMrp),
    };
  });
  const none = byLetter.get("") || stat();
  res.json({ racks: out, noRack: { packs: r2(none.packs), products: none.products.size, batches: none.batches, expired: none.expired, expiringSoon: none.expiringSoon } });
});

// Stock on a rack / shelf / position (scope), or everywhere. This is also
// what a rack QR scan opens. ?format=excel|pdf exports.
router.get("/stock", async (req, res) => {
  const racks = await rackMap();
  const scope = resolveScope(req.query.scope, racks);
  if (!scope) return res.status(400).json({ message: "That is not a known rack, shelf or position code." });
  const isAdmin = req.user.role === "admin";
  const rows = await stockRows({ scope, racks, isAdmin });
  if (req.query.format) {
    return exportRows(res, req.query.format, { title: `Gugan Medicals - Rack Stock: ${scope.label}`, subtitle: `${rows.length} batch locations`, file: "GuganMedicals_Rack_Stock", rows, isAdmin });
  }
  const positions = scope.rackDoc && scope.level === "rack" ? scope.rackDoc.positions : scope.positions?.length || null;
  res.json({ scope: { level: scope.level, code: scope.code ?? "", label: scope.label, letter: scope.letter || "", positions }, rows });
});

// Batches on a rack nearing expiry (default 90 days), for rack-wise alerts.
router.get("/expiry", async (req, res) => {
  const racks = await rackMap();
  const scope = resolveScope(req.query.scope, racks);
  if (!scope) return res.status(400).json({ message: "That is not a known rack, shelf or position code." });
  const days = Math.min(Math.max(Number(req.query.days) || EXPIRY_SOON_DAYS, 1), 730);
  const isAdmin = req.user.role === "admin";
  const rows = (await stockRows({ scope, racks, isAdmin })).filter((r) => r.daysToExpiry !== null && r.daysToExpiry <= days);
  if (req.query.format) {
    return exportRows(res, req.query.format, { title: "Gugan Medicals - Rack-wise Expiry Alerts", subtitle: `Expired or expiring within ${days} days · ${scope.label}`, file: "GuganMedicals_Rack_Expiry", rows, isAdmin });
  }
  res.json({ days, rows });
});

// Medicine Locator: where is it? Search by brand, generic, composition,
// strength, code or barcode; every rack position each batch sits on.
router.get("/locate", async (req, res) => {
  const search = productSearchFilter(req.query.q);
  if (!search) return res.json([]);
  const products = await Product.find({ isActive: true, ...search }, "_id").limit(40);
  if (!products.length) return res.json([]);
  const racks = await rackMap();
  const rows = await stockRows({ scope: { matches: () => true }, racks, isAdmin: req.user.role === "admin", productFilter: { $in: products.map((p) => p._id) } });
  const byProduct = new Map();
  for (const r of rows) {
    const key = String(r.productId);
    const entry = byProduct.get(key) || { productId: r.productId, name: r.name, productCode: r.productCode, manufacturer: r.manufacturer, composition: r.composition, locations: [] };
    entry.locations.push(r);
    byProduct.set(key, entry);
  }
  // Products with no stock still show (with no locations) so "not on any rack" is visible.
  const full = await Product.find({ _id: { $in: products.map((p) => p._id) } }, PRODUCT_FIELDS);
  res.json(
    full.map((p) => byProduct.get(String(p._id)) || { productId: p._id, name: p.name, productCode: p.productCode, manufacturer: p.manufacturer || p.brand || "", composition: p.composition || "", locations: [] })
  );
});

// Rack Transfer: move part or all of one batch from one position to
// another. Total stock is unchanged; the move is recorded in the ledger.
router.post("/transfer", requireRole("admin"), transactional(async (req, res) => {
  const { batch: batchId } = req.body;
  if (!mongoose.isValidObjectId(batchId)) return res.status(400).json({ message: "Please choose a batch." });
  const from = cleanRack(req.body.from);
  const to = cleanRack(req.body.to);
  const toError = await rackPositionError(req.body.to);
  if (toError) return res.status(400).json({ message: toError });
  if (from === to) return res.status(400).json({ message: "Choose a different destination position." });
  const qty = Number(req.body.qty);
  if (!Number.isInteger(qty) || qty <= 0) return res.status(400).json({ message: "Please enter a valid quantity to move." });

  const batch = await syncedBatch(await Batch.findById(batchId));
  if (!batch) return res.status(404).json({ message: "No records found." });
  const here = effectiveLocations(batch).find((l) => l.rack === from)?.qty || 0;
  if (here < qty) return res.status(400).json({ message: `Only ${here} of this batch on ${from || "No Rack"}.` });

  const moved = await moveBetweenLocations(batch._id, from, to, qty);
  if (!moved) return res.status(409).json({ message: "Stock at that position changed meanwhile. Please try again." });
  // A batch fully moved off its primary rack now lives at the destination.
  if (!effectiveLocations(moved).some((l) => l.rack === (moved.rack || ""))) {
    moved.rack = to;
    await moved.save();
  }
  const product = await Product.findById(moved.product);
  await StockLedger.create({
    product: moved.product,
    batch: moved._id,
    type: "rack-transfer",
    qtyChange: 0,
    qtyMoved: qty,
    rack: from,
    toRack: to,
    reason: String(req.body.reason || "").trim() || `Moved ${unitsLabel(product, qty)} ${from || "No Rack"} → ${to || "No Rack"}`,
    performedBy: req.user._id,
  });
  const locations = await refreshProductRack(product);
  res.json({ batch: { _id: moved._id, batchNo: moved.batchNo, locations: effectiveLocations(moved) }, productLocations: locations, productRack: product.rack });
}));

// Stock Audit: physical counts for batches at positions in a scope. Saved
// as a record; with apply, stock is corrected to the counts (ledger entries
// per difference, totals updated immediately).
router.post("/audit", requireRole("admin"), transactional(async (req, res) => {
  const racks = await rackMap();
  const scope = resolveScope(req.body.scope, racks);
  if (!scope || scope.level === "all") return res.status(400).json({ message: "Choose a rack, shelf or position to audit." });
  const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
  if (!lines.length) return res.status(400).json({ message: "Enter at least one physical count." });
  const apply = Boolean(req.body.apply);

  const prepared = [];
  for (const l of lines) {
    const physical = Number(l.physicalQty);
    if (!Number.isInteger(physical) || physical < 0) return res.status(400).json({ message: "Physical counts must be whole numbers of 0 or more." });
    const rack = cleanRack(l.rack);
    if (!scope.matches(rack)) return res.status(400).json({ message: `${rack || "No Rack"} is outside ${scope.label}.` });
    const batch = mongoose.isValidObjectId(l.batch) ? await Batch.findById(l.batch).populate("product", PRODUCT_FIELDS) : null;
    if (!batch?.product) return res.status(400).json({ message: "A counted batch was not found." });
    const system = effectiveLocations(batch).find((x) => x.rack === rack)?.qty || 0;
    prepared.push({ batch, rack, system, physical });
  }

  const auditLines = [];
  for (const { batch, rack, system, physical } of prepared) {
    const diff = physical - system;
    auditLines.push({ product: batch.product._id, productName: batch.product.name, batch: batch._id, batchNo: batch.batchNo, rack, systemQty: system, physicalQty: physical, difference: diff });
    if (!apply || diff === 0) continue;
    const fresh = await syncedBatch(await Batch.findById(batch._id));
    const locs = effectiveLocations(fresh);
    const loc = locs.find((x) => x.rack === rack);
    if (loc) loc.qty = physical;
    else locs.push({ rack, qty: physical });
    fresh.qtyRemaining = Math.max(fresh.qtyRemaining + diff, 0);
    if (fresh.qtyRemaining > fresh.qtyReceived) fresh.qtyReceived = fresh.qtyRemaining;
    fresh.locations = locs.filter((x) => x.qty > 0);
    if (diff > 0) fresh.isDeleted = false;
    await fresh.save();
    await Product.updateOne({ _id: batch.product._id }, [{ $set: { qty: { $max: [{ $add: ["$qty", diff] }, 0] } } }]);
    await StockLedger.create({
      product: batch.product._id,
      batch: batch._id,
      type: "stock-audit",
      qtyChange: diff,
      rack,
      reason: `Stock audit of ${scope.label}: counted ${physical}, system had ${system}`,
      performedBy: req.user._id,
    });
  }
  const audit = await StockAudit.create({ scope: scope.code || (scope.level === "none" ? "NONE" : ""), lines: auditLines, applied: apply, note: String(req.body.note || "").slice(0, 300), performedBy: req.user._id });
  res.status(201).json(audit);
}));

router.get("/audits", async (req, res) => {
  const filter = req.query.scope ? { scope: String(req.query.scope).toUpperCase() } : {};
  const audits = await StockAudit.find(filter).populate("performedBy", "username").sort({ createdAt: -1 }).limit(50);
  res.json(audits);
});

// Rack History: every stock movement in or out of a rack / shelf / position
// (purchases, sales, transfers, audits, adjustments, write-offs).
router.get("/history", async (req, res) => {
  const racks = await rackMap();
  const scope = resolveScope(req.query.scope, racks);
  if (!scope) return res.status(400).json({ message: "That is not a known rack, shelf or position code." });
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  // Entries recorded before rack tracking have no rack, so they can't be placed.
  const filter = scope.level === "all" ? { rack: { $exists: true } } : ledgerRackFilter(scope);
  const entries = await StockLedger.find(filter)
    .populate("product", "name productCode soldAs unitsPerPack packUnit looseUnitName")
    .populate("batch", "batchNo expiryDate")
    .populate("performedBy", "username")
    .sort({ createdAt: -1 })
    .limit(limit);
  res.json(
    entries.map((e) => ({
      _id: e._id,
      date: e.createdAt,
      type: e.type,
      product: e.product ? { _id: e.product._id, name: e.product.name, productCode: e.product.productCode } : null,
      batchNo: e.batch?.batchNo || "",
      rack: e.rack,
      toRack: e.toRack,
      qtyChange: e.qtyChange,
      qtyMoved: e.qtyMoved,
      qtyDisplay: e.product ? unitsLabel(e.product, Math.abs(e.type === "rack-transfer" ? e.qtyMoved || 0 : e.qtyChange)) : String(Math.abs(e.qtyChange)),
      reason: e.reason,
      by: e.performedBy?.username || "",
    }))
  );
});

router.post("/", requirePermission("racks.add"), async (req, res) => {
  const letter = String(req.body.letter || "").trim().toUpperCase();
  if (!/^[A-Z]$/.test(letter)) return res.status(400).json({ message: "Please choose a rack letter from A to Z." });
  const { fields, error } = layoutFrom(req.body);
  if (error) return res.status(400).json({ message: error });
  // Positions are optional: a new rack starts with 10 unless told otherwise.
  if (!fields.positions) Object.assign(fields, { positions: 10, shelves: 1, rowsPerShelf: 1, binsPerRow: null });
  if (await Rack.exists({ letter })) return res.status(409).json({ message: `Rack ${letter} already exists.` });

  const rack = await Rack.create({ letter, ...fields });
  res.status(201).json(rackJson(rack));
});

// Changing the layout / position count / name / capacity. Shrinking is
// blocked while stock still sits on a position that would disappear.
router.patch("/:letter", requireRole("admin"), async (req, res) => {
  const rack = await Rack.findOne({ letter: String(req.params.letter).toUpperCase() });
  if (!rack) return res.status(404).json({ message: "No records found." });
  const { fields, error } = layoutFrom(req.body, rack);
  if (error) return res.status(400).json({ message: error });

  if (fields.positions !== undefined) {
    const used = await highestUsedPosition(rack.letter);
    if (fields.positions < used) {
      return res.status(400).json({
        message: `Stock is still assigned to ${positionCode(rack.letter, used)}. Move it before reducing Rack ${rack.letter} below ${used} positions.`,
      });
    }
  }
  Object.assign(rack, fields);
  await rack.save();
  res.json(rackJson(rack));
});

// Always allowed, even for the last rack: products and batch stock still on
// it fall back to No Rack (""), recorded as transfers in the ledger.
router.delete("/:letter", requireRole("admin"), async (req, res) => {
  const rack = await Rack.findOne({ letter: String(req.params.letter).toUpperCase() });
  if (!rack) return res.status(404).json({ message: "No records found." });
  const re = new RegExp(`^${rack.letter}-`);
  const { modifiedCount } = await Product.updateMany({ rack: re }, { $set: { rack: "" } });
  const batches = await Batch.find({ $or: [{ rack: re }, { "locations.rack": re }] });
  for (const b of batches) {
    const locs = effectiveLocations(b);
    const merged = new Map();
    for (const l of locs) {
      const target = re.test(l.rack) ? "" : l.rack;
      merged.set(target, (merged.get(target) || 0) + l.qty);
      if (target !== l.rack) {
        await StockLedger.create({ product: b.product, batch: b._id, type: "rack-transfer", qtyChange: 0, qtyMoved: l.qty, rack: l.rack, toRack: "", reason: `Rack ${rack.letter} deleted`, performedBy: req.user._id });
      }
    }
    if (re.test(b.rack)) b.rack = "";
    b.locations = [...merged.entries()].map(([r, qty]) => ({ rack: r, qty }));
    await b.save();
  }
  await rack.deleteOne();
  res.json({
    message: `Rack ${rack.letter} deleted.${modifiedCount ? ` ${modifiedCount} product${modifiedCount === 1 ? "" : "s"} moved to No Rack.` : ""}`,
    movedToNoRack: modifiedCount,
  });
});

export default router;
