import { Router } from "express";
import mongoose from "mongoose";
import Sale from "../models/Sale.js";
import Purchase from "../models/Purchase.js";
import Expense, { EBITDA_ADDBACKS } from "../models/Expense.js";
import StockLedger from "../models/StockLedger.js";
import Product from "../models/Product.js";
import Batch from "../models/Batch.js";
import Category from "../models/Category.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { streamExcelReport, streamPdfReport } from "../utils/reportExport.js";
import { buildStockReport, inventoryValueAt } from "../utils/stockReportHelpers.js";
import { vendorOutstandingMap } from "../utils/ledgerHelpers.js";
import { dayBookSummary } from "../utils/dayBookHelpers.js";
import { hasPermission, requirePermission } from "../utils/permissions.js";

// Admins get the full, interactive dashboard (filters, date ranges, exports,
// reports). Other users can be granted a view-only dashboard on the Roles &
// Permissions page: fixed to the last 30 days, no filters, and only the
// sections they hold a permission for - see /summary below.
const router = Router();
router.use(requireAuth);

const PAYMENT_MODES = ["Cash", "Card", "UPI", "Other", "Credit"];

function resolveRange(req) {
  const { from, to } = req.query;
  const end = to ? new Date(to) : new Date();
  end.setHours(23, 59, 59, 999);
  const start = from ? new Date(from) : new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

// Optional dashboard filters. Unknown values are ignored rather than erroring,
// so a stale link (e.g. a deleted category) just shows the unfiltered view.
function resolveFilters(req) {
  const { category, paymentMode } = req.query;
  return {
    category: category && mongoose.isValidObjectId(category) ? String(category) : null,
    paymentMode: PAYMENT_MODES.includes(paymentMode) ? paymentMode : null,
  };
}

async function computeSummary(start, end, { category = null, paymentMode = null } = {}) {
  const filtered = Boolean(category || paymentMode);
  const inCategory = (product) => !category || String(product?.category || "") === category;

  const sales = await Sale.find({
    paymentStatus: "completed",
    createdAt: { $gte: start, $lte: end },
  }).populate("items.product", "category");

  const purchases = await Purchase.find({ date: { $gte: start, $lte: end } }).populate("items.product", "category");
  const expenses = await Expense.find({ date: { $gte: start, $lte: end } });
  const clearances = await StockLedger.find({
    type: "stock-clearance",
    createdAt: { $gte: start, $lte: end },
  }).populate("product", "category");

  let revenue = 0; // matches every active filter
  let allRevenue = 0; // whole shop, no filters - the base for sharing out expenses
  let cogs = 0;
  let outputGst = 0;
  let salesCount = 0;
  const productTotals = new Map(); // productId -> { name, totalRevenue }
  const productProfit = new Map(); // productId -> { name, revenue, categoryRevenue, cogs, writeOff }
  const categoryTotals = new Map(); // categoryId -> total
  const dailyTotals = new Map(); // yyyy-mm-dd -> { revenue, expense, profit }

  // Everything is summed per line (not per bill) so the category filter can
  // pick out individual lines; per-line figures add back up to the bill totals.
  for (const sale of sales) {
    const modeMatches = !paymentMode || sale.paymentMode === paymentMode;
    const day = sale.createdAt.toISOString().slice(0, 10);
    let saleMatched = false;

    for (const item of sale.items) {
      // Bill-level discount is shared across lines in proportion to line value.
      const lineDiscount = sale.subtotal > 0 ? sale.discount * (item.amount / sale.subtotal) : 0;
      const lineNet = item.amount - lineDiscount;
      allRevenue += lineNet;
      if (!inCategory(item.product)) continue;

      const key = String(item.product?._id || item.product);
      const profitBucket = productProfit.get(key) || { name: item.name, revenue: 0, categoryRevenue: 0, cogs: 0, writeOff: 0 };
      profitBucket.categoryRevenue += lineNet;
      productProfit.set(key, profitBucket);
      if (!modeMatches) continue;

      saleMatched = true;
      revenue += lineNet;
      cogs += item.costAmount;
      outputGst += item.gstAmount;
      profitBucket.revenue += lineNet;
      profitBucket.cogs += item.costAmount;

      const bucket = dailyTotals.get(day) || { date: day, revenue: 0, expense: 0, profit: 0 };
      bucket.revenue += lineNet + item.gstAmount; // bill total incl. GST, after discount
      dailyTotals.set(day, bucket);

      const productBucket = productTotals.get(key) || { name: item.name, totalRevenue: 0 };
      productBucket.totalRevenue += item.amount + item.gstAmount;
      productTotals.set(key, productBucket);

      const catId = item.product?.category ? String(item.product.category) : "uncategorized";
      categoryTotals.set(catId, (categoryTotals.get(catId) || 0) + item.amount);
    }
    if (saleMatched) salesCount += 1;
  }

  // Purchases have their own payment modes, so only the category filter applies.
  let inputGst = 0;
  let totalPurchases = 0;
  for (const p of purchases) {
    if (!category) {
      inputGst += p.gstAmount;
      totalPurchases += p.total;
      continue;
    }
    for (const item of p.items) {
      if (!inCategory(item.product)) continue;
      inputGst += item.lineGst;
      totalPurchases += item.lineAmount + item.lineGst;
    }
  }

  // Shop expenses (rent, salary...) aren't tied to products or payment modes.
  // With a filter on, the filtered sales carry their revenue share of them -
  // the same rule the per-product table uses - so Net Profit and ROI still
  // mean "after expenses".
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  const expenseShare = filtered ? (allRevenue > 0 ? revenue / allRevenue : 0) : 1;
  const shopExpenses = totalExpenses * expenseShare;

  for (const e of expenses) {
    const day = e.date.toISOString().slice(0, 10);
    const bucket = dailyTotals.get(day) || { date: day, revenue: 0, expense: 0, profit: 0 };
    bucket.expense += e.amount * expenseShare;
    dailyTotals.set(day, bucket);
  }

  // Expired write-offs belong to their product. Under a payment-mode filter a
  // product carries only the share matching its sales in that mode.
  for (const c of clearances) {
    if (!inCategory(c.product)) continue;
    const key = String(c.product?._id || c.product);
    const bucket = productProfit.get(key) || { name: null, revenue: 0, categoryRevenue: 0, cogs: 0, writeOff: 0 };
    bucket.writeOff += c.costImpact || 0;
    productProfit.set(key, bucket);
  }
  const writeOffPortion = (v) =>
    !paymentMode ? v.writeOff : v.categoryRevenue > 0 ? v.writeOff * (v.revenue / v.categoryRevenue) : 0;
  const expiredWriteOff = [...productProfit.values()].reduce((sum, v) => sum + writeOffPortion(v), 0);

  // Revenue is net of GST and discount (GST is collected for the government,
  // not income). Cost is what the goods actually sold cost (FIFO batch cost at
  // sale time), not the period's purchases - purchases become cost only when
  // sold, so counting both would double-count stock.
  const grossProfit = revenue - cogs;
  const profit = grossProfit - shopExpenses - expiredWriteOff;
  const pct = (part) => (revenue > 0 ? Number(((part / revenue) * 100).toFixed(1)) : null);

  // EBITDA = Net Profit + Interest + Taxes + Depreciation + Amortization.
  // Those four are recorded as expense categories, so Net Profit already has
  // them subtracted; adding them back gives earnings before them. Under a
  // filter each carries the same revenue share as the other expenses.
  const addBack = Object.fromEntries(
    EBITDA_ADDBACKS.map((cat) => [
      cat.toLowerCase(),
      expenses.filter((e) => e.category === cat).reduce((sum, e) => sum + e.amount, 0) * expenseShare,
    ])
  );
  const ebitda = profit + addBack.interest + addBack.taxes + addBack.depreciation + addBack.amortization;
  const roiPct = (net, investment) => (investment > 0 ? Number(((net / investment) * 100).toFixed(1)) : null);

  // Product Profitability & ROI:
  //   Product Investment = cost of the units sold (FIFO batch cost, same as COGS)
  //   Gross Profit       = Sales Revenue - COGS
  //   Allocated Expenses = share of shop expenses by revenue + the product's own expired write-off
  //   Net Profit         = Gross Profit - Allocated Expenses
  //   ROI (%)            = Net Profit / Product Investment x 100
  // Allocations add back up to the totals, so the product net profits sum to the P&L net profit.
  const unnamedIds = [...productProfit.entries()].filter(([, v]) => !v.name).map(([id]) => id);
  if (unnamedIds.length) {
    const named = await Product.find({ _id: { $in: unnamedIds } }, "name");
    named.forEach((p) => (productProfit.get(String(p._id)).name = p.name));
  }
  const productProfitability = [...productProfit.entries()]
    .map(([productId, v]) => {
      const writeOff = writeOffPortion(v);
      const allocatedExpenses = (allRevenue > 0 ? totalExpenses * (v.revenue / allRevenue) : 0) + writeOff;
      const productGross = v.revenue - v.cogs;
      const productNet = productGross - allocatedExpenses;
      return {
        productId,
        name: v.name || "Unknown product",
        investment: Number(v.cogs.toFixed(2)),
        revenue: Number(v.revenue.toFixed(2)),
        cogs: Number(v.cogs.toFixed(2)),
        grossProfit: Number(productGross.toFixed(2)),
        allocatedExpenses: Number(allocatedExpenses.toFixed(2)),
        netProfit: Number(productNet.toFixed(2)),
        roiPct: roiPct(productNet, v.cogs),
      };
    })
    // Under a payment-mode filter, drop products with nothing in that mode.
    .filter((p) => p.revenue !== 0 || p.allocatedExpenses !== 0)
    .sort((a, b) => b.netProfit - a.netProfit);
  // Expenses with no sales in the period can't be spread over products; they
  // still sit in the shop totals, so the product view counts them as unallocated.
  const unallocatedExpenses = !filtered && revenue <= 0 ? totalExpenses : 0;

  const salesTrend = [...dailyTotals.values()].sort((a, b) => a.date.localeCompare(b.date));
  // approximate daily profit split proportionally to revenue share, for the chart only - the summary profit figure above is the authoritative one
  const totalTrendRevenue = salesTrend.reduce((s, d) => s + d.revenue, 0) || 1;
  salesTrend.forEach((d) => {
    d.profit = Number((profit * (d.revenue / totalTrendRevenue)).toFixed(2));
    d.revenue = Number(d.revenue.toFixed(2));
    d.expense = Number(d.expense.toFixed(2));
  });

  const fastMovers = [...productTotals.entries()]
    .map(([productId, v]) => ({ productId, ...v }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue)
    .slice(0, 5);

  const categoryIds = [...categoryTotals.keys()].filter((k) => k !== "uncategorized");
  const categories = await Category.find({ _id: { $in: categoryIds } });
  const categoryNameById = new Map(categories.map((c) => [String(c._id), c.name]));
  const revenueByCategory = [...categoryTotals.entries()].map(([id, total]) => ({
    categoryId: id === "uncategorized" ? null : id,
    category: id === "uncategorized" ? "Uncategorized" : categoryNameById.get(id) || "Unknown",
    total: Number(total.toFixed(2)),
  }));

  const productScope = { isActive: true, ...(category ? { category } : {}) };
  const lowStock = await Product.find({ ...productScope, qty: { $gt: 0 } })
    .then((all) => all.filter((p) => p.qty <= p.lowStockThreshold).sort((a, b) => a.qty - b.qty).slice(0, 5));

  const now = new Date();
  const soonCutoff = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const expiringSoon = await Batch.find({ qtyRemaining: { $gt: 0 }, expiryDate: { $lte: soonCutoff } })
    .populate({ path: "product", select: "name productCode isActive", match: productScope })
    .sort({ expiryDate: 1 })
    .limit(50)
    .then((batches) => batches.filter((b) => b.product).slice(0, 5));

  // Stock value and payables are current-state figures (not bound to the
  // selected date range) - a snapshot of "right now", same as the Day Book.
  const { totals: stockTotals } = await buildStockReport(category ? { category } : {});
  const outstandingMap = await vendorOutstandingMap();

  // Inventory Turnover Ratio = COGS / Average Inventory, where
  // Average Inventory = (Opening Inventory + Closing Inventory) / 2, all at cost.
  // Opening is stock value at the start of the range, closing at its end.
  const [openingInventory, closingInventory] = await Promise.all([
    inventoryValueAt(start, category),
    inventoryValueAt(new Date(end.getTime() + 1), category),
  ]);
  const averageInventory = (openingInventory + closingInventory) / 2;
  const inventoryTurnover = averageInventory > 0 ? Number((cogs / averageInventory).toFixed(2)) : null;
  const totalPayables = [...outstandingMap.values()].reduce((sum, v) => sum + v, 0);

  return {
    filters: { category, paymentMode },
    revenue: Number(revenue.toFixed(2)),
    cogs: Number(cogs.toFixed(2)),
    expenses: Number(shopExpenses.toFixed(2)),
    totalExpenses: Number(totalExpenses.toFixed(2)),
    expiredWriteOff: Number(expiredWriteOff.toFixed(2)),
    grossProfit: Number(grossProfit.toFixed(2)),
    profit: Number(profit.toFixed(2)),
    netProfit: Number(Math.max(profit, 0).toFixed(2)),
    netLoss: Number(Math.max(-profit, 0).toFixed(2)),
    grossMarginPct: pct(grossProfit),
    netMarginPct: pct(profit),
    investment: Number(cogs.toFixed(2)),
    allocatedExpenses: Number((shopExpenses - unallocatedExpenses + expiredWriteOff).toFixed(2)),
    unallocatedExpenses: Number(unallocatedExpenses.toFixed(2)),
    roiPct: roiPct(profit, cogs),
    interest: Number(addBack.interest.toFixed(2)),
    taxes: Number(addBack.taxes.toFixed(2)),
    depreciation: Number(addBack.depreciation.toFixed(2)),
    amortization: Number(addBack.amortization.toFixed(2)),
    ebitda: Number(ebitda.toFixed(2)),
    ebitdaMarginPct: pct(ebitda),
    openingInventory,
    closingInventory,
    averageInventory: Number(averageInventory.toFixed(2)),
    inventoryTurnover,
    productProfitability,
    outputGst: Number(outputGst.toFixed(2)),
    inputGst: Number(inputGst.toFixed(2)),
    netGst: Number((outputGst - inputGst).toFixed(2)),
    totalPurchases: Number(totalPurchases.toFixed(2)),
    totalStockValue: stockTotals.totalValueCost,
    totalPayables: Number(totalPayables.toFixed(2)),
    salesCount,
    fastMovers,
    lowStock,
    expiringSoon,
    salesTrend,
    revenueByCategory,
  };
}

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

// Human-readable "Category: Tablet · Payment: UPI" line for report headers.
async function describeFilters({ category, paymentMode }) {
  const parts = [];
  if (category) parts.push(`Category: ${(await Category.findById(category))?.name || "Unknown"}`);
  if (paymentMode) parts.push(`Payment: ${paymentMode}`);
  return parts.join(" · ");
}

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
