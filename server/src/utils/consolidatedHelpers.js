import Sale from "../models/Sale.js";
import Purchase from "../models/Purchase.js";
import CustomerPayment from "../models/CustomerPayment.js";
import SupplierPayment from "../models/SupplierPayment.js";
import { computeSummary } from "./summaryHelpers.js";
import { buildAnalytics, isoDay } from "./analyticsHelpers.js";
import { balanceAsOf } from "./dayBookHelpers.js";
import { customerOutstandingMap, vendorOutstandingMap } from "./ledgerHelpers.js";

// Medical Shop Consolidated Financial Report: one view of the shop's
// financial health. Period figures (sales, profit, GST, cash flow) come from
// buildAnalytics/computeSummary like every other report; balances (cash,
// receivables, payables, inventory) are taken as of the report's end date;
// expiry figures are as of today, since expiry is about the stock on hand now.

const r2 = (n) => Number((n || 0).toFixed(2));
const pct = (part, whole) => (whole ? Number(((part / whole) * 100).toFixed(1)) : null);
const change = (cur, prev) => (prev ? Number((((cur - prev) / Math.abs(prev)) * 100).toFixed(1)) : null);

async function sum(Model, match, field) {
  const [row] = await Model.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: `$${field}` } } }]);
  return row?.total || 0;
}

// Receivables/payables as they stood at `end`: today's outstanding with
// everything recorded after `end` undone (credit raised after it removed,
// payments received/made after it added back). At end = today this is
// exactly the Customers / Suppliers outstanding totals.
async function outstandingAsOf(end, supplier) {
  const after = { $gt: end };
  const vendorMatch = supplier ? { vendor: supplier } : {};
  const [customerNow, vendorNow, creditSalesAfter, receiptsAfter, creditPurchasesAfter, supplierPaymentsAfter] = await Promise.all([
    customerOutstandingMap(),
    vendorOutstandingMap(),
    sum(Sale, { paymentMode: "Credit", paymentStatus: { $ne: "void" }, customer: { $ne: null }, createdAt: after }, "total"),
    sum(CustomerPayment, { date: after }, "amount"),
    sum(Purchase, { paymentMode: "Credit", date: after, ...vendorMatch }, "total"),
    sum(SupplierPayment, { date: after, ...vendorMatch }, "amount"),
  ]);
  const receivablesNow = [...customerNow.values()].reduce((s, v) => s + v, 0);
  const payablesNow = supplier ? vendorNow.get(supplier) || 0 : [...vendorNow.values()].reduce((s, v) => s + v, 0);
  return {
    receivables: r2(Math.max(receivablesNow - creditSalesAfter + receiptsAfter, 0)),
    payables: r2(Math.max(payablesNow - creditPurchasesAfter + supplierPaymentsAfter, 0)),
  };
}

// Change vs the row before, for month-on-month / year-on-year tables.
function withChanges(rows) {
  return rows.map((row, i) => {
    const prev = rows[i - 1];
    return {
      ...row,
      salesChangePct: prev ? change(row.sales, prev.sales) : null,
      profitChangePct: prev ? change(row.profit, prev.profit) : null,
    };
  });
}

// The headline figures compared between periods.
function periodMetrics(s) {
  return {
    totalSales: r2(s.revenue + s.outputGst),
    revenue: s.revenue,
    purchases: s.totalPurchases,
    operatingExpenses: s.expenses,
    grossProfit: s.grossProfit,
    netProfit: s.profit,
    profitMarginPct: s.netMarginPct,
    gstPayable: s.netGst,
    bills: s.salesCount,
  };
}

export async function buildConsolidated(start, end, filters = {}, { granularity } = {}) {
  const fyStartYear = end.getMonth() >= 3 ? end.getFullYear() : end.getFullYear() - 1;
  const monthsFrom = new Date(end.getFullYear(), end.getMonth() - 11, 1);
  const yearsFrom = new Date(fyStartYear - 2, 3, 1); // three Indian financial years, Apr-Mar
  const lastYearStart = new Date(start.getFullYear() - 1, start.getMonth(), start.getDate());
  const lastYearEnd = new Date(end.getFullYear() - 1, end.getMonth(), end.getDate(), 23, 59, 59, 999);

  const [analytics, monthly, yearly, lastYear, cash, upi, outstanding] = await Promise.all([
    buildAnalytics(start, end, filters, { granularity }),
    buildAnalytics(monthsFrom, end, filters, { granularity: "month", compare: false }),
    buildAnalytics(yearsFrom, end, filters, { granularity: "fy", compare: false }),
    computeSummary(lastYearStart, lastYearEnd, filters),
    balanceAsOf("Cash", end),
    balanceAsOf("UPI", end),
    outstandingAsOf(end, filters.supplier),
  ]);

  const k = analytics.kpis;
  const pl = analytics.pnl;
  const now = Date.now();
  const expired = analytics.inventory.expiring.filter((b) => b.daysLeft < 0);
  const nearExpiry = analytics.inventory.expiring.filter((b) => b.daysLeft >= 0);
  const expiryGroup = (rows) => ({
    batches: rows.length,
    products: new Set(rows.map((b) => String(b.productId))).size,
    qty: rows.reduce((s, b) => s + b.qtyRemaining, 0),
    value: r2(rows.reduce((s, b) => s + b.valueCost, 0)),
  });

  const cashBalance = r2(cash + upi);
  const inventoryValue = pl.closingInventory; // stock at cost as of the end date
  const workingCapital = r2(cashBalance + outstanding.receivables + inventoryValue - outstanding.payables);
  const current = {
    totalSales: r2(k.revenue + k.outputGst),
    revenue: k.revenue,
    purchases: k.purchases,
    operatingExpenses: pl.expenses,
    grossProfit: k.grossProfit,
    netProfit: k.profit,
    profitMarginPct: k.netMarginPct,
    gstPayable: k.netGst,
    bills: k.salesCount,
  };

  return {
    period: analytics.period,
    previousPeriod: analytics.previousPeriod,
    lastYearPeriod: { from: isoDay(lastYearStart), to: isoDay(lastYearEnd) },
    asOf: isoDay(end),
    expiryAsOf: isoDay(new Date(now)),
    hasData: analytics.hasData,
    metrics: {
      ...current,
      grossMarginPct: k.grossMarginPct,
      expiredWriteOff: pl.expiredWriteOff,
      cogs: k.cogs,
      cashInHand: r2(cash),
      upiBalance: r2(upi),
      cashBalance,
      receivables: outstanding.receivables,
      payables: outstanding.payables,
      inventoryValue,
      inventoryValueAtSelling: analytics.inventory.totals.valueMrp,
      workingCapital,
      outputGst: k.outputGst,
      inputGst: k.inputGst,
      netCashFlow: analytics.cashFlow.net,
      cashInflow: analytics.cashFlow.inflow,
      cashOutflow: analytics.cashFlow.outflow,
      ebitda: pl.ebitda,
      expired: expiryGroup(expired),
      nearExpiry: expiryGroup(nearExpiry),
      nearExpiry30: expiryGroup(nearExpiry.filter((b) => b.daysLeft <= 30)),
    },
    comparisons: {
      previous: analytics.previous
        ? periodMetrics({
            revenue: analytics.previous.revenue,
            outputGst: analytics.previous.outputGst,
            totalPurchases: analytics.previous.purchases,
            expenses: analytics.previous.expenses,
            grossProfit: analytics.previous.grossProfit,
            profit: analytics.previous.profit,
            netMarginPct: analytics.previous.netMarginPct,
            netGst: analytics.previous.netGst,
            salesCount: analytics.previous.salesCount,
          })
        : null,
      lastYear: periodMetrics(lastYear),
    },
    monthly: withChanges(monthly.trend),
    yearly: withChanges(yearly.trend),
    expiry: { expired, nearExpiry },
    breakdowns: {
      expenseCategories: analytics.expenseCategories,
      paymentModes: analytics.paymentModes,
      categories: analytics.categories,
      cashFlow: analytics.cashFlow,
      receivables: analytics.receivables,
      payables: analytics.payables,
      gst: analytics.gst,
    },
    sharePctOfRevenue: {
      cogs: pct(k.cogs, k.revenue),
      expenses: pct(pl.expenses, k.revenue),
      profit: k.netMarginPct,
    },
    analytics,
  };
}
