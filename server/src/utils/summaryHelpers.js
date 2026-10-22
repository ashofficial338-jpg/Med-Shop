import mongoose from "mongoose";
import Sale from "../models/Sale.js";
import Purchase from "../models/Purchase.js";
import Expense, { EBITDA_ADDBACKS } from "../models/Expense.js";
import StockLedger from "../models/StockLedger.js";
import Product from "../models/Product.js";
import Batch from "../models/Batch.js";
import Category from "../models/Category.js";
import Vendor from "../models/Vendor.js";
import { buildStockReport, inventoryValueAt } from "./stockReportHelpers.js";
import { vendorOutstandingMap } from "./ledgerHelpers.js";

// The one P&L engine behind the dashboard, the Reports & Analytics page and
// every PDF/Excel export built from them - so a figure never differs between
// what's on screen and what's downloaded.

export const PAYMENT_MODES = ["Cash", "Card", "UPI", "Other", "Credit"];

export function resolveRange(req) {
  const { from, to } = req.query;
  const end = to ? new Date(to) : new Date();
  end.setHours(23, 59, 59, 999);
  const start = from ? new Date(from) : new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

const objectId = (v) => (v && mongoose.isValidObjectId(v) ? String(v) : null);

// Optional dashboard/report filters. Unknown values are ignored rather than
// erroring, so a stale link (e.g. a deleted category) just shows the
// unfiltered view. The dashboard only sends category/paymentMode; the
// Reports page can also narrow to a brand, one product or a supplier.
export function resolveFilters(req) {
  const { category, paymentMode, brand, product, supplier } = req.query;
  return {
    category: objectId(category),
    paymentMode: PAYMENT_MODES.includes(paymentMode) ? paymentMode : null,
    brand: typeof brand === "string" && brand.trim() ? brand.trim().slice(0, 80) : null,
    product: objectId(product),
    supplier: objectId(supplier),
  };
}

// The product-level filters (category, brand, one product, supplier) as a
// Mongo filter on Product. A product's supplier is its default vendor.
export function productScope({ category, brand, product, supplier } = {}) {
  const scope = {};
  if (category) scope.category = category;
  if (brand) scope.brand = brand;
  if (product) scope._id = product;
  if (supplier) scope.vendor = supplier;
  return scope;
}

// The same filters as an in-memory test on a populated product ref. Purchases
// pass ignoreSupplier, since there the supplier is the purchase's own vendor.
export function productMatcher({ category, brand, product, supplier } = {}, { ignoreSupplier = false } = {}) {
  return (p) =>
    (!category || String(p?.category || "") === category) &&
    (!brand || (p?.brand || "") === brand) &&
    (!product || String(p?._id || p || "") === product) &&
    (ignoreSupplier || !supplier || String(p?.vendor || "") === supplier);
}

export const PRODUCT_FILTER_FIELDS = "category brand vendor";

export async function computeSummary(start, end, filters = {}) {
  const { category = null, paymentMode = null, brand = null, product = null, supplier = null } = filters;
  const productFiltered = Boolean(category || brand || product || supplier);
  const filtered = Boolean(productFiltered || paymentMode);
  const inCategory = productMatcher(filters);
  const inPurchaseLine = productMatcher(filters, { ignoreSupplier: true });

  const sales = await Sale.find({
    paymentStatus: "completed",
    createdAt: { $gte: start, $lte: end },
  }).populate("items.product", PRODUCT_FILTER_FIELDS);

  const purchases = await Purchase.find({ date: { $gte: start, $lte: end } }).populate("items.product", PRODUCT_FILTER_FIELDS);
  const expenses = await Expense.find({ date: { $gte: start, $lte: end } });
  const clearances = await StockLedger.find({
    type: "stock-clearance",
    createdAt: { $gte: start, $lte: end },
  }).populate("product", PRODUCT_FILTER_FIELDS);

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

  // Purchases have their own payment modes, so only the product-level filters
  // apply - with the supplier matched against the purchase's own vendor.
  let inputGst = 0;
  let totalPurchases = 0;
  for (const p of purchases) {
    if (supplier && String(p.vendor) !== supplier) continue;
    if (!category && !brand && !product) {
      inputGst += p.gstAmount;
      totalPurchases += p.total;
      continue;
    }
    for (const item of p.items) {
      if (!inPurchaseLine(item.product)) continue;
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

  const scope = productScope(filters);
  const activeScope = { isActive: true, ...scope };
  const lowStock = await Product.find({ ...activeScope, qty: { $gt: 0 } })
    .then((all) => all.filter((p) => p.qty <= p.lowStockThreshold).sort((a, b) => a.qty - b.qty).slice(0, 5));

  const now = new Date();
  const soonCutoff = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const expiringSoon = await Batch.find({ qtyRemaining: { $gt: 0 }, expiryDate: { $lte: soonCutoff } })
    .populate({ path: "product", select: "name productCode isActive", match: activeScope })
    .sort({ expiryDate: 1 })
    .limit(50)
    .then((batches) => batches.filter((b) => b.product).slice(0, 5));

  // Stock value and payables are current-state figures (not bound to the
  // selected date range) - a snapshot of "right now", same as the Day Book.
  const { totals: stockTotals } = await buildStockReport({ scope });
  const outstandingMap = await vendorOutstandingMap();

  // Inventory Turnover Ratio = COGS / Average Inventory, where
  // Average Inventory = (Opening Inventory + Closing Inventory) / 2, all at cost.
  // Opening is stock value at the start of the range, closing at its end.
  const [openingInventory, closingInventory] = await Promise.all([
    inventoryValueAt(start, inCategory),
    inventoryValueAt(new Date(end.getTime() + 1), inCategory),
  ]);
  const averageInventory = (openingInventory + closingInventory) / 2;
  const inventoryTurnover = averageInventory > 0 ? Number((cogs / averageInventory).toFixed(2)) : null;
  const totalPayables = supplier
    ? outstandingMap.get(supplier) || 0
    : [...outstandingMap.values()].reduce((sum, v) => sum + v, 0);

  return {
    filters: { category, paymentMode, brand, product, supplier },
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

// Human-readable "Category: Tablet · Payment: UPI" line for report headers.
export async function describeFilters({ category, paymentMode, brand, product, supplier }) {
  const parts = [];
  if (category) parts.push(`Category: ${(await Category.findById(category))?.name || "Unknown"}`);
  if (brand) parts.push(`Brand: ${brand}`);
  if (product) parts.push(`Product: ${(await Product.findById(product))?.name || "Unknown"}`);
  if (supplier) parts.push(`Supplier: ${(await Vendor.findById(supplier))?.name || "Unknown"}`);
  if (paymentMode) parts.push(`Payment: ${paymentMode}`);
  return parts.join(" · ");
}
