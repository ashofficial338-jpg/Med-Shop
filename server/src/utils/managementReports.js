import Customer from "../models/Customer.js";
import CustomerPayment from "../models/CustomerPayment.js";
import Purchase from "../models/Purchase.js";
import Sale from "../models/Sale.js";
import Vendor from "../models/Vendor.js";
import { autoGranularity, bucketKey, bucketLabel, isoDay, previousRange } from "./analyticsHelpers.js";
import { customerOutstandingMap, vendorOutstandingMap } from "./ledgerHelpers.js";
import { computeSummary } from "./summaryHelpers.js";
import { PURCHASE_STOCK_REPORTS } from "./purchaseReports.js";

// Management Reports: every sales, purchase and business report, worked out
// from the bills and purchases themselves each time it is opened - nothing is
// stored, so an entry added, edited, voided or deleted is in (or out of) every
// report at once. One engine serves the screen, the Excel file and the PDF.
//
// The figures follow the same rules as the dashboard: void bills don't count;
// a bill's discount is shared over its lines; profit is sales before GST less
// the batch cost of what was sold. With a product filter only that product's
// lines count, and what was paid is shared in proportion.

const r2 = (n) => Number((n || 0).toFixed(2));
const pct = (part, whole) => (whole ? Number(((part / whole) * 100).toFixed(1)) : 0);
const growth = (cur, prev) => (prev ? Number((((cur - prev) / Math.abs(prev)) * 100).toFixed(1)) : null);
const DAY = 86400000;
const WALK_IN = "walk-in";
const packsOf = (product, units) => (product?.soldAs === "pack-and-loose" && product.unitsPerPack ? units / product.unitsPerPack : units);

// ---------- the records ----------

// Every bill in the range as { date, party, lines, totals }.
async function salesIn(start, end, { customer, product } = {}) {
  const filter = { paymentStatus: "completed", ...(start || end ? { createdAt: { ...(start ? { $gte: start } : {}), $lte: end } } : {}) };
  if (customer === WALK_IN) filter.customer = null;
  else if (customer) filter.customer = customer;
  if (product) filter["items.product"] = product;
  const docs = await Sale.find(filter).populate("customer", "name phone").populate("items.product", "name productCode soldAs unitsPerPack packUnit").sort({ createdAt: 1 }).lean();
  return docs.map((s) => {
    const lines = s.items
      .filter((i) => !product || String(i.product?._id || i.product) === String(product))
      .map((i) => {
        const net = i.amount - (s.subtotal > 0 ? s.discount * (i.amount / s.subtotal) : 0);
        // A discount bigger than the goods' value eats into the GST part too;
        // the total is what was billed either way.
        return { productId: String(i.product?._id || i.product), name: i.product?.name || i.name, code: i.product?.productCode || "", unit: i.product?.packUnit || "", packs: packsOf(i.product, i.internalQtyDeducted), taxable: net, gst: i.gstAmount, cost: i.costAmount };
      });
    const sum = (k) => lines.reduce((t, l) => t + l[k], 0);
    const total = sum("taxable") + sum("gst");
    const share = s.total > 0 ? Math.min(total / s.total, 1) : 1;
    const paid = (s.amountPaid ?? s.total) * share;
    return {
      id: String(s._id),
      ref: s.billNo,
      date: s.createdAt,
      mode: s.paymentMode,
      partyId: s.customer ? String(s.customer._id) : WALK_IN,
      party: s.customer?.name || "Walk-in",
      phone: s.customer?.phone || "",
      lines,
      taxable: sum("taxable"),
      gst: sum("gst"),
      cost: sum("cost"),
      packs: sum("packs"),
      total,
      paid,
      balance: total - paid,
    };
  });
}

async function purchasesIn(start, end, { vendor, product } = {}) {
  const filter = start || end ? { date: { ...(start ? { $gte: start } : {}), $lte: end } } : {};
  if (vendor === "none") filter.vendor = null;
  else if (vendor) filter.vendor = vendor;
  if (product) filter["items.product"] = product;
  const docs = await Purchase.find(filter).populate("vendor", "name phone").populate("items.product", "name productCode packUnit").sort({ date: 1 }).lean();
  return docs.map((p) => {
    const lines = p.items
      .filter((i) => !product || String(i.product?._id || i.product) === String(product))
      .map((i) => ({ productId: String(i.product?._id || i.product), name: i.product?.name || "Deleted product", code: i.product?.productCode || "", unit: i.product?.packUnit || "", packs: i.qtyPacks, taxable: i.lineAmount, gst: i.lineGst }));
    const sum = (k) => lines.reduce((t, l) => t + l[k], 0);
    const total = sum("taxable") + sum("gst");
    const share = p.total > 0 ? Math.min(total / p.total, 1) : 1;
    const paid = (p.amountPaid ?? p.total) * share;
    return {
      id: String(p._id),
      ref: p.invoiceNo,
      date: p.date,
      mode: p.paymentMode,
      partyId: p.vendor ? String(p.vendor._id) : p.supplierName ? `name:${p.supplierName.toLowerCase()}` : "none",
      party: p.vendor?.name || p.supplierName || "No supplier",
      phone: p.vendor?.phone || "",
      lines,
      taxable: sum("taxable"),
      gst: sum("gst"),
      packs: sum("packs"),
      total,
      paid,
      balance: total - paid,
    };
  });
}

// ---------- shapes ----------

const col = (key, label, type = "text") => ({ key, label, type });
const addUp = (rows, keys) => Object.fromEntries(keys.map((k) => [k, r2(rows.reduce((s, r) => s + (r[k] || 0), 0))]));

function group(docs, keyOf, init, add) {
  const map = new Map();
  for (const d of docs) {
    const key = keyOf(d);
    if (!map.has(key)) map.set(key, init(d, key));
    add(map.get(key), d);
  }
  return [...map.values()];
}
const money = (o, keys) => {
  for (const k of keys) o[k] = r2(o[k]);
  return o;
};

const SALE_MONEY = ["taxable", "gst", "total", "cost", "profit", "paid", "balance"];
const addSale = (row, s) => {
  row.count += 1;
  row.packs += s.packs;
  for (const k of ["taxable", "gst", "total", "cost", "paid", "balance"]) row[k] += s[k];
  row.profit += s.taxable - s.cost;
  if (!row.last || s.date > row.last) row.last = s.date;
};
const zeroSale = () => ({ count: 0, packs: 0, taxable: 0, gst: 0, total: 0, cost: 0, profit: 0, paid: 0, balance: 0, last: null });
const PUR_MONEY = ["taxable", "gst", "total", "paid", "balance"];
const addPurchase = (row, p) => {
  row.count += 1;
  row.packs += p.packs;
  for (const k of PUR_MONEY) row[k] += p[k];
  if (!row.last || p.date > row.last) row.last = p.date;
};
const zeroPurchase = () => ({ count: 0, packs: 0, taxable: 0, gst: 0, total: 0, paid: 0, balance: 0, last: null });

function byPeriod(docs, granularity, zero, add, keys) {
  return group(docs, (d) => bucketKey(new Date(d.date), granularity), (d, key) => ({ key, period: bucketLabel(key, granularity), ...zero() }), add)
    .map((r) => money(r, keys))
    .sort((a, b) => a.key.localeCompare(b.key));
}
function byParty(docs, zero, add, keys) {
  return group(docs, (d) => d.partyId, (d) => ({ id: d.partyId, party: d.party, phone: d.phone, ...zero() }), add)
    .map((r) => money(r, keys))
    .sort((a, b) => b.total - a.total);
}
function byProduct(docs) {
  const rows = new Map();
  for (const d of docs) {
    for (const l of d.lines) {
      const r = rows.get(l.productId) || { id: l.productId, product: l.name, code: l.code, unit: l.unit, packs: 0, taxable: 0, gst: 0, total: 0, cost: 0, profit: 0, entries: new Set(), last: null };
      r.packs += l.packs;
      r.taxable += l.taxable;
      r.gst += l.gst;
      r.total += l.taxable + l.gst;
      r.cost += l.cost || 0;
      r.profit += l.taxable - (l.cost || 0);
      r.entries.add(d.id);
      if (!r.last || d.date > r.last) r.last = d.date;
      rows.set(l.productId, r);
    }
  }
  return [...rows.values()]
    .map(({ entries, ...r }) => money({ ...r, packs: Number(r.packs.toFixed(2)), count: entries.size, avgRate: r.packs ? r.taxable / r.packs : 0 }, ["taxable", "gst", "total", "cost", "profit", "avgRate"]))
    .sort((a, b) => b.total - a.total);
}

const periodReport = (side, granularity) => async (ctx) => {
  if (side === "sales") {
    const rows = byPeriod(await salesIn(ctx.start, ctx.end, ctx), granularity, zeroSale, addSale, SALE_MONEY);
    return {
      columns: [col("period", "Period"), col("count", "Bills", "int"), col("taxable", "Sales before GST", "money"), col("gst", "GST", "money"), col("total", "Total sales", "money"), col("profit", "Profit", "money"), col("paid", "Received", "money"), col("balance", "Pending", "money")],
      rows,
      totals: addUp(rows, ["count", "taxable", "gst", "total", "profit", "paid", "balance"]),
      chart: { type: "bar", x: "period", series: [{ key: "total", label: "Sales" }] },
    };
  }
  const rows = byPeriod(await purchasesIn(ctx.start, ctx.end, ctx), granularity, zeroPurchase, addPurchase, PUR_MONEY);
  return {
    columns: [col("period", "Period"), col("count", "Purchases", "int"), col("taxable", "Amount before GST", "money"), col("gst", "GST", "money"), col("total", "Total purchases", "money"), col("paid", "Paid", "money"), col("balance", "Pending", "money")],
    rows,
    totals: addUp(rows, ["count", "taxable", "gst", "total", "paid", "balance"]),
    chart: { type: "bar", x: "period", series: [{ key: "total", label: "Purchases" }] },
  };
};

// Unpaid bills / purchases as they stand today, up to the end date.
const pendingReport = (side) => async (ctx) => {
  const docs = side === "sales" ? await salesIn(null, ctx.end, ctx) : await purchasesIn(null, ctx.end, ctx);
  const rows = docs
    .filter((d) => d.mode === "Credit" && d.balance > 0.005)
    .map((d) => ({ id: d.id, ref: d.ref, date: d.date, party: d.party, phone: d.phone, total: r2(d.total), paid: r2(d.paid), balance: r2(d.balance), days: Math.max(0, Math.floor((Date.now() - new Date(d.date)) / DAY)) }))
    .sort((a, b) => b.days - a.days);
  const parties = byParty(docs.filter((d) => d.mode === "Credit" && d.balance > 0.005), zeroSale, (row, d) => (row.balance += d.balance), ["balance"]).sort((a, b) => b.balance - a.balance);
  return {
    note: "Everything still unpaid, up to the end date.",
    summary: [
      { label: side === "sales" ? "To be received" : "To be paid", value: r2(rows.reduce((s, r) => s + r.balance, 0)), type: "money" },
      { label: side === "sales" ? "Customers" : "Suppliers", value: parties.length, type: "int" },
      { label: side === "sales" ? "Unpaid bills" : "Unpaid purchases", value: rows.length, type: "int" },
    ],
    columns: [col("ref", side === "sales" ? "Bill no" : "Invoice no"), col("date", "Date", "date"), col("party", side === "sales" ? "Customer" : "Supplier"), col("phone", "Phone"), col("total", "Total", "money"), col("paid", side === "sales" ? "Received" : "Paid", "money"), col("balance", "Pending", "money"), col("days", "Days", "int")],
    rows,
    totals: addUp(rows, ["total", "paid", "balance"]),
    chart: { type: "rank", x: "party", series: [{ key: "balance", label: "Pending" }], rows: parties.slice(0, 10).map((p) => ({ party: p.party, balance: p.balance })) },
  };
};

const productReport = (side) => async (ctx) => {
  const rows = byProduct(side === "sales" ? await salesIn(ctx.start, ctx.end, ctx) : await purchasesIn(ctx.start, ctx.end, ctx));
  return {
    columns: [
      col("product", "Product"),
      col("code", "Code"),
      col("packs", "Qty (packs)", "qty"),
      col("count", side === "sales" ? "Bills" : "Purchases", "int"),
      col("avgRate", "Average rate", "money"),
      col("taxable", "Before GST", "money"),
      col("gst", "GST", "money"),
      col("total", "Total", "money"),
      ...(side === "sales" ? [col("profit", "Profit", "money")] : []),
    ],
    rows,
    totals: addUp(rows, ["taxable", "gst", "total", ...(side === "sales" ? ["profit"] : [])]),
    chart: { type: "rank", x: "product", series: [{ key: "total", label: side === "sales" ? "Sales" : "Purchases" }], rows: rows.slice(0, 10) },
  };
};

// Every period of the range, also the ones with nothing in them.
function allBuckets(start, end, granularity) {
  const keys = new Map();
  for (let t = start.getTime(); t <= end.getTime(); t += DAY) keys.set(bucketKey(new Date(t), granularity), true);
  keys.set(bucketKey(end, granularity), true);
  return [...keys.keys()].sort();
}

async function comparison(ctx, granularity) {
  const [sales, purchases] = await Promise.all([salesIn(ctx.start, ctx.end, ctx), purchasesIn(ctx.start, ctx.end, ctx)]);
  const s = new Map(byPeriod(sales, granularity, zeroSale, addSale, SALE_MONEY).map((r) => [r.key, r]));
  const p = new Map(byPeriod(purchases, granularity, zeroPurchase, addPurchase, PUR_MONEY).map((r) => [r.key, r]));
  // A long range with years of nothing before the first entry starts there.
  const keys = allBuckets(ctx.start, ctx.end, granularity);
  const first = keys.findIndex((k) => s.has(k) || p.has(k));
  let prev = null;
  return (first < 0 ? [] : keys.slice(first)).map((key) => {
    const row = { key, period: bucketLabel(key, granularity), sales: s.get(key)?.total || 0, purchases: p.get(key)?.total || 0, profit: s.get(key)?.profit || 0 };
    row.difference = r2(row.sales - row.purchases);
    row.salesGrowth = prev ? growth(row.sales, prev.sales) : null;
    row.purchaseGrowth = prev ? growth(row.purchases, prev.purchases) : null;
    prev = row;
    return row;
  });
}
const COMPARE_CHART = (type) => ({ type, x: "period", series: [{ key: "sales", label: "Sales" }, { key: "purchases", label: "Purchases" }] });

// ---------- the reports ----------

const REPORTS = {
  "sales-daily": { group: "Sales", title: "Daily Sales Report", build: periodReport("sales", "day") },
  "sales-weekly": { group: "Sales", title: "Weekly Sales Report", build: periodReport("sales", "week") },
  "sales-monthly": { group: "Sales", title: "Monthly Sales Report", build: periodReport("sales", "month") },
  "sales-yearly": { group: "Sales", title: "Yearly Sales Report", build: periodReport("sales", "year") },
  "sales-customer": {
    group: "Sales",
    title: "Customer-wise Sales Report",
    build: async (ctx) => {
      const rows = byParty(await salesIn(ctx.start, ctx.end, ctx), zeroSale, addSale, SALE_MONEY);
      return {
        columns: [col("party", "Customer"), col("phone", "Phone"), col("count", "Bills", "int"), col("taxable", "Before GST", "money"), col("gst", "GST", "money"), col("total", "Total sales", "money"), col("paid", "Received", "money"), col("balance", "Pending", "money"), col("last", "Last bill", "date")],
        rows,
        totals: addUp(rows, ["count", "taxable", "gst", "total", "paid", "balance"]),
        chart: { type: "rank", x: "party", series: [{ key: "total", label: "Sales" }], rows: rows.slice(0, 10) },
      };
    },
  },
  "sales-product": { group: "Sales", title: "Product-wise Sales Report", build: productReport("sales") },
  "sales-summary": {
    group: "Sales",
    title: "Total Sales Summary",
    build: async (ctx) => {
      const docs = await salesIn(ctx.start, ctx.end, ctx);
      const t = money(docs.reduce((row, d) => (addSale(row, d), row), zeroSale()), SALE_MONEY);
      const rows = group(docs, (d) => d.mode, (d) => ({ mode: d.mode, ...zeroSale() }), addSale).map((r) => money({ ...r, share: pct(r.total, t.total) }, SALE_MONEY)).sort((a, b) => b.total - a.total);
      return {
        summary: [
          { label: "Total sales", value: t.total, type: "money" },
          { label: "Bills", value: t.count, type: "int" },
          { label: "Average bill", value: t.count ? r2(t.total / t.count) : 0, type: "money" },
          { label: "Sales before GST", value: t.taxable, type: "money" },
          { label: "GST collected", value: t.gst, type: "money" },
          { label: "Gross profit", value: t.profit, type: "money" },
          { label: "Received", value: t.paid, type: "money" },
          { label: "Pending", value: t.balance, type: "money" },
        ],
        columns: [col("mode", "Payment mode"), col("count", "Bills", "int"), col("taxable", "Before GST", "money"), col("gst", "GST", "money"), col("total", "Total sales", "money"), col("share", "Share", "pct")],
        rows,
        totals: addUp(rows, ["count", "taxable", "gst", "total"]),
        chart: { type: "rank", x: "mode", series: [{ key: "total", label: "Sales" }], rows },
      };
    },
  },
  "sales-pending": { group: "Sales", title: "Pending Payment Report", build: pendingReport("sales") },

  "purchase-daily": { group: "Purchase", title: "Daily Purchase Report", build: periodReport("purchase", "day") },
  "purchase-weekly": { group: "Purchase", title: "Weekly Purchase Report", build: periodReport("purchase", "week") },
  "purchase-monthly": { group: "Purchase", title: "Monthly Purchase Report", build: periodReport("purchase", "month") },
  "purchase-yearly": { group: "Purchase", title: "Yearly Purchase Report", build: periodReport("purchase", "year") },
  "purchase-vendor": {
    group: "Purchase",
    title: "Vendor-wise Purchase Report",
    build: async (ctx) => {
      const rows = byParty(await purchasesIn(ctx.start, ctx.end, ctx), zeroPurchase, addPurchase, PUR_MONEY);
      return {
        columns: [col("party", "Supplier"), col("phone", "Phone"), col("count", "Purchases", "int"), col("taxable", "Before GST", "money"), col("gst", "GST", "money"), col("total", "Total purchases", "money"), col("paid", "Paid", "money"), col("balance", "Pending", "money"), col("last", "Last purchase", "date")],
        rows,
        totals: addUp(rows, ["count", "taxable", "gst", "total", "paid", "balance"]),
        chart: { type: "rank", x: "party", series: [{ key: "total", label: "Purchases" }], rows: rows.slice(0, 10) },
      };
    },
  },
  "purchase-product": { group: "Purchase", title: "Product-wise Purchase Report", build: productReport("purchase") },
  "purchase-summary": {
    group: "Purchase",
    title: "Total Purchase Summary",
    build: async (ctx) => {
      const docs = await purchasesIn(ctx.start, ctx.end, ctx);
      const t = money(docs.reduce((row, d) => (addPurchase(row, d), row), zeroPurchase()), PUR_MONEY);
      const rows = group(docs, (d) => d.mode, (d) => ({ mode: d.mode, ...zeroPurchase() }), addPurchase).map((r) => money({ ...r, share: pct(r.total, t.total) }, PUR_MONEY)).sort((a, b) => b.total - a.total);
      return {
        summary: [
          { label: "Total purchases", value: t.total, type: "money" },
          { label: "Purchases", value: t.count, type: "int" },
          { label: "Average purchase", value: t.count ? r2(t.total / t.count) : 0, type: "money" },
          { label: "Amount before GST", value: t.taxable, type: "money" },
          { label: "GST paid", value: t.gst, type: "money" },
          { label: "Paid", value: t.paid, type: "money" },
          { label: "Pending", value: t.balance, type: "money" },
        ],
        columns: [col("mode", "Payment mode"), col("count", "Purchases", "int"), col("taxable", "Before GST", "money"), col("gst", "GST", "money"), col("total", "Total purchases", "money"), col("share", "Share", "pct")],
        rows,
        totals: addUp(rows, ["count", "taxable", "gst", "total"]),
        chart: { type: "rank", x: "mode", series: [{ key: "total", label: "Purchases" }], rows },
      };
    },
  },
  "purchase-pending": { group: "Purchase", title: "Pending Supplier Payment Report", build: pendingReport("purchase") },

  "sales-vs-purchase": {
    group: "Business",
    title: "Total Sales vs Total Purchase",
    build: async (ctx) => {
      const [sales, purchases] = await Promise.all([salesIn(ctx.start, ctx.end, ctx), purchasesIn(ctx.start, ctx.end, ctx)]);
      const s = money(sales.reduce((r, d) => (addSale(r, d), r), zeroSale()), SALE_MONEY);
      const p = money(purchases.reduce((r, d) => (addPurchase(r, d), r), zeroPurchase()), PUR_MONEY);
      const rows = [
        ["Entries", "count", "int"],
        ["Before GST", "taxable", "money"],
        ["GST", "gst", "money"],
        ["Total", "total", "money"],
        ["Paid", "paid", "money"],
        ["Pending", "balance", "money"],
      ].map(([label, k, type]) => ({ label, sales: s[k], purchases: p[k], difference: r2(s[k] - p[k]), type }));
      return {
        columns: [col("label", ""), col("sales", "Sales", "by-row"), col("purchases", "Purchases", "by-row"), col("difference", "Difference", "by-row")],
        rows,
        summary: [
          { label: "Total sales", value: s.total, type: "money" },
          { label: "Total purchases", value: p.total, type: "money" },
          { label: "Sales less purchases", value: r2(s.total - p.total), type: "money" },
          { label: "Gross profit on sales", value: s.profit, type: "money" },
        ],
        chart: { type: "bar", x: "label", series: [{ key: "value", label: "Amount" }], rows: [{ label: "Sales", value: s.total }, { label: "Purchases", value: p.total }] },
      };
    },
  },
  "monthly-comparison": {
    group: "Business",
    title: "Monthly Sales vs Purchase",
    build: async (ctx) => {
      const rows = await comparison(ctx, "month");
      return {
        columns: [col("period", "Month"), col("sales", "Sales", "money"), col("purchases", "Purchases", "money"), col("difference", "Difference", "money"), col("profit", "Profit", "money")],
        rows,
        totals: addUp(rows, ["sales", "purchases", "difference", "profit"]),
        chart: COMPARE_CHART("bar"),
      };
    },
  },
  "customer-performance": {
    group: "Business",
    title: "Customer Performance Analysis",
    build: async (ctx) => {
      const before = previousRange(ctx.start, ctx.end);
      const [now, prev, due] = await Promise.all([salesIn(ctx.start, ctx.end, ctx), salesIn(before.start, before.end, ctx), customerOutstandingMap()]);
      const was = new Map(byParty(prev, zeroSale, addSale, SALE_MONEY).map((r) => [r.id, r.total]));
      const list = byParty(now, zeroSale, addSale, SALE_MONEY);
      const all = list.reduce((s, r) => s + r.total, 0);
      const rows = list.map((r, i) => ({ ...r, rank: i + 1, avg: r2(r.total / r.count), share: pct(r.total, all), previous: was.get(r.id) || 0, growth: growth(r.total, was.get(r.id)), due: due.get(r.id) || 0 }));
      return {
        note: "Ranked by sales. Growth compares with the same number of days before.",
        columns: [col("rank", "Rank", "int"), col("party", "Customer"), col("count", "Bills", "int"), col("total", "Sales", "money"), col("share", "Share", "pct"), col("avg", "Average bill", "money"), col("profit", "Profit", "money"), col("growth", "Growth", "pct"), col("due", "Owes now", "money"), col("last", "Last bill", "date")],
        rows,
        totals: addUp(rows, ["count", "total", "profit", "due"]),
        chart: { type: "rank", x: "party", series: [{ key: "total", label: "Sales" }], rows: rows.slice(0, 10) },
      };
    },
  },
  "vendor-performance": {
    group: "Business",
    title: "Vendor Performance Analysis",
    build: async (ctx) => {
      const before = previousRange(ctx.start, ctx.end);
      const [now, prev, due] = await Promise.all([purchasesIn(ctx.start, ctx.end, ctx), purchasesIn(before.start, before.end, ctx), vendorOutstandingMap()]);
      const was = new Map(byParty(prev, zeroPurchase, addPurchase, PUR_MONEY).map((r) => [r.id, r.total]));
      const list = byParty(now, zeroPurchase, addPurchase, PUR_MONEY);
      const all = list.reduce((s, r) => s + r.total, 0);
      const rows = list.map((r, i) => ({ ...r, rank: i + 1, avg: r2(r.total / r.count), share: pct(r.total, all), previous: was.get(r.id) || 0, growth: growth(r.total, was.get(r.id)), due: due.get(r.id) || 0 }));
      return {
        note: "Ranked by purchases. Growth compares with the same number of days before.",
        columns: [col("rank", "Rank", "int"), col("party", "Supplier"), col("count", "Purchases", "int"), col("total", "Amount", "money"), col("share", "Share", "pct"), col("avg", "Average purchase", "money"), col("growth", "Growth", "pct"), col("due", "You owe now", "money"), col("last", "Last purchase", "date")],
        rows,
        totals: addUp(rows, ["count", "total", "due"]),
        chart: { type: "rank", x: "party", series: [{ key: "total", label: "Purchases" }], rows: rows.slice(0, 10) },
      };
    },
  },
  "best-sellers": {
    group: "Business",
    title: "Best-Selling Products",
    build: async (ctx) => {
      const list = byProduct(await salesIn(ctx.start, ctx.end, ctx));
      const all = list.reduce((s, r) => s + r.total, 0);
      const rows = list.map((r, i) => ({ ...r, rank: i + 1, share: pct(r.total, all), margin: pct(r.profit, r.taxable) }));
      return {
        columns: [col("rank", "Rank", "int"), col("product", "Product"), col("packs", "Qty (packs)", "qty"), col("count", "Bills", "int"), col("total", "Sales", "money"), col("share", "Share", "pct"), col("profit", "Profit", "money"), col("margin", "Margin", "pct"), col("last", "Last sold", "date")],
        rows,
        totals: addUp(rows, ["total", "profit"]),
        chart: { type: "rank", x: "product", series: [{ key: "total", label: "Sales" }], rows: rows.slice(0, 10) },
      };
    },
  },
  trends: {
    group: "Business",
    title: "Purchase and Sales Trends",
    build: async (ctx) => {
      const granularity = autoGranularity(ctx.start, ctx.end);
      const rows = await comparison(ctx, granularity);
      return {
        note: `By ${granularity}. Growth compares with the ${granularity} before.`,
        columns: [col("period", "Period"), col("sales", "Sales", "money"), col("salesGrowth", "Growth", "pct"), col("purchases", "Purchases", "money"), col("purchaseGrowth", "Growth", "pct"), col("profit", "Profit", "money")],
        rows,
        totals: addUp(rows, ["sales", "purchases", "profit"]),
        chart: COMPARE_CHART("line"),
      };
    },
  },
  "business-summary": {
    group: "Business",
    title: "Overall Business Performance Summary",
    build: async (ctx) => {
      const before = previousRange(ctx.start, ctx.end);
      const figures = async (start, end) => {
        const [sales, purchases, summary, receipts] = await Promise.all([
          salesIn(start, end, ctx),
          purchasesIn(start, end, ctx),
          computeSummary(start, end),
          CustomerPayment.aggregate([{ $match: { date: { $gte: start, $lte: end } } }, { $group: { _id: null, t: { $sum: "$amount" } } }]),
        ]);
        const s = money(sales.reduce((r, d) => (addSale(r, d), r), zeroSale()), SALE_MONEY);
        const p = money(purchases.reduce((r, d) => (addPurchase(r, d), r), zeroPurchase()), PUR_MONEY);
        const top = (rows, k) => rows[0]?.[k] || "—";
        return {
          s,
          p,
          summary,
          receipts: r2(receipts[0]?.t),
          topCustomer: top(byParty(sales.filter((d) => d.partyId !== WALK_IN), zeroSale, addSale, SALE_MONEY), "party"),
          topVendor: top(byParty(purchases, zeroPurchase, addPurchase, PUR_MONEY), "party"),
          best: top(byProduct(sales), "product"),
        };
      };
      const [a, b] = await Promise.all([figures(ctx.start, ctx.end), figures(before.start, before.end)]);
      const filtered = Boolean(ctx.customer || ctx.vendor || ctx.product);
      const [customersDue, vendorsDue] = await Promise.all([customerOutstandingMap(), vendorOutstandingMap()]);
      const total = (m) => r2([...m.values()].reduce((s, v) => s + v, 0));
      const row = (label, cur, prev, type = "money") => ({ label, current: cur, previous: prev, growth: typeof cur === "number" && typeof prev === "number" ? growth(cur, prev) : null, type });
      const rows = [
        row("Total sales (with GST)", a.s.total, b.s.total),
        row("Number of bills", a.s.count, b.s.count, "int"),
        row("Average bill", a.s.count ? r2(a.s.total / a.s.count) : 0, b.s.count ? r2(b.s.total / b.s.count) : 0),
        row("Sales before GST", a.s.taxable, b.s.taxable),
        row("Cost of goods sold", a.s.cost, b.s.cost),
        row("Gross profit", a.s.profit, b.s.profit),
        ...(filtered
          ? []
          : [
              row("Expenses", a.summary.expenses, b.summary.expenses),
              row("Expired stock written off", a.summary.expiredWriteOff, b.summary.expiredWriteOff),
              row("Net profit", a.summary.profit, b.summary.profit),
            ]),
        row("Total purchases (with GST)", a.p.total, b.p.total),
        row("Number of purchases", a.p.count, b.p.count, "int"),
        row("GST collected on sales", a.s.gst, b.s.gst),
        row("GST paid on purchases", a.p.gst, b.p.gst),
        ...(filtered ? [] : [row("Collected on credit bills", a.receipts, b.receipts)]),
        row("Best customer", a.topCustomer, b.topCustomer, "text"),
        row("Main supplier", a.topVendor, b.topVendor, "text"),
        row("Best-selling product", a.best, b.best, "text"),
      ];
      return {
        note: `Compared with ${isoDay(before.start).split("-").reverse().join("-")} to ${isoDay(before.end).split("-").reverse().join("-")}.`,
        summary: [
          { label: "Total sales", value: a.s.total, type: "money" },
          { label: "Total purchases", value: a.p.total, type: "money" },
          { label: filtered ? "Gross profit" : "Net profit", value: filtered ? a.s.profit : a.summary.profit, type: "money" },
          { label: "Customers owe (now)", value: total(customersDue), type: "money" },
          { label: "You owe suppliers (now)", value: total(vendorsDue), type: "money" },
          { label: "Stock value (now)", value: a.summary.totalStockValue, type: "money" },
        ],
        columns: [col("label", ""), col("current", "This period", "by-row"), col("previous", "Period before", "by-row"), col("growth", "Change", "pct")],
        rows,
        chart: { type: "bar", x: "label", series: [{ key: "value", label: "Amount" }], rows: [{ label: "Sales", value: a.s.total }, { label: "Purchases", value: a.p.total }, { label: "Gross profit", value: a.s.profit }] },
      };
    },
  },
};

Object.assign(REPORTS, PURCHASE_STOCK_REPORTS);

export const REPORT_LIST = Object.entries(REPORTS).map(([key, { group: g, title }]) => ({ key, group: g, title }));

export async function buildManagementReport(key, ctx) {
  const def = REPORTS[key];
  if (!def) return null;
  const body = await def.build(ctx);
  return { key, title: def.title, group: def.group, period: { from: isoDay(ctx.start), to: isoDay(ctx.end) }, ...body };
}

// "Customer: Ravi · Product: Dolo 650", for headings and file subtitles.
export async function describeReportFilters({ customer, vendor, productName }) {
  const parts = [];
  if (customer) parts.push(`Customer: ${customer === WALK_IN ? "Walk-in" : (await Customer.findById(customer, "name"))?.name || "Unknown"}`);
  if (vendor) parts.push(`Supplier: ${vendor === "none" ? "No supplier" : (await Vendor.findById(vendor, "name"))?.name || "Unknown"}`);
  if (productName) parts.push(`Product: ${productName}`);
  return parts.join(" · ");
}

// ---------- one customer / one supplier ----------

// Everything about one party: figures, every entry, and what they buy / supply.
export async function partySummary(side, id) {
  const docs = side === "customer" ? await salesIn(null, null, { customer: id }) : await purchasesIn(null, null, { vendor: id });
  const t = docs.reduce((row, d) => ((side === "customer" ? addSale : addPurchase)(row, d), row), zeroSale());
  money(t, SALE_MONEY);
  return {
    totals: { count: t.count, total: t.total, paid: t.paid, balance: t.balance, profit: side === "customer" ? t.profit : undefined, average: t.count ? r2(t.total / t.count) : 0, first: docs[0]?.date || null, last: t.last },
    entries: [...docs].reverse().map((d) => ({ id: d.id, ref: d.ref, date: d.date, mode: d.mode, items: d.lines.map((l) => ({ name: l.name, packs: Number(l.packs.toFixed(2)) })), total: r2(d.total), paid: r2(d.paid), balance: r2(d.balance) })),
    products: byProduct(docs).slice(0, 20),
    months: byPeriod(docs, "month", zeroSale, side === "customer" ? addSale : addPurchase, SALE_MONEY).map((m) => ({ key: m.key, period: m.period, count: m.count, total: m.total })),
  };
}

// Totals per party for the management lists, as a Map of id -> figures.
export async function partyTotals(side, ids) {
  const [Model, field, date, match] =
    side === "customer" ? [Sale, "customer", "$createdAt", { paymentStatus: "completed" }] : [Purchase, "vendor", "$date", {}];
  const rows = await Model.aggregate([
    { $match: { ...match, [field]: { $in: ids } } },
    { $group: { _id: `$${field}`, count: { $sum: 1 }, total: { $sum: "$total" }, paid: { $sum: { $ifNull: ["$amountPaid", "$total"] } }, last: { $max: date } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), { count: r.count, total: r2(r.total), paid: r2(r.paid), last: r.last }]));
}
