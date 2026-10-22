import Sale from "../models/Sale.js";
import Purchase from "../models/Purchase.js";
import Expense from "../models/Expense.js";
import StockLedger from "../models/StockLedger.js";
import Batch from "../models/Batch.js";
import Category from "../models/Category.js";
import Customer from "../models/Customer.js";
import Vendor from "../models/Vendor.js";
import CustomerPayment from "../models/CustomerPayment.js";
import SupplierPayment from "../models/SupplierPayment.js";
import { computeSummary, productMatcher, productScope } from "./summaryHelpers.js";
import { buildStockReport } from "./stockReportHelpers.js";
import { customerOutstandingMap, vendorOutstandingMap } from "./ledgerHelpers.js";

// Reports & Analytics. The headline P&L figures always come from
// computeSummary (the dashboard's engine); everything here breaks those same
// figures down - by period, product, brand, category, payment mode, GST slab,
// customer and supplier - using the same per-line rules, so every breakdown
// adds back up to the headline totals on screen, in the PDF and in Excel.

// "fy" is the Indian financial year, April to March.
export const GRANULARITIES = ["day", "week", "month", "quarter", "year", "fy"];
export const TRANSACTION_TYPES = ["sale", "purchase", "expense", "receipt", "payment"];
const GST_SLABS = [0, 5, 12, 18, 28];
const DAY = 24 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Populated on sale/purchase lines: the filter fields plus what the
// breakdowns need (GST slab, pack size for "packs sold").
const LINE_PRODUCT_FIELDS = "name productCode category brand vendor gstPercent soldAs unitsPerPack";

const r2 = (n) => Number((n || 0).toFixed(2));
const pctOf = (part, whole) => (whole > 0 ? Number(((part / whole) * 100).toFixed(1)) : null);
// Server-local calendar day, the same day boundary resolveRange uses.
export const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// A sensible chart resolution for the range when none is asked for.
export function autoGranularity(start, end) {
  const days = (end - start) / DAY;
  if (days <= 31) return "day";
  if (days <= 120) return "week";
  if (days <= 730) return "month";
  return "quarter";
}

// Buckets follow server-local calendar days, like the report's date range.
function bucketKey(date, granularity) {
  if (granularity === "week") return isoDay(new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7))); // Monday
  if (granularity === "month") return isoDay(date).slice(0, 7);
  if (granularity === "quarter") return `${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`;
  if (granularity === "year") return String(date.getFullYear());
  if (granularity === "fy") return `FY${date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1}`;
  return isoDay(date);
}

function bucketLabel(key, granularity) {
  const dm = (iso) => `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
  if (granularity === "week") return `Wk of ${dm(key)}`;
  if (granularity === "month") return `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
  if (granularity === "quarter") return `${key.slice(5)} ${key.slice(0, 4)}`;
  if (granularity === "year") return key;
  if (granularity === "fy") return `FY ${key.slice(2)}-${String((Number(key.slice(2)) + 1) % 100).padStart(2, "0")}`;
  return `${dm(key)} ${key.slice(0, 4)}`;
}

// The previous period of the same length, ending just before this one starts.
export function previousRange(start, end) {
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(start.getTime() - (end.getTime() - start.getTime() + 1));
  return { start: prevStart, end: prevEnd };
}

const nearestSlab = (rate) => GST_SLABS.reduce((best, s) => (Math.abs(s - rate) < Math.abs(best - rate) ? s : best), 0);

function addTo(map, key, init, fn) {
  const bucket = map.get(key) || init();
  fn(bucket);
  map.set(key, bucket);
  return bucket;
}

// Headline KPIs pulled from a computeSummary result, for the cards and the
// period-over-period comparison.
function kpisOf(summary) {
  return {
    revenue: summary.revenue,
    cogs: summary.cogs,
    grossProfit: summary.grossProfit,
    expenses: summary.expenses,
    expiredWriteOff: summary.expiredWriteOff,
    purchases: summary.totalPurchases,
    profit: summary.profit,
    grossMarginPct: summary.grossMarginPct,
    netMarginPct: summary.netMarginPct,
    salesCount: summary.salesCount,
    avgBillValue: summary.salesCount > 0 ? r2(summary.revenue / summary.salesCount) : 0,
    outputGst: summary.outputGst,
    inputGst: summary.inputGst,
    netGst: summary.netGst,
    ebitda: summary.ebitda,
    roiPct: summary.roiPct,
  };
}

export async function buildAnalytics(start, end, filters = {}, { granularity, compare = true } = {}) {
  const { paymentMode = null, supplier = null, category = null, brand = null, product = null } = filters;
  const g = GRANULARITIES.includes(granularity) ? granularity : autoGranularity(start, end);
  const lineMatches = productMatcher(filters);
  const purchaseLineMatches = productMatcher(filters, { ignoreSupplier: true });
  const productFiltered = Boolean(category || brand || product);
  const range = { $gte: start, $lte: end };
  const prev = previousRange(start, end);

  const [summary, prevSummary, sales, purchases, expenses, clearances, stock, customerDue, vendorDue] = await Promise.all([
    computeSummary(start, end, filters),
    compare ? computeSummary(prev.start, prev.end, filters) : null,
    Sale.find({ paymentStatus: "completed", createdAt: range }).populate("items.product", LINE_PRODUCT_FIELDS),
    Purchase.find({ date: range }).populate("items.product", LINE_PRODUCT_FIELDS),
    Expense.find({ date: range }).sort({ date: 1 }),
    StockLedger.find({ type: "stock-clearance", createdAt: range }).populate("product", LINE_PRODUCT_FIELDS),
    buildStockReport({ scope: productScope(filters) }),
    customerOutstandingMap(),
    vendorOutstandingMap(),
  ]);

  // Every bucket of the range exists, even with no activity, so charts show gaps as zero.
  const buckets = new Map();
  const newBucket = (key) => ({ key, label: bucketLabel(key, g), revenue: 0, cogs: 0, expenses: 0, writeOff: 0, purchases: 0, outputGst: 0, bills: 0 });
  for (let t = start.getTime(); t <= end.getTime(); t += DAY) {
    const key = bucketKey(new Date(t), g);
    if (!buckets.has(key)) buckets.set(key, newBucket(key));
  }
  const bucketFor = (date) => {
    const key = bucketKey(date, g);
    if (!buckets.has(key)) buckets.set(key, newBucket(key));
    return buckets.get(key);
  };

  const products = new Map();
  const brands = new Map();
  const categories = new Map();
  const modes = new Map();
  const customers = new Map();
  const outputSlabs = new Map();
  const productStats = () => ({ revenue: 0, cogs: 0, gst: 0, qtyPacks: 0, bills: new Set() });

  // Same per-line rules as computeSummary: bill discount shared across lines
  // by line value, revenue net of GST and discount, cost = FIFO batch cost.
  for (const sale of sales) {
    if (paymentMode && sale.paymentMode !== paymentMode) continue;
    let matched = false;
    for (const item of sale.items) {
      if (!lineMatches(item.product)) continue;
      matched = true;
      const lineDiscount = sale.subtotal > 0 ? sale.discount * (item.amount / sale.subtotal) : 0;
      const lineNet = item.amount - lineDiscount;
      const p = item.product;
      const packs = p?.soldAs === "pack-and-loose" && p.unitsPerPack ? item.internalQtyDeducted / p.unitsPerPack : item.internalQtyDeducted;
      const add = (s) => {
        s.revenue += lineNet;
        s.cogs += item.costAmount;
        s.gst += item.gstAmount;
        s.qtyPacks += packs;
        s.bills.add(String(sale._id));
      };

      const bucket = bucketFor(sale.createdAt);
      bucket.revenue += lineNet;
      bucket.cogs += item.costAmount;
      bucket.outputGst += item.gstAmount;

      const productKey = p?._id ? String(p._id) : `name:${item.name}`;
      addTo(products, productKey, () => ({ productId: p?._id || null, name: p?.name || item.name, code: p?.productCode || "", brand: p?.brand || "", category: p?.category ? String(p.category) : null, ...productStats() }), add);
      addTo(brands, p?.brand || "Unbranded", productStats, add);
      addTo(categories, p?.category ? String(p.category) : "uncategorized", productStats, add);
      addTo(modes, sale.paymentMode, productStats, add);
      if (sale.customer) addTo(customers, String(sale.customer), productStats, add);

      const slab = GST_SLABS.includes(item.gstPercent) ? item.gstPercent : nearestSlab(item.gstPercent);
      addTo(outputSlabs, slab, () => ({ taxable: 0, gst: 0 }), (s) => {
        s.taxable += lineNet;
        s.gst += item.gstAmount;
      });
    }
    if (matched) bucketFor(sale.createdAt).bills += 1;
  }

  // Purchases: supplier is the purchase's own vendor; with product-level
  // filters only the matching lines count (same rule as computeSummary).
  const suppliers = new Map();
  const inputSlabs = new Map();
  for (const p of purchases) {
    if (supplier && String(p.vendor) !== supplier) continue;
    let amount = 0;
    let gst = 0;
    for (const item of p.items) {
      if (productFiltered && !purchaseLineMatches(item.product)) continue;
      amount += item.lineAmount + item.lineGst;
      gst += item.lineGst;
      const rate = item.lineAmount > 0 ? (item.lineGst / item.lineAmount) * 100 : item.product?.gstPercent || 0;
      addTo(inputSlabs, nearestSlab(rate), () => ({ taxable: 0, gst: 0 }), (s) => {
        s.taxable += item.lineAmount;
        s.gst += item.lineGst;
      });
    }
    if (!productFiltered) amount = p.total; // whole invoice, exactly as computeSummary counts it
    if (amount === 0 && productFiltered) continue;
    bucketFor(p.date).purchases += amount;
    addTo(suppliers, String(p.vendor), () => ({ purchases: 0, gst: 0, invoices: 0 }), (s) => {
      s.purchases += amount;
      s.gst += gst;
      s.invoices += 1;
    });
  }

  // Expenses and write-offs: computeSummary decides the filtered share (by
  // revenue for expenses, per product for write-offs); the buckets carry the
  // same share so they sum to its totals.
  const expenseShare = summary.totalExpenses > 0 ? summary.expenses / summary.totalExpenses : 0;
  const expenseCategories = new Map();
  for (const e of expenses) {
    bucketFor(e.date).expenses += e.amount * expenseShare;
    addTo(expenseCategories, e.category, () => ({ amount: 0, count: 0 }), (s) => {
      s.amount += e.amount;
      s.count += 1;
    });
  }
  const matchingClearances = clearances.filter((c) => lineMatches(c.product));
  const rawWriteOff = matchingClearances.reduce((s, c) => s + (c.costImpact || 0), 0);
  const writeOffShare = rawWriteOff > 0 ? summary.expiredWriteOff / rawWriteOff : 0;
  for (const c of matchingClearances) bucketFor(c.createdAt).writeOff += (c.costImpact || 0) * writeOffShare;

  // Names for the ids collected above.
  const categoryIds = [...categories.keys(), ...[...products.values()].map((p) => p.category)].filter((k) => k && k !== "uncategorized");
  const [categoryDocs, customerDocs, vendorDocs, expiringBatches] = await Promise.all([
    Category.find({ _id: { $in: categoryIds } }, "name"),
    Customer.find({ _id: { $in: [...new Set([...customers.keys(), ...customerDue.keys()])] } }, "name phone"),
    Vendor.find({ _id: { $in: [...new Set([...suppliers.keys(), ...vendorDue.keys()])] } }, "name phone gstNumber"),
    Batch.find({ qtyRemaining: { $gt: 0 }, isDeleted: { $ne: true }, expiryDate: { $lte: new Date(Date.now() + 90 * DAY) } })
      .populate({ path: "product", select: "name productCode soldAs unitsPerPack isActive", match: { isActive: true, ...productScope(filters) } })
      .sort({ expiryDate: 1 }),
  ]);
  const categoryName = new Map(categoryDocs.map((c) => [String(c._id), c.name]));
  const customerById = new Map(customerDocs.map((c) => [String(c._id), c]));
  const vendorById = new Map(vendorDocs.map((v) => [String(v._id), v]));

  const finishStats = (s) => ({
    revenue: r2(s.revenue),
    cogs: r2(s.cogs),
    grossProfit: r2(s.revenue - s.cogs),
    marginPct: pctOf(s.revenue - s.cogs, s.revenue),
    gst: r2(s.gst),
    qtyPacks: Number(s.qtyPacks.toFixed(2)),
    bills: s.bills.size,
    sharePct: pctOf(s.revenue, summary.revenue),
  });
  const byRevenue = (a, b) => b.revenue - a.revenue;

  // Period trend, with each bucket's net profit and growth vs the bucket before.
  let prevProfit = null;
  const trend = [...buckets.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((b) => {
      const grossProfit = b.revenue - b.cogs;
      const profit = grossProfit - b.expenses - b.writeOff;
      const growthPct = prevProfit !== null && prevProfit !== 0 ? Number((((profit - prevProfit) / Math.abs(prevProfit)) * 100).toFixed(1)) : null;
      prevProfit = profit;
      return {
        key: b.key,
        label: b.label,
        revenue: r2(b.revenue),
        cogs: r2(b.cogs),
        grossProfit: r2(grossProfit),
        expenses: r2(b.expenses),
        writeOff: r2(b.writeOff),
        profit: r2(profit),
        marginPct: pctOf(profit, b.revenue),
        purchases: r2(b.purchases),
        outputGst: r2(b.outputGst),
        sales: r2(b.revenue + b.outputGst), // billed to customers, incl. GST after discounts
        bills: b.bills,
        growthPct,
      };
    });

  const slabRows = (map) =>
    GST_SLABS.filter((rate) => map.has(rate)).map((rate) => {
      const s = map.get(rate);
      // Intra-state supply: GST splits equally into CGST and SGST.
      return { rate, taxable: r2(s.taxable), gst: r2(s.gst), cgst: r2(s.gst / 2), sgst: r2(s.gst / 2) };
    });
  const outputRows = slabRows(outputSlabs);
  const inputRows = slabRows(inputSlabs);
  const gstRates = [...new Set([...outputRows, ...inputRows].map((r) => r.rate))].sort((a, b) => a - b);

  // Stock on hand (current, not range-bound), valued at cost and selling rate.
  const stockRows = stock.rows.map((r) => ({ ...r, expectedProfit: r2(r.valueMrp - r.valueCost) }));
  const expiring = expiringBatches
    .filter((b) => b.product)
    .map((b) => {
      const unitCost = b.product.soldAs === "pack-and-loose" && b.product.unitsPerPack ? b.costPrice / b.product.unitsPerPack : b.costPrice;
      const daysLeft = Math.ceil((b.expiryDate - Date.now()) / DAY);
      return {
        productId: b.product._id,
        name: b.product.name,
        code: b.product.productCode,
        batchNo: b.batchNo,
        expiryDate: b.expiryDate,
        daysLeft,
        status: daysLeft < 0 ? "Expired" : daysLeft <= 30 ? "Within 30 days" : "Within 90 days",
        qtyRemaining: b.qtyRemaining,
        valueCost: r2(b.qtyRemaining * unitCost),
      };
    });

  const receivables = [...customerDue.entries()]
    .filter(([, due]) => due > 0)
    .map(([id, due]) => ({ customerId: id, name: customerById.get(id)?.name || "Unknown customer", phone: customerById.get(id)?.phone || "", outstanding: due }))
    .sort((a, b) => b.outstanding - a.outstanding);
  const payables = [...vendorDue.entries()]
    .filter(([id, due]) => due > 0 && (!supplier || id === supplier))
    .map(([id, due]) => ({ vendorId: id, name: vendorById.get(id)?.name || "Unknown supplier", outstanding: due }))
    .sort((a, b) => b.outstanding - a.outstanding);

  const cashFlow = await buildCashFlow(start, end);

  return {
    period: { from: isoDay(start), to: isoDay(end), granularity: g },
    previousPeriod: compare ? { from: isoDay(prev.start), to: isoDay(prev.end) } : null,
    filters: summary.filters,
    hasData: sales.length + purchases.length + expenses.length > 0,
    kpis: kpisOf(summary),
    previous: prevSummary ? kpisOf(prevSummary) : null,
    pnl: {
      revenue: summary.revenue,
      cogs: summary.cogs,
      grossProfit: summary.grossProfit,
      expenses: summary.expenses,
      totalExpenses: summary.totalExpenses,
      expiredWriteOff: summary.expiredWriteOff,
      profit: summary.profit,
      interest: summary.interest,
      taxes: summary.taxes,
      depreciation: summary.depreciation,
      amortization: summary.amortization,
      ebitda: summary.ebitda,
      grossMarginPct: summary.grossMarginPct,
      netMarginPct: summary.netMarginPct,
      ebitdaMarginPct: summary.ebitdaMarginPct,
      roiPct: summary.roiPct,
      expenseSharePct: summary.totalExpenses > 0 ? Number((expenseShare * 100).toFixed(1)) : null,
      openingInventory: summary.openingInventory,
      closingInventory: summary.closingInventory,
      inventoryTurnover: summary.inventoryTurnover,
    },
    trend,
    products: [...products.values()]
      .map((p) => ({ productId: p.productId, name: p.name, code: p.code, brand: p.brand || "Unbranded", category: categoryName.get(p.category) || "Uncategorized", ...finishStats(p) }))
      .sort(byRevenue),
    brands: [...brands.entries()].map(([name, s]) => ({ brand: name, ...finishStats(s) })).sort(byRevenue),
    categories: [...categories.entries()]
      .map(([id, s]) => ({ categoryId: id === "uncategorized" ? null : id, category: id === "uncategorized" ? "Uncategorized" : categoryName.get(id) || "Unknown", ...finishStats(s) }))
      .sort(byRevenue),
    paymentModes: [...modes.entries()].map(([mode, s]) => ({ mode, ...finishStats(s), collected: r2(s.revenue + s.gst) })).sort(byRevenue),
    expenseCategories: [...expenseCategories.entries()]
      .map(([cat, s]) => ({ category: cat, amount: r2(s.amount), count: s.count, sharePct: pctOf(s.amount, summary.totalExpenses) }))
      .sort((a, b) => b.amount - a.amount),
    suppliers: [...new Set([...suppliers.keys(), ...payables.map((p) => p.vendorId)])]
      .filter((id) => !supplier || id === supplier)
      .map((id) => {
        const s = suppliers.get(id) || { purchases: 0, gst: 0, invoices: 0 };
        const v = vendorById.get(id);
        return { vendorId: id, name: v?.name || "Unknown supplier", gstNumber: v?.gstNumber || "", purchases: r2(s.purchases), gst: r2(s.gst), invoices: s.invoices, outstanding: vendorDue.get(id) || 0 };
      })
      .sort((a, b) => b.purchases - a.purchases || b.outstanding - a.outstanding),
    customers: [...new Set([...customers.keys(), ...receivables.map((r) => r.customerId)])]
      .map((id) => {
        const s = customers.get(id);
        const c = customerById.get(id);
        return { customerId: id, name: c?.name || "Unknown customer", phone: c?.phone || "", revenue: s ? r2(s.revenue) : 0, bills: s ? s.bills.size : 0, outstanding: customerDue.get(id) || 0 };
      })
      .sort((a, b) => b.revenue - a.revenue || b.outstanding - a.outstanding),
    gst: {
      output: outputRows,
      input: inputRows,
      byRate: gstRates.map((rate) => {
        const out = outputRows.find((r) => r.rate === rate)?.gst || 0;
        const inp = inputRows.find((r) => r.rate === rate)?.gst || 0;
        return { rate, output: out, input: inp, net: r2(out - inp) };
      }),
      outputTotal: summary.outputGst,
      inputTotal: summary.inputGst,
      netPayable: summary.netGst,
    },
    inventory: {
      totals: {
        skuCount: stockRows.length,
        valueCost: stock.totals.totalValueCost,
        valueMrp: stock.totals.totalValueMrp,
        expectedProfit: r2(stock.totals.totalValueMrp - stock.totals.totalValueCost),
        lowStockCount: stockRows.filter((r) => r.isLowStock).length,
        outOfStockCount: stockRows.filter((r) => r.isOut).length,
        expiringValue: r2(expiring.reduce((s, b) => s + b.valueCost, 0)),
      },
      lowStock: stockRows.filter((r) => r.isLowStock).sort((a, b) => a.qty - b.qty),
      outOfStock: stockRows.filter((r) => r.isOut),
      expiring,
      topValue: [...stockRows].sort((a, b) => b.valueCost - a.valueCost).slice(0, 10),
    },
    receivables: { total: r2(receivables.reduce((s, r) => s + r.outstanding, 0)), rows: receivables },
    payables: { total: r2(payables.reduce((s, r) => s + r.outstanding, 0)), rows: payables },
    cashFlow,
  };
}

// Money actually moving in and out over the range, by mode - the Day Book's
// rules over a whole period: sales paid at the counter and later collections
// in; expenses (except non-cash ones), purchases paid up front and supplier
// payments out. Credit sales/purchases are shown separately as new
// receivables/payables, not cash. Shop-wide: cash isn't per product.
export async function buildCashFlow(start, end) {
  const range = { $gte: start, $lte: end };
  const sumBy = (Model, match, modeField, amountField) =>
    Model.aggregate([{ $match: match }, { $group: { _id: `$${modeField}`, total: { $sum: `$${amountField}` } } }]);

  const [salesIn, receiptsIn, expensesOut, purchasesOut, paymentsOut, creditSales, creditPurchases] = await Promise.all([
    sumBy(Sale, { paymentStatus: "completed", paymentMode: { $ne: "Credit" }, createdAt: range }, "paymentMode", "total"),
    sumBy(CustomerPayment, { date: range }, "mode", "amount"),
    sumBy(Expense, { paymentMode: { $ne: "Non-cash" }, date: range }, "paymentMode", "amount"),
    sumBy(Purchase, { paymentMode: { $ne: "Credit" }, date: range }, "paymentMode", "total"),
    sumBy(SupplierPayment, { date: range }, "mode", "amount"),
    sumBy(Sale, { paymentStatus: "completed", paymentMode: "Credit", createdAt: range }, "paymentMode", "total"),
    sumBy(Purchase, { paymentMode: "Credit", date: range }, "paymentMode", "total"),
  ]);

  const modes = new Map();
  const bump = (rows, field) =>
    rows.forEach((r) => {
      const m = modes.get(r._id) || { mode: r._id, inflow: 0, outflow: 0 };
      m[field] += r.total;
      modes.set(r._id, m);
    });
  bump(salesIn, "inflow");
  bump(receiptsIn, "inflow");
  bump(expensesOut, "outflow");
  bump(purchasesOut, "outflow");
  bump(paymentsOut, "outflow");

  const total = (rows) => r2(rows.reduce((s, r) => s + r.total, 0));
  const byMode = [...modes.values()].map((m) => ({ mode: m.mode, inflow: r2(m.inflow), outflow: r2(m.outflow), net: r2(m.inflow - m.outflow) }));
  const inflow = r2(byMode.reduce((s, m) => s + m.inflow, 0));
  const outflow = r2(byMode.reduce((s, m) => s + m.outflow, 0));
  return {
    inflow,
    outflow,
    net: r2(inflow - outflow),
    byMode: byMode.sort((a, b) => b.inflow + b.outflow - (a.inflow + a.outflow)),
    lines: [
      { label: "Counter sales received", amount: total(salesIn), direction: "in" },
      { label: "Customer payments collected", amount: total(receiptsIn), direction: "in" },
      { label: "Expenses paid", amount: total(expensesOut), direction: "out" },
      { label: "Purchases paid on delivery", amount: total(purchasesOut), direction: "out" },
      { label: "Supplier payments made", amount: total(paymentsOut), direction: "out" },
    ],
    newReceivables: total(creditSales),
    newPayables: total(creditPurchases),
  };
}

// Every money movement in the range as one list, newest first - sales (void
// ones included, marked), purchases, expenses, customer receipts and supplier
// payments. Product-level filters keep bills/invoices with a matching line
// and drop records not tied to products (expenses, receipts); a supplier
// filter keeps that supplier's purchases and payments.
export async function buildTransactions(start, end, filters = {}, { type = "", q = "" } = {}) {
  const { paymentMode, category, brand, product, supplier } = filters;
  const productFiltered = Boolean(category || brand || product);
  const anyProductFilter = productFiltered || Boolean(supplier);
  const lineMatches = productMatcher(filters);
  const purchaseLineMatches = productMatcher(filters, { ignoreSupplier: true });
  const range = { $gte: start, $lte: end };
  const wants = (t) => !type || type === t;

  const [sales, purchases, expenses, receipts, payments] = await Promise.all([
    wants("sale") ? Sale.find({ createdAt: range, ...(paymentMode ? { paymentMode } : {}) }).populate("customer", "name").populate("items.product", "category brand vendor") : [],
    wants("purchase") ? Purchase.find({ date: range, ...(paymentMode ? { paymentMode } : {}), ...(supplier ? { vendor: supplier } : {}) }).populate("vendor", "name").populate("items.product", "category brand vendor") : [],
    wants("expense") && !anyProductFilter ? Expense.find({ date: range, ...(paymentMode ? { paymentMode } : {}) }) : [],
    wants("receipt") && !anyProductFilter ? CustomerPayment.find({ date: range, ...(paymentMode ? { mode: paymentMode } : {}) }).populate("customer", "name") : [],
    wants("payment") && !productFiltered ? SupplierPayment.find({ date: range, ...(paymentMode ? { mode: paymentMode } : {}), ...(supplier ? { vendor: supplier } : {}) }).populate("vendor", "name") : [],
  ]);

  const rows = [
    ...sales
      .filter((s) => !anyProductFilter || s.items.some((i) => lineMatches(i.product)))
      .map((s) => ({
        id: String(s._id),
        date: s.createdAt,
        type: "Sale",
        ref: s.billNo,
        party: s.customer?.name || "Walk-in",
        mode: s.paymentMode,
        taxable: r2(s.subtotal - s.discount),
        gst: s.gstAmount,
        amount: s.total,
        direction: "in",
        status: s.paymentStatus === "void" ? "Void" : s.paymentMode === "Credit" && (s.amountPaid ?? s.total) < s.total ? "Due" : "Paid",
      })),
    ...purchases
      .filter((p) => !productFiltered || p.items.some((i) => purchaseLineMatches(i.product)))
      .map((p) => ({
        id: String(p._id),
        date: p.date,
        type: "Purchase",
        ref: p.invoiceNo,
        party: p.vendor?.name || "Unknown supplier",
        mode: p.paymentMode,
        taxable: p.subtotal,
        gst: p.gstAmount,
        amount: p.total,
        direction: "out",
        status: (p.amountPaid ?? p.total) < p.total ? "Due" : "Paid",
      })),
    ...expenses.map((e) => ({
      id: String(e._id),
      date: e.date,
      type: "Expense",
      ref: e.category,
      party: e.notes || "",
      mode: e.paymentMode,
      taxable: e.amount,
      gst: 0,
      amount: e.amount,
      direction: "out",
      status: "Paid",
    })),
    ...receipts.map((p) => ({
      id: String(p._id),
      date: p.date,
      type: "Payment Received",
      ref: p.paymentNo,
      party: p.customer?.name || "Unknown customer",
      mode: p.mode,
      taxable: p.amount,
      gst: 0,
      amount: p.amount,
      direction: "in",
      status: "Received",
    })),
    ...payments.map((p) => ({
      id: String(p._id),
      date: p.date,
      type: "Payment Made",
      ref: p.paymentNo,
      party: p.vendor?.name || "Unknown supplier",
      mode: p.mode,
      taxable: p.amount,
      gst: 0,
      amount: p.amount,
      direction: "out",
      status: "Paid",
    })),
  ];

  const term = String(q || "").trim().toLowerCase();
  const filtered = term ? rows.filter((r) => [r.ref, r.party, r.type, r.mode].some((v) => String(v).toLowerCase().includes(term))) : rows;
  return filtered.sort((a, b) => b.date - a.date);
}

// Product master with selling vs purchase price and margin, from the same
// stock report as the inventory figures.
export async function buildCatalog(filters = {}) {
  const { rows } = await buildStockReport({ scope: productScope(filters) });
  return rows.map((r) => ({
    productId: r.productId,
    name: r.name,
    brand: r.brand || "",
    sku: r.productCode,
    category: r.category,
    supplier: r.supplier,
    sellingPrice: r.packRate,
    purchasePrice: r.purchasePrice,
    gstPercent: r.gstPercent,
    qtyDisplay: r.qtyDisplay,
    qty: r.qty,
    status: r.isOut ? "Out of stock" : r.isLowStock ? "Low stock" : "In stock",
    marginPct: r.purchasePrice !== null && r.packRate > 0 ? Number((((r.packRate - r.purchasePrice) / r.packRate) * 100).toFixed(1)) : null,
    valueCost: r.valueCost,
    valueMrp: r.valueMrp,
  }));
}
