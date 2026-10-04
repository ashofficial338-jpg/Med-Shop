import { Router } from "express";
import Sale from "../models/Sale.js";
import Purchase from "../models/Purchase.js";
import Expense from "../models/Expense.js";
import StockLedger from "../models/StockLedger.js";
import Product from "../models/Product.js";
import Batch from "../models/Batch.js";
import Category from "../models/Category.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { streamExcelReport, streamPdfReport } from "../utils/reportExport.js";
import { buildStockReport, inventoryValueAt } from "../utils/stockReportHelpers.js";
import { vendorOutstandingMap } from "../utils/ledgerHelpers.js";

const router = Router();
router.use(requireAuth, requireRole("admin"));

function resolveRange(req) {
  const { from, to } = req.query;
  const end = to ? new Date(to) : new Date();
  end.setHours(23, 59, 59, 999);
  const start = from ? new Date(from) : new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

async function computeSummary(start, end) {
  const sales = await Sale.find({
    paymentStatus: "completed",
    createdAt: { $gte: start, $lte: end },
  }).populate("items.product", "category");

  const purchases = await Purchase.find({ date: { $gte: start, $lte: end } });
  const expenses = await Expense.find({ date: { $gte: start, $lte: end } });
  const clearances = await StockLedger.find({
    type: "stock-clearance",
    createdAt: { $gte: start, $lte: end },
  });

  let revenue = 0;
  let cogs = 0;
  let outputGst = 0;
  const productTotals = new Map(); // productId -> { name, totalRevenue }
  const productProfit = new Map(); // productId -> { name, revenue, cogs, writeOff }
  const categoryTotals = new Map(); // categoryId -> total
  const dailyTotals = new Map(); // yyyy-mm-dd -> { revenue, expense, profit }

  for (const sale of sales) {
    const netRevenue = sale.subtotal - sale.discount;
    revenue += netRevenue;
    outputGst += sale.gstAmount;

    const day = sale.createdAt.toISOString().slice(0, 10);
    const bucket = dailyTotals.get(day) || { date: day, revenue: 0, expense: 0, profit: 0 };
    bucket.revenue += sale.total;
    dailyTotals.set(day, bucket);

    for (const item of sale.items) {
      cogs += item.costAmount;

      const key = String(item.product?._id || item.product);
      const productBucket = productTotals.get(key) || { name: item.name, totalRevenue: 0 };
      productBucket.totalRevenue += item.amount + item.gstAmount;
      productTotals.set(key, productBucket);

      // Bill-level discount is shared across lines in proportion to line value,
      // so per-product revenue adds back up to the period revenue above.
      const lineDiscount = sale.subtotal > 0 ? sale.discount * (item.amount / sale.subtotal) : 0;
      const profitBucket = productProfit.get(key) || { name: item.name, revenue: 0, cogs: 0, writeOff: 0 };
      profitBucket.revenue += item.amount - lineDiscount;
      profitBucket.cogs += item.costAmount;
      productProfit.set(key, profitBucket);

      const catId = item.product?.category ? String(item.product.category) : "uncategorized";
      categoryTotals.set(catId, (categoryTotals.get(catId) || 0) + item.amount);
    }
  }

  const inputGst = purchases.reduce((sum, p) => sum + p.gstAmount, 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  const expiredWriteOff = clearances.reduce((sum, c) => sum + (c.costImpact || 0), 0);
  const totalPurchases = purchases.reduce((sum, p) => sum + p.total, 0);

  for (const e of expenses) {
    const day = e.date.toISOString().slice(0, 10);
    const bucket = dailyTotals.get(day) || { date: day, revenue: 0, expense: 0, profit: 0 };
    bucket.expense += e.amount;
    dailyTotals.set(day, bucket);
  }

  // Revenue is net of GST and discount (GST is collected for the government,
  // not income). Cost is what the goods actually sold cost (FIFO batch cost at
  // sale time), not the period's purchases - purchases become cost only when
  // sold, so counting both would double-count stock.
  const grossProfit = revenue - cogs;
  const profit = grossProfit - totalExpenses - expiredWriteOff;
  const pct = (part) => (revenue > 0 ? Number(((part / revenue) * 100).toFixed(1)) : null);
  const roiPct = (net, investment) => (investment > 0 ? Number(((net / investment) * 100).toFixed(1)) : null);

  // Product Profitability & ROI:
  //   Product Investment = cost of the units sold (FIFO batch cost, same as COGS)
  //   Gross Profit       = Sales Revenue - COGS
  //   Allocated Expenses = share of shop expenses by revenue + the product's own expired write-off
  //   Net Profit         = Gross Profit - Allocated Expenses
  //   ROI (%)            = Net Profit / Product Investment x 100
  // Allocations add back up to the shop totals, so the product net profits sum to the P&L net profit.
  for (const c of clearances) {
    const key = String(c.product);
    const bucket = productProfit.get(key) || { name: null, revenue: 0, cogs: 0, writeOff: 0 };
    bucket.writeOff += c.costImpact || 0;
    productProfit.set(key, bucket);
  }
  const unnamedIds = [...productProfit.entries()].filter(([, v]) => !v.name).map(([id]) => id);
  if (unnamedIds.length) {
    const named = await Product.find({ _id: { $in: unnamedIds } }, "name");
    named.forEach((p) => (productProfit.get(String(p._id)).name = p.name));
  }
  const productProfitability = [...productProfit.entries()]
    .map(([productId, v]) => {
      const expenseShare = revenue > 0 ? totalExpenses * (v.revenue / revenue) : 0;
      const allocatedExpenses = expenseShare + v.writeOff;
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
    .sort((a, b) => b.netProfit - a.netProfit);
  // Expenses with no sales in the period can't be spread over products; they
  // still sit in the shop totals, so the product view counts them as unallocated.
  const unallocatedExpenses = revenue > 0 ? 0 : totalExpenses;

  const salesTrend = [...dailyTotals.values()].sort((a, b) => a.date.localeCompare(b.date));
  // approximate daily profit split proportionally to revenue share, for the chart only - the summary profit figure above is the authoritative one
  const totalTrendRevenue = salesTrend.reduce((s, d) => s + d.revenue, 0) || 1;
  salesTrend.forEach((d) => {
    d.profit = Number((profit * (d.revenue / totalTrendRevenue)).toFixed(2));
  });

  const fastMovers = [...productTotals.entries()]
    .map(([productId, v]) => ({ productId, ...v }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue)
    .slice(0, 5);

  const categoryIds = [...categoryTotals.keys()].filter((k) => k !== "uncategorized");
  const categories = await Category.find({ _id: { $in: categoryIds } });
  const categoryNameById = new Map(categories.map((c) => [String(c._id), c.name]));
  const revenueByCategory = [...categoryTotals.entries()].map(([id, total]) => ({
    category: id === "uncategorized" ? "Uncategorized" : categoryNameById.get(id) || "Unknown",
    total: Number(total.toFixed(2)),
  }));

  const lowStock = await Product.find({ isActive: true, qty: { $gt: 0 } })
    .then((all) => all.filter((p) => p.qty <= p.lowStockThreshold).sort((a, b) => a.qty - b.qty).slice(0, 5));

  const now = new Date();
  const soonCutoff = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const expiringSoon = await Batch.find({ qtyRemaining: { $gt: 0 }, expiryDate: { $lte: soonCutoff } })
    .populate({ path: "product", select: "name productCode isActive", match: { isActive: true } })
    .sort({ expiryDate: 1 })
    .limit(20)
    .then((batches) => batches.filter((b) => b.product).slice(0, 5));

  // Stock value and payables are current-state figures (not bound to the
  // selected date range) - a snapshot of "right now", same as the Day Book.
  const { totals: stockTotals } = await buildStockReport();
  const outstandingMap = await vendorOutstandingMap();

  // Inventory Turnover Ratio = COGS / Average Inventory, where
  // Average Inventory = (Opening Inventory + Closing Inventory) / 2, all at cost.
  // Opening is stock value at the start of the range, closing at its end.
  const [openingInventory, closingInventory] = await Promise.all([
    inventoryValueAt(start),
    inventoryValueAt(new Date(end.getTime() + 1)),
  ]);
  const averageInventory = (openingInventory + closingInventory) / 2;
  const inventoryTurnover = averageInventory > 0 ? Number((cogs / averageInventory).toFixed(2)) : null;
  const totalPayables = [...outstandingMap.values()].reduce((sum, v) => sum + v, 0);

  return {
    revenue: Number(revenue.toFixed(2)),
    cogs: Number(cogs.toFixed(2)),
    expenses: Number(totalExpenses.toFixed(2)),
    expiredWriteOff: Number(expiredWriteOff.toFixed(2)),
    grossProfit: Number(grossProfit.toFixed(2)),
    profit: Number(profit.toFixed(2)),
    netProfit: Number(Math.max(profit, 0).toFixed(2)),
    netLoss: Number(Math.max(-profit, 0).toFixed(2)),
    grossMarginPct: pct(grossProfit),
    netMarginPct: pct(profit),
    investment: Number(cogs.toFixed(2)),
    allocatedExpenses: Number((totalExpenses - unallocatedExpenses + expiredWriteOff).toFixed(2)),
    unallocatedExpenses: Number(unallocatedExpenses.toFixed(2)),
    roiPct: roiPct(profit, cogs),
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
    salesCount: sales.length,
    fastMovers,
    lowStock,
    expiringSoon,
    salesTrend,
    revenueByCategory,
  };
}

router.get("/summary", async (req, res) => {
  const { start, end } = resolveRange(req);
  const summary = await computeSummary(start, end);
  res.json(summary);
});

router.get("/export", async (req, res) => {
  const { start, end } = resolveRange(req);
  const summary = await computeSummary(start, end);
  const summaryRows = [
    { k: "Period", v: `${start.toDateString()} - ${end.toDateString()}` },
    { k: "Revenue (net of GST & discount)", v: summary.revenue },
    { k: "Cost of Goods Sold", v: summary.cogs },
    { k: "Gross Profit", v: summary.grossProfit },
    { k: "Expenses", v: summary.expenses },
    { k: "Expired Stock Write-off", v: summary.expiredWriteOff },
    { k: summary.profit >= 0 ? "Net Profit" : "Net Loss", v: summary.profit >= 0 ? summary.netProfit : summary.netLoss },
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
      subtitle: `${start.toDateString()} - ${end.toDateString()}`,
      columns: [
        { header: "Metric", key: "k" },
        { header: "Value", key: "v", align: "right" },
      ],
      rows: summaryRows.map((r) => ({ k: r.k, v: typeof r.v === "number" ? `Rs. ${r.v.toFixed(2)}` : r.v })),
    });
  }

  const sales = await Sale.find({ createdAt: { $gte: start, $lte: end } }).populate("customer", "name phone");
  const purchases = await Purchase.find({ date: { $gte: start, $lte: end } }).populate("vendor", "name");
  const expenses = await Expense.find({ date: { $gte: start, $lte: end } });

  await streamExcelReport(res, "GHM_Report.xlsx", [
    {
      name: "Summary",
      columns: [{ header: "Metric", key: "k", width: 30 }, { header: "Value", key: "v", width: 20 }],
      rows: summaryRows,
    },
    {
      name: "Product ROI",
      columns: [
        { header: "Product", key: "name", width: 30 },
        { header: "Product Investment", key: "investment", width: 18 },
        { header: "Sales Revenue", key: "revenue", width: 16 },
        { header: "Gross Profit", key: "grossProfit", width: 16 },
        { header: "Allocated Expenses", key: "allocatedExpenses", width: 18 },
        { header: "Net Profit", key: "netProfit", width: 16 },
        { header: "ROI (%)", key: "roi", width: 12 },
      ],
      rows: summary.productProfitability.map((p) => ({ ...p, roi: p.roiPct === null ? "-" : p.roiPct })),
    },
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
