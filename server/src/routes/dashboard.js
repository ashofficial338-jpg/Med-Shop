import { Router } from "express";
import Sale from "../models/Sale.js";
import Purchase from "../models/Purchase.js";
import Expense from "../models/Expense.js";
import Product from "../models/Product.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { streamExcelReport, streamPdfReport } from "../utils/reportExport.js";
import { computeSummary, describeFilters, resolveFilters, resolveRange } from "../utils/summaryHelpers.js";
import { dayBookSummary } from "../utils/dayBookHelpers.js";
import { hasPermission, requirePermission } from "../utils/permissions.js";

// Admins get the full, interactive dashboard (filters, date ranges, exports,
// reports). Other users can be granted a view-only dashboard on the Roles &
// Permissions page: fixed to the last 30 days, no filters, and only the
// sections they hold a permission for - see /summary below.
const router = Router();
router.use(requireAuth);

// Which summary fields each view-only permission unlocks. Admins get them all.
const SECTION_FIELDS = {
  "dashboard.profit": [
    "revenue", "cogs", "expenses", "totalExpenses", "expiredWriteOff", "grossProfit", "profit", "netProfit", "netLoss",
    "grossMarginPct", "netMarginPct", "investment", "allocatedExpenses", "unallocatedExpenses", "roiPct", "interest",
    "taxes", "depreciation", "amortization", "ebitda", "ebitdaMarginPct", "productProfitability", "totalPurchases", "salesCount",
  ],
  "dashboard.sales": ["outputGst", "inputGst", "netGst", "salesCount", "salesTrend", "revenueByCategory", "fastMovers"],
  "dashboard.stock": [
    "cogs", "openingInventory", "closingInventory", "averageInventory", "inventoryTurnover", "totalStockValue", "lowStock", "expiringSoon",
  ],
  "dashboard.cash": ["cashToday"],
  "dashboard.receivables": ["totalPayables", "receivables"],
};

router.get("/summary", requirePermission("dashboard.view"), async (req, res) => {
  const interactive = req.user.role === "admin";
  // View-only users always see the default period with no filters - those
  // controls (and anything they send) are admin-only.
  const { start, end } = interactive ? resolveRange(req) : resolveRange({ query: {} });
  const summary = await computeSummary(start, end, interactive ? resolveFilters(req) : {});

  // Today's cash position (the Day Book's figures) - "right now", not range-bound.
  const today = await dayBookSummary(new Date());
  summary.cashToday = today;
  summary.receivables = today.credit.closing;

  const sections = Object.keys(SECTION_FIELDS).filter((key) => hasPermission(req.user, key));
  // Server-local calendar days, matching how resolveRange built the range.
  const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const access = { interactive, sections, from: day(start), to: day(end) };
  if (interactive) return res.json({ ...summary, access });

  const allowed = new Set(["filters", ...sections.flatMap((key) => SECTION_FIELDS[key])]);
  res.json({ ...Object.fromEntries(Object.entries(summary).filter(([k]) => allowed.has(k))), access });
});

const PROFITABILITY_COLUMNS = [
  { header: "Product", key: "name", width: 30, flex: 2.2 },
  { header: "Product Investment", key: "investment", width: 18, align: "right" },
  { header: "Sales Revenue", key: "revenue", width: 16, align: "right" },
  { header: "Gross Profit", key: "grossProfit", width: 16, align: "right" },
  { header: "Allocated Expenses", key: "allocatedExpenses", width: 18, align: "right" },
  { header: "Net Profit", key: "netProfit", width: 16, align: "right" },
  { header: "ROI (%)", key: "roi", width: 12, align: "right" },
];
const profitabilityRows = (summary) =>
  summary.productProfitability.map((p) => ({ ...p, roi: p.roiPct === null ? "-" : p.roiPct }));

// Product Profitability & ROI table on its own, with the dashboard's filters.
router.get("/profitability/export", requireRole("admin"), async (req, res) => {
  const { start, end } = resolveRange(req);
  const filters = resolveFilters(req);
  const summary = await computeSummary(start, end, filters);
  const filterLine = await describeFilters(filters);
  const period = `${start.toDateString()} - ${end.toDateString()}`;
  const rows = profitabilityRows(summary);

  if (req.query.format === "pdf") {
    const rs = (n) => `Rs. ${n.toFixed(2)}`;
    return streamPdfReport(res, "GHM_Product_Profitability.pdf", {
      title: "GHM Medical Shop - Product Profitability & ROI",
      subtitle: filterLine ? `${period} · ${filterLine}` : period,
      summaryLines: [
        `Investment ${rs(summary.investment)} · Revenue ${rs(summary.revenue)} · Gross Profit ${rs(summary.grossProfit)}`,
        `Allocated Expenses ${rs(summary.allocatedExpenses)} · Net Profit ${rs(summary.profit)} · ROI ${summary.roiPct === null ? "-" : `${summary.roiPct}%`}`,
      ],
      columns: PROFITABILITY_COLUMNS,
      rows: rows.map((r) => ({
        ...r,
        investment: rs(r.investment),
        revenue: rs(r.revenue),
        grossProfit: rs(r.grossProfit),
        allocatedExpenses: rs(r.allocatedExpenses),
        netProfit: rs(r.netProfit),
        roi: r.roiPct === null ? "-" : `${r.roiPct}%`,
      })),
    });
  }

  await streamExcelReport(res, "GHM_Product_Profitability.xlsx", [
    { name: "Product ROI", columns: PROFITABILITY_COLUMNS, rows },
  ]);
});

router.get("/export", requireRole("admin"), async (req, res) => {
  const { start, end } = resolveRange(req);
  const filters = resolveFilters(req);
  const summary = await computeSummary(start, end, filters);
  const filterLine = await describeFilters(filters);
  const summaryRows = [
    { k: "Period", v: `${start.toDateString()} - ${end.toDateString()}` },
    ...(filterLine ? [{ k: "Filters", v: filterLine }] : []),
    { k: "Revenue (net of GST & discount)", v: summary.revenue },
    { k: "Cost of Goods Sold", v: summary.cogs },
    { k: "Gross Profit", v: summary.grossProfit },
    { k: filterLine ? "Expenses (share for these filters)" : "Expenses", v: summary.expenses },
    { k: "Expired Stock Write-off", v: summary.expiredWriteOff },
    { k: summary.profit >= 0 ? "Net Profit" : "Net Loss", v: summary.profit >= 0 ? summary.netProfit : summary.netLoss },
    { k: "Interest (added back)", v: summary.interest },
    { k: "Taxes (added back)", v: summary.taxes },
    { k: "Depreciation (added back)", v: summary.depreciation },
    { k: "Amortization (added back)", v: summary.amortization },
    { k: "EBITDA", v: summary.ebitda },
    { k: "EBITDA Margin (%)", v: summary.ebitdaMarginPct === null ? "-" : `${summary.ebitdaMarginPct}%` },
    { k: "Product Investment (cost of goods sold)", v: summary.investment },
    { k: "ROI (%)", v: summary.roiPct === null ? "-" : `${summary.roiPct}%` },
    { k: "Opening Inventory (cost)", v: summary.openingInventory },
    { k: "Closing Inventory (cost)", v: summary.closingInventory },
    { k: "Average Inventory", v: summary.averageInventory },
    { k: "Inventory Turnover Ratio", v: summary.inventoryTurnover === null ? "-" : `${summary.inventoryTurnover}x` },
    { k: "Output GST", v: summary.outputGst },
    { k: "Input GST", v: summary.inputGst },
    { k: "Net GST Payable", v: summary.netGst },
    { k: "Total Purchases", v: summary.totalPurchases },
    { k: "Total Stock Value (cost)", v: summary.totalStockValue },
    { k: "Total Payables", v: summary.totalPayables },
  ];

  if (req.query.format === "pdf") {
    return streamPdfReport(res, "GHM_Report.pdf", {
      title: "GHM Medical Shop - P&L Summary",
      showCount: false,
      subtitle: `${start.toDateString()} - ${end.toDateString()}${filterLine ? ` · ${filterLine}` : ""}`,
      columns: [
        { header: "Metric", key: "k" },
        { header: "Value", key: "v", align: "right" },
      ],
      rows: summaryRows.map((r) => ({ k: r.k, v: typeof r.v === "number" ? `Rs. ${r.v.toFixed(2)}` : r.v })),
    });
  }

  // Detail sheets follow the same filters: a bill or purchase is listed when
  // any of its lines is in the chosen category.
  const saleFilter = { createdAt: { $gte: start, $lte: end } };
  if (filters.paymentMode) saleFilter.paymentMode = filters.paymentMode;
  const categoryProductIds = filters.category ? (await Product.find({ category: filters.category }, "_id")).map((p) => p._id) : null;
  if (categoryProductIds) saleFilter["items.product"] = { $in: categoryProductIds };
  const purchaseFilter = { date: { $gte: start, $lte: end } };
  if (categoryProductIds) purchaseFilter["items.product"] = { $in: categoryProductIds };

  const sales = await Sale.find(saleFilter).populate("customer", "name phone");
  const purchases = await Purchase.find(purchaseFilter).populate("vendor", "name");
  const expenses = await Expense.find({ date: { $gte: start, $lte: end } });

  await streamExcelReport(res, "GHM_Report.xlsx", [
    {
      name: "Summary",
      columns: [{ header: "Metric", key: "k", width: 30 }, { header: "Value", key: "v", width: 20 }],
      rows: summaryRows,
    },
    { name: "Product ROI", columns: PROFITABILITY_COLUMNS, rows: profitabilityRows(summary) },
    {
      name: "Sales",
      columns: [
        { header: "Bill No", key: "billNo", width: 16 },
        { header: "Date", key: "date", width: 20 },
        { header: "Customer", key: "customer", width: 20 },
        { header: "Subtotal", key: "subtotal", width: 12 },
        { header: "GST", key: "gst", width: 12 },
        { header: "Discount", key: "discount", width: 12 },
        { header: "Total", key: "total", width: 12 },
        { header: "Status", key: "status", width: 12 },
      ],
      rows: sales.map((s) => ({
        billNo: s.billNo,
        date: s.createdAt.toISOString().slice(0, 10),
        customer: s.customer?.name || "Walk-in",
        subtotal: s.subtotal,
        gst: s.gstAmount,
        discount: s.discount,
        total: s.total,
        status: s.paymentStatus,
      })),
    },
    {
      name: "Purchases",
      columns: [
        { header: "Invoice No", key: "invoiceNo", width: 16 },
        { header: "Date", key: "date", width: 20 },
        { header: "Vendor", key: "vendor", width: 20 },
        { header: "Subtotal", key: "subtotal", width: 12 },
        { header: "GST", key: "gst", width: 12 },
        { header: "TDS", key: "tds", width: 12 },
        { header: "Total", key: "total", width: 12 },
      ],
      rows: purchases.map((p) => ({
        invoiceNo: p.invoiceNo,
        date: p.date.toISOString().slice(0, 10),
        vendor: p.vendor?.name,
        subtotal: p.subtotal,
        gst: p.gstAmount,
        tds: p.tdsAmount,
        total: p.total,
      })),
    },
    {
      name: "Expenses",
      columns: [
        { header: "Date", key: "date", width: 20 },
        { header: "Category", key: "category", width: 16 },
        { header: "Amount", key: "amount", width: 12 },
        { header: "Notes", key: "notes", width: 30 },
      ],
      rows: expenses.map((e) => ({ date: e.date.toISOString().slice(0, 10), category: e.category, amount: e.amount, notes: e.notes })),
    },
  ]);
});

export default router;
