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
import { periodLabel, streamExcelReport, streamPdfReport, todayStamp } from "../utils/reportExport.js";
import Customer from "../models/Customer.js";
import { REPORT_LIST, buildManagementReport, describeReportFilters } from "../utils/managementReports.js";
import { hasPermission } from "../utils/permissions.js";
import mongoose from "mongoose";
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
    paymentModes: ["Cash", "UPI", "Card", "Bank Transfer", "Credit", "Other"],
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

// ---------- Management Reports (utils/managementReports.js) ----------

router.get("/management/options", async (req, res) => {
  const [customers, vendors, products] = await Promise.all([
    Customer.find({ isActive: true }, "name phone").sort({ name: 1 }).lean(),
    Vendor.find({ isActive: { $ne: false } }, "name").sort({ name: 1 }).lean(),
    Product.find({ isActive: true }, "name productCode").sort({ name: 1 }).lean(),
  ]);
  res.json({ reports: REPORT_LIST, customers, vendors, products });
});

const inr = (v) => Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// A cell for a downloaded file: numbers stay numbers in Excel, text in the PDF.
function cellOf(column, row, forPdf) {
  const type = column.type === "by-row" ? row.type || "money" : column.type;
  const v = row[column.key];
  if (v === null || v === undefined || v === "") return forPdf ? "" : null;
  if (type === "date") return isoLocal(v);
  if (typeof v !== "number") return v;
  if (!forPdf) return v;
  if (type === "money") return inr(v);
  if (type === "pct") return `${v}%`;
  return String(v);
}
const isoLocal = (d) => new Date(d).toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata" }).replace(/\//g, "-"); // DD-MM-YYYY

// ?report=<key>&from&to&customer&vendor&product  (&format=excel|pdf to download)
router.get("/management", async (req, res) => {
  const range = rangeOr400(req, res);
  if (!range) return;
  const id = (v, word) => (v && (v === word || mongoose.isValidObjectId(v)) ? String(v) : null);
  const ctx = { ...range, customer: id(req.query.customer, "walk-in"), vendor: id(req.query.vendor, "none"), product: id(req.query.product) };
  const { format } = req.query;
  if (format && !hasPermission(req.user, "reports.export")) return res.status(403).json({ message: "You do not have permission to perform this action." });

  const report = await buildManagementReport(String(req.query.report || ""), ctx);
  if (!report) return res.status(404).json({ message: "Choose a report." });
  if (!format) return res.json(report);

  const productName = ctx.product ? (await Product.findById(ctx.product, "name"))?.name : "";
  const filters = await describeReportFilters({ ...ctx, productName });
  const subtitle = [periodLabel(report.period.from, report.period.to), filters].filter(Boolean).join(" · ");
  const numeric = (c) => !["text", "date"].includes(c.type);
  const totalRow = report.totals && report.rows.length ? { [report.columns[0].key]: "Total", ...report.totals } : null;
  const filename = `GuganMedicals_${report.title.replace(/[^\w]+/g, "_")}`;

  if (format === "pdf") {
    const rows = report.rows.map((r) => Object.fromEntries(report.columns.map((c) => [c.key, cellOf(c, r, true)])));
    if (totalRow) rows.push(Object.fromEntries(report.columns.map((c) => [c.key, c.key === report.columns[0].key ? "Total" : report.totals[c.key] === undefined ? "" : cellOf(c, totalRow, true)])));
    return streamPdfReport(res, `${filename}.pdf`, {
      title: `${SHOP.name} - ${report.title}`,
      subtitle,
      summaryLines: [...(report.note ? [report.note] : []), ...(report.summary || []).map((s) => `${s.label}: ${s.type === "money" ? `Rs. ${inr(s.value)}` : s.value}`)],
      columns: report.columns.map((c) => ({ header: c.label || " ", key: c.key, align: numeric(c) ? "right" : "left", flex: c.type === "text" ? 1.6 : 1 })),
      rows,
      showCount: false,
    });
  }
  const sheets = [
    {
      name: report.title.slice(0, 31),
      columns: report.columns.map((c) => ({ header: c.label || " ", key: c.key, width: c.type === "text" ? 26 : 16, ...(c.type === "money" ? { style: { numFmt: "#,##0.00" } } : {}) })),
      rows: [...report.rows, ...(totalRow ? [totalRow] : [])].map((r) => Object.fromEntries(report.columns.map((c) => [c.key, r === totalRow && c.key !== report.columns[0].key && report.totals[c.key] === undefined ? null : r === totalRow && c.key === report.columns[0].key ? "Total" : cellOf(c, r, false)]))),
    },
    {
      name: "About",
      columns: [{ header: "Report", key: "k", width: 30 }, { header: report.title, key: "v", width: 44 }],
      rows: [{ k: "Period and filters", v: subtitle }, ...(report.note ? [{ k: "Note", v: report.note }] : []), ...(report.summary || []).map((s) => ({ k: s.label, v: s.value }))],
    },
  ];
  return streamExcelReport(res, `${filename}.xlsx`, sheets);
});

export default router;
