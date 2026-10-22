import { Router } from "express";
import Product from "../models/Product.js";
import Category from "../models/Category.js";
import Vendor from "../models/Vendor.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../utils/permissions.js";
import { describeFilters, resolveFilters, resolveRange } from "../utils/summaryHelpers.js";
import { GRANULARITIES, TRANSACTION_TYPES, buildAnalytics, buildCatalog, buildTransactions } from "../utils/analyticsHelpers.js";
import { streamAnalyticsPdf } from "../utils/analyticsPdf.js";
import { EXCEL_SHEETS, buildAnalyticsWorkbook } from "../utils/analyticsExcel.js";
import { buildConsolidated } from "../utils/consolidatedHelpers.js";
import { todayStamp } from "../utils/reportExport.js";
import { SHOP } from "../utils/saleHelpers.js";

// Reports & Analytics. Financial figures for any period and filter, so it
// is gated on its own permissions (admins always pass): reports.view to open
// it, reports.export to download PDF/Excel.
const router = Router();
router.use(requireAuth, requirePermission("reports.view"));

const SECTIONS = Object.keys(EXCEL_SHEETS);
const TEMPLATE_TITLES = {
  consolidated: "Consolidated Financial Report",
  complete: "Complete Business Report",
  daily: "Daily Report",
  weekly: "Weekly Report",
  monthly: "Monthly Report",
  quarterly: "Quarterly Report",
  yearly: "Yearly Report",
  inventory: "Inventory Report",
  financial: "Financial Report",
  product: "Product Performance Report",
  custom: "Custom Report",
};
const MAX_RANGE_DAYS = 366 * 10;

// Date range from ?from&to, rejecting nonsense instead of failing later.
function rangeOr400(req, res) {
  const { start, end } = resolveRange(req);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    res.status(400).json({ message: "Please choose a valid date range." });
    return null;
  }
  if (start > end) {
    res.status(400).json({ message: "The start date must be on or before the end date." });
    return null;
  }
  if ((end - start) / 86400000 > MAX_RANGE_DAYS) {
    res.status(400).json({ message: "Please choose a range of 10 years or less." });
    return null;
  }
  return { start, end };
}

const fmtDay = (iso) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });

function paginate(rows, req, sortable) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(5, parseInt(req.query.limit, 10) || 25));
  const sort = sortable.includes(req.query.sort) ? req.query.sort : null;
  const dir = req.query.dir === "asc" ? 1 : -1;
  if (sort) {
    rows = [...rows].sort((a, b) => {
      const av = a[sort] ?? "";
      const bv = b[sort] ?? "";
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : av instanceof Date ? av - bv : String(av).localeCompare(String(bv));
      return cmp * dir;
    });
  }
  const total = rows.length;
  return { rows: rows.slice((page - 1) * limit, page * limit), page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) };
}

// Choices for the filter bar.
router.get("/options", async (req, res) => {
  const [categories, brands, suppliers, products] = await Promise.all([
    Category.find({ isActive: { $ne: false } }, "name").sort({ name: 1 }),
    Product.distinct("brand", { isActive: true, brand: { $nin: ["", null] } }),
    Vendor.find({ isActive: { $ne: false } }, "name").sort({ name: 1 }),
    Product.find({ isActive: true }, "name productCode brand").sort({ name: 1 }),
  ]);
  res.json({
    categories,
    brands: brands.sort((a, b) => a.localeCompare(b)),
    suppliers,
    products,
    paymentModes: ["Cash", "UPI", "Card", "Credit", "Other"],
    transactionTypes: TRANSACTION_TYPES,
    sections: SECTIONS.map((key) => ({ key, label: EXCEL_SHEETS[key] })),
    templates: Object.entries(TEMPLATE_TITLES).map(([key, title]) => ({ key, title })),
  });
});

router.get("/analytics", async (req, res) => {
  const range = rangeOr400(req, res);
  if (!range) return;
  const analytics = await buildAnalytics(range.start, range.end, resolveFilters(req), {
    granularity: req.query.granularity,
    compare: req.query.compare !== "false",
  });
  res.json(analytics);
});

// Consolidated Financial Report: headline health metrics, balances as of
// the end date, expiry, and monthly / financial-year comparisons.
router.get("/consolidated", async (req, res) => {
  const range = rangeOr400(req, res);
  if (!range) return;
  const { analytics, ...report } = await buildConsolidated(range.start, range.end, resolveFilters(req), { granularity: req.query.granularity });
  res.json(report);
});

router.get("/transactions", async (req, res) => {
  const range = rangeOr400(req, res);
  if (!range) return;
  const type = TRANSACTION_TYPES.includes(req.query.type) ? req.query.type : "";
  const all = await buildTransactions(range.start, range.end, resolveFilters(req), { type, q: req.query.q });
  const counted = all.filter((t) => t.status !== "Void");
  const totals = {
    in: Number(counted.filter((t) => t.direction === "in").reduce((s, t) => s + t.amount, 0).toFixed(2)),
    out: Number(counted.filter((t) => t.direction === "out").reduce((s, t) => s + t.amount, 0).toFixed(2)),
  };
  res.json({ ...paginate(all, req, ["date", "type", "ref", "party", "mode", "amount", "status"]), totals });
});

router.get("/catalog", async (req, res) => {
  let rows = await buildCatalog(resolveFilters(req));
  const q = String(req.query.q || "").trim().toLowerCase();
  if (q) rows = rows.filter((r) => [r.name, r.sku, r.brand, r.category, r.supplier].some((v) => String(v || "").toLowerCase().includes(q)));
  if (["In stock", "Low stock", "Out of stock"].includes(req.query.status)) rows = rows.filter((r) => r.status === req.query.status);
  res.json(paginate(rows, req, ["name", "brand", "sku", "category", "supplier", "sellingPrice", "purchasePrice", "gstPercent", "qty", "marginPct", "valueCost"]));
});

router.get("/export", requirePermission("reports.export"), async (req, res) => {
  const range = rangeOr400(req, res);
  if (!range) return;
  const format = req.query.format === "pdf" ? "pdf" : "excel";
  const requested = String(req.query.sections || "").split(",").filter((s) => SECTIONS.includes(s));
  const sections = requested.length ? requested : SECTIONS;
  const template = TEMPLATE_TITLES[req.query.template] ? req.query.template : "custom";
  const title = TEMPLATE_TITLES[template];
  const filters = resolveFilters(req);

  const needsDetail = sections.some((s) => ["transactions", "sales", "expenses", "purchases"].includes(s));
  const needsCatalog = sections.some((s) => ["products", "inventory"].includes(s));
  // The consolidated section needs its own comparisons; its analytics then
  // serve every other section too.
  const consolidated = sections.includes("consolidated") ? await buildConsolidated(range.start, range.end, filters, { granularity: req.query.granularity }) : null;
  const [analytics, transactions, catalog, filterLine] = await Promise.all([
    consolidated?.analytics ||
      buildAnalytics(range.start, range.end, filters, { granularity: req.query.granularity, compare: req.query.compare !== "false" }),
    needsDetail ? buildTransactions(range.start, range.end, filters) : null,
    needsCatalog && format === "excel" ? buildCatalog(filters) : null,
    describeFilters(filters),
  ]);
  analytics.catalog = catalog;

  const period = `${fmtDay(analytics.period.from)} to ${fmtDay(analytics.period.to)}`;
  const subtitle = `Report period: ${period} · by ${analytics.period.granularity}`;
  const base = `${SHOP.name}_${title}`.replace(/[^\w]+/g, "_");
  const filename = `${base}_${todayStamp()}.${format === "pdf" ? "pdf" : "xlsx"}`;
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "no-store");

  if (format === "pdf") {
    res.setHeader("Content-Type", "application/pdf");
    return streamAnalyticsPdf(res, { shopName: SHOP.name, title, subtitle, filterLine, analytics, transactions, sections, consolidated });
  }

  const buffer = await buildAnalyticsWorkbook({
    shopName: SHOP.name,
    title,
    meta: `Report period: ${period}${filterLine ? ` · ${filterLine}` : ""}`,
    analytics,
    transactions,
    sections,
    consolidated,
  });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Length", buffer.length);
  res.end(buffer);
});

export default router;
