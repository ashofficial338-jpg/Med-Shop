import mongoose from "mongoose";
import Purchase from "../models/Purchase.js";
import PurchaseOrder from "../models/PurchaseOrder.js";
import PurchaseReturn from "../models/PurchaseReturn.js";
import Product from "../models/Product.js";
import Vendor from "../models/Vendor.js";
import StockLedger from "../models/StockLedger.js";
import { receivedByPo, progressOf } from "./purchaseOrders.js";
import { buildStockReport } from "./stockReportHelpers.js";

// Purchase Management & Stock reports for Management Reports (same engine:
// columns + rows + totals, shown on screen and downloaded as Excel / PDF).
// Quantities on purchase documents are in packs; stock movements are in the
// item's stock units (tablets / ml for items sold loose, else packs).

const r2 = (n) => Number((n || 0).toFixed(2));
const col = (key, label, type = "text") => ({ key, label, type });
const addUp = (rows, keys) => Object.fromEntries(keys.map((k) => [k, r2(rows.reduce((s, r) => s + (r[k] || 0), 0))]));
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const supplierName = (p) => p.vendor?.name || (p.supplierName ? `${p.supplierName} (unregistered)` : "No supplier");

function vendorFilter(ctx) {
  if (ctx.vendor === "none") return { vendor: null };
  if (ctx.vendor) return { vendor: oid(ctx.vendor) };
  return {};
}
const dateRange = (ctx, field = "date") => ({ [field]: { $gte: ctx.start, $lte: ctx.end } });

// Every movement type, grouped the way the stock formula reads:
// Available = Opening + Purchase Inward + Extra Stock - Purchase Return - Sales Outward +/- Other.
export const MOVEMENT_GROUP = {
  purchase: "inward",
  "purchase-edit": "inward",
  "extra-stock": "extra",
  "purchase-return": "returns",
  "purchase-return-cancel": "returns",
  sale: "sales",
  "sale-edit": "sales",
  "void-reversal": "sales",
  "manual-add": "other",
  "manual-reduce": "other",
  "stock-clearance": "other",
  "stock-audit": "other",
  "rack-transfer": "other",
};
const TYPE_LABEL = {
  purchase: "Purchase inward",
  "purchase-edit": "Purchase edit / cancel",
  "extra-stock": "Extra stock addition",
  "purchase-return": "Purchase return",
  "purchase-return-cancel": "Purchase return cancelled",
  sale: "Sale",
  "sale-edit": "Bill edit",
  "void-reversal": "Bill voided",
  "manual-add": "Manual add",
  "manual-reduce": "Manual reduce",
  "stock-clearance": "Expired write-off",
  "stock-audit": "Stock audit",
  "rack-transfer": "Rack transfer",
};
const zeroMoves = () => ({ opening: 0, inward: 0, extra: 0, returns: 0, sales: 0, other: 0, closing: 0 });

async function movements(ctx, productIds = null) {
  const match = {};
  if (productIds) match.product = { $in: productIds };
  const rows = await StockLedger.aggregate([
    { $match: { ...match, qtyChange: { $ne: 0 } } },
    {
      $group: {
        _id: { product: "$product", type: "$type", when: { $cond: [{ $lt: [{ $ifNull: ["$entryDate", "$createdAt"] }, ctx.start] }, "before", { $cond: [{ $gt: [{ $ifNull: ["$entryDate", "$createdAt"] }, ctx.end] }, "after", "in"] }] } },
        qty: { $sum: "$qtyChange" },
      },
    },
  ]);
  const byProduct = new Map();
  for (const r of rows) {
    const id = String(r._id.product);
    if (!byProduct.has(id)) byProduct.set(id, zeroMoves());
    const m = byProduct.get(id);
    if (r._id.when === "before") m.opening += r.qty;
    else if (r._id.when === "in") m[MOVEMENT_GROUP[r._id.type] || "other"] += r.qty;
  }
  for (const m of byProduct.values()) {
    m.returns = -m.returns; // shown as quantities going out
    m.sales = -m.sales;
    m.closing = m.opening + m.inward + m.extra - m.returns - m.sales + m.other;
  }
  return byProduct;
}

export const PURCHASE_STOCK_REPORTS = {
  "po-register": {
    group: "Inventory",
    title: "Purchase Order Report",
    build: async (ctx) => {
      const filter = { ...dateRange(ctx), ...(ctx.vendor && ctx.vendor !== "none" ? { vendor: oid(ctx.vendor) } : {}), ...(ctx.product ? { "items.product": oid(ctx.product) } : {}) };
      if (ctx.vendor === "none") return { columns: poColumns(), rows: [], note: "Purchase orders always have a supplier." };
      const pos = await PurchaseOrder.find(filter).populate("vendor", "name").sort({ date: -1, createdAt: -1 }).lean();
      const received = await receivedByPo(pos.map((p) => p._id));
      const rows = pos.map((po) => {
        const pr = progressOf(po, received.get(String(po._id)));
        return { id: String(po._id), ref: po.poNo, date: po.date, party: po.vendor?.name || "", status: po.status, ordered: pr.ordered, received: pr.received, pending: po.status === "Cancelled" ? 0 : pr.pending, taxable: r2(po.subtotal), gst: r2(po.gstAmount), total: r2(po.total), expected: po.expectedDate };
      });
      const live = rows.filter((r) => r.status !== "Cancelled");
      return {
        columns: poColumns(),
        rows,
        totals: addUp(live, ["ordered", "received", "pending", "taxable", "gst", "total"]),
        summary: [
          { label: "Orders", value: rows.length, type: "int" },
          { label: "Open (pending / partial)", value: rows.filter((r) => ["Pending", "Partially Received"].includes(r.status)).length, type: "int" },
          { label: "Order value", value: r2(live.reduce((s, r) => s + r.total, 0)), type: "money" },
          { label: "Qty still pending", value: live.reduce((s, r) => s + (["Pending", "Partially Received"].includes(r.status) ? r.pending : 0), 0), type: "int" },
        ],
        note: "Totals leave out cancelled orders. A purchase order never changes stock.",
      };
    },
  },

  "pi-register": {
    group: "Inventory",
    title: "Purchase Invoice Report",
    build: async (ctx) => {
      const purchases = await Purchase.find({ ...dateRange(ctx), ...vendorFilter(ctx), ...(ctx.product ? { "items.product": oid(ctx.product) } : {}) })
        .populate("vendor", "name")
        .populate("purchaseOrder", "poNo")
        .sort({ date: -1, createdAt: -1 })
        .lean();
      const rets = await PurchaseReturn.aggregate([{ $match: { purchase: { $in: purchases.map((p) => p._id) }, status: "Confirmed" } }, { $group: { _id: "$purchase", total: { $sum: "$total" } } }]);
      const returned = new Map(rets.map((r) => [String(r._id), r2(r.total)]));
      const rows = purchases.map((p) => {
        const back = returned.get(String(p._id)) || 0;
        return {
          id: String(p._id),
          ref: p.piNo || p.invoiceNo,
          invoiceNo: p.invoiceNo,
          poNo: p.purchaseOrder?.poNo || "",
          date: p.date,
          party: supplierName(p),
          mode: p.paymentMode,
          taxable: r2(p.subtotal),
          gst: r2(p.gstAmount),
          total: r2(p.total),
          returned: back,
          net: r2(p.total - back),
          balance: p.paymentMode === "Credit" ? r2(p.total - (p.amountPaid ?? p.total)) : 0,
        };
      });
      return {
        columns: [col("ref", "PI No"), col("invoiceNo", "Supplier Inv No"), col("poNo", "PO Ref"), col("date", "Date", "date"), col("party", "Supplier"), col("mode", "Payment"), col("taxable", "Taxable", "money"), col("gst", "GST", "money"), col("total", "Invoice Total", "money"), col("returned", "Returned", "money"), col("net", "Net", "money"), col("balance", "Balance Due", "money")],
        rows,
        totals: addUp(rows, ["taxable", "gst", "total", "returned", "net", "balance"]),
        summary: [
          { label: "Invoices", value: rows.length, type: "int" },
          { label: "Against a PO", value: rows.filter((r) => r.poNo).length, type: "int" },
          { label: "Purchase value", value: r2(rows.reduce((s, r) => s + r.total, 0)), type: "money" },
          { label: "Net of returns", value: r2(rows.reduce((s, r) => s + r.net, 0)), type: "money" },
        ],
      };
    },
  },

  "pr-register": {
    group: "Inventory",
    title: "Purchase Return Report",
    build: async (ctx) => {
      const list = await PurchaseReturn.find({ ...dateRange(ctx), ...vendorFilter(ctx), ...(ctx.product ? { "items.product": oid(ctx.product) } : {}) })
        .populate("vendor", "name")
        .sort({ date: -1, createdAt: -1 })
        .lean();
      const rows = list.map((r) => {
        const items = ctx.product ? r.items.filter((i) => String(i.product) === String(ctx.product)) : r.items;
        return { id: String(r._id), ref: r.returnNo, date: r.date, party: r.vendor?.name || "No supplier", piNo: r.piNo || r.invoiceNo, qty: items.reduce((s, i) => s + i.qtyPacks, 0), taxable: r2(r.subtotal), gst: r2(r.gstAmount), total: r2(r.total), reason: r.reason || "", status: r.status };
      });
      const live = rows.filter((r) => r.status === "Confirmed");
      return {
        columns: [col("ref", "Return No"), col("date", "Date", "date"), col("party", "Supplier"), col("piNo", "Against PI"), col("qty", "Qty (packs)", "int"), col("taxable", "Taxable", "money"), col("gst", "GST", "money"), col("total", "Return Value", "money"), col("reason", "Reason"), col("status", "Status")],
        rows,
        totals: addUp(live, ["qty", "taxable", "gst", "total"]),
        summary: [
          { label: "Returns", value: live.length, type: "int" },
          { label: "Cancelled", value: rows.length - live.length, type: "int" },
          { label: "Qty returned (packs)", value: live.reduce((s, r) => s + r.qty, 0), type: "int" },
          { label: "Return value", value: r2(live.reduce((s, r) => s + r.total, 0)), type: "money" },
        ],
        note: "Totals count confirmed returns only.",
      };
    },
  },

  "purchase-inward": {
    group: "Inventory",
    title: "Purchase Inward Report",
    build: async (ctx) => {
      const purchases = await Purchase.find({ ...dateRange(ctx), ...vendorFilter(ctx), ...(ctx.product ? { "items.product": oid(ctx.product) } : {}) })
        .populate("vendor", "name")
        .populate("purchaseOrder", "poNo")
        .populate("items.product", "name productCode packUnit")
        .sort({ date: -1, createdAt: -1 })
        .lean();
      const rows = [];
      for (const p of purchases)
        p.items.forEach((i, k) => {
          if (ctx.product && String(i.product?._id) !== String(ctx.product)) return;
          rows.push({ id: `${p._id}:${k}`, date: p.date, ref: p.piNo || p.invoiceNo, poNo: p.purchaseOrder?.poNo || "", party: supplierName(p), product: i.product?.name || "", batch: i.batchNo || "", expiry: i.expiryDate || null, qty: i.qtyPacks, rate: r2(i.costPrice), amount: r2(i.lineAmount + i.lineGst) });
        });
      return {
        columns: [col("date", "Date", "date"), col("ref", "PI No"), col("poNo", "PO Ref"), col("party", "Supplier"), col("product", "Item"), col("batch", "Batch"), col("expiry", "Expiry", "date"), col("qty", "Qty In (packs)", "int"), col("rate", "Rate", "money"), col("amount", "Amount", "money")],
        rows,
        totals: addUp(rows, ["qty", "amount"]),
        summary: [
          { label: "Invoice lines", value: rows.length, type: "int" },
          { label: "Invoices", value: purchases.length, type: "int" },
          { label: "Packs received", value: rows.reduce((s, r) => s + r.qty, 0), type: "int" },
          { label: "Inward value", value: r2(rows.reduce((s, r) => s + r.amount, 0)), type: "money" },
        ],
        note: "Stock received on confirmed purchase invoices. Extra stock additions are in Stock Management > Stock In Report.",
      };
    },
  },

  "supplier-purchase": {
    group: "Inventory",
    title: "Supplier-wise Purchase Report",
    build: async (ctx) => {
      const vf = vendorFilter(ctx);
      const pf = ctx.product ? { "items.product": oid(ctx.product) } : {};
      const [purchases, returns, pos] = await Promise.all([
        Purchase.find({ ...dateRange(ctx), ...vf, ...pf }).populate("vendor", "name phone").lean(),
        PurchaseReturn.find({ ...dateRange(ctx), ...vf, ...pf, status: "Confirmed" }).lean(),
        ctx.vendor === "none" ? [] : PurchaseOrder.find({ ...dateRange(ctx), ...vf, ...pf, status: { $ne: "Cancelled" } }).lean(),
      ]);
      const rowsBy = new Map();
      const at = (id, name, phone) => {
        const key = id ? String(id) : `name:${name}`;
        if (!rowsBy.has(key)) rowsBy.set(key, { id: key, party: name, phone: phone || "", orders: 0, orderValue: 0, count: 0, total: 0, returned: 0, net: 0, paid: 0, balance: 0, last: null });
        return rowsBy.get(key);
      };
      for (const p of purchases) {
        const r = at(p.vendor?._id, supplierName(p), p.vendor?.phone);
        r.count += 1;
        r.total += p.total;
        r.paid += p.amountPaid ?? p.total;
        if (p.paymentMode === "Credit") r.balance += p.total - (p.amountPaid ?? p.total);
        if (!r.last || p.date > r.last) r.last = p.date;
      }
      const names = new Map((await Vendor.find({ _id: { $in: [...returns.map((r) => r.vendor), ...pos.map((p) => p.vendor)].filter(Boolean) } }, "name phone").lean()).map((v) => [String(v._id), v]));
      for (const x of returns) {
        const v = names.get(String(x.vendor));
        at(x.vendor, v?.name || "No supplier", v?.phone).returned += x.total;
      }
      for (const po of pos) {
        const v = names.get(String(po.vendor));
        const r = at(po.vendor, v?.name || "", v?.phone);
        r.orders += 1;
        r.orderValue += po.total;
      }
      const rows = [...rowsBy.values()].map((r) => ({ ...r, orderValue: r2(r.orderValue), total: r2(r.total), returned: r2(r.returned), net: r2(r.total - r.returned), paid: r2(r.paid), balance: r2(r.balance) })).sort((a, b) => b.net - a.net);
      return {
        columns: [col("party", "Supplier"), col("phone", "Phone"), col("orders", "POs", "int"), col("orderValue", "PO Value", "money"), col("count", "Invoices", "int"), col("total", "Purchases", "money"), col("returned", "Returns", "money"), col("net", "Net Purchase", "money"), col("paid", "Paid", "money"), col("balance", "Pending", "money"), col("last", "Last Invoice", "date")],
        rows,
        totals: addUp(rows, ["orders", "orderValue", "count", "total", "returned", "net", "paid", "balance"]),
        chart: { type: "rank", x: "party", series: [{ key: "net", label: "Net purchase" }], rows: rows.slice(0, 10) },
      };
    },
  },

  "current-stock": {
    group: "Inventory",
    title: "Current Stock Report",
    build: async (ctx) => {
      const report = await buildStockReport(ctx.product ? { scope: { _id: oid(ctx.product) } } : {});
      let rows = report.rows;
      if (ctx.vendor && ctx.vendor !== "none") {
        const supplied = new Set((await Purchase.distinct("items.product", { vendor: oid(ctx.vendor) })).map(String));
        rows = rows.filter((r) => supplied.has(String(r.productId)));
      }
      const out = rows.map((r) => ({ id: String(r.productId), product: r.name, code: r.productCode, category: r.category, stock: r.qtyDisplay, units: r.qty, status: r.isOut ? "Out of stock" : r.isLowStock ? "Low stock" : "OK", expiry: r.nearestExpiry, valueCost: r2(r.valueCost), valueMrp: r2(r.valueMrp) }));
      return {
        columns: [col("product", "Item"), col("code", "Code"), col("category", "Category"), col("stock", "Stock on Hand"), col("units", "Stock Units", "int"), col("status", "Status"), col("expiry", "Nearest Expiry", "date"), col("valueCost", "Value (Cost)", "money"), col("valueMrp", "Value (MRP)", "money")],
        rows: out,
        totals: addUp(out, ["units", "valueCost", "valueMrp"]),
        summary: [
          { label: "Items", value: out.length, type: "int" },
          { label: "Out of stock", value: out.filter((r) => r.status === "Out of stock").length, type: "int" },
          { label: "Stock value (cost)", value: r2(out.reduce((s, r) => s + r.valueCost, 0)), type: "money" },
          { label: "Stock value (MRP)", value: r2(out.reduce((s, r) => s + r.valueMrp, 0)), type: "money" },
        ],
        note: "Stock as it is now (the period doesn't apply).",
      };
    },
  },

  "stock-movement": {
    group: "Inventory",
    title: "Stock Movement Summary",
    build: async (ctx) => {
      const products = await Product.find({ isActive: true, ...(ctx.product ? { _id: oid(ctx.product) } : {}) }, "name productCode qty").sort({ name: 1 }).lean();
      const moves = await movements(ctx, products.map((p) => p._id));
      const rows = products
        .map((p) => ({ id: String(p._id), product: p.name, code: p.productCode, ...(moves.get(String(p._id)) || zeroMoves()), current: p.qty }))
        .filter((r) => ctx.product || r.opening || r.inward || r.extra || r.returns || r.sales || r.other || r.current);
      return {
        columns: [col("product", "Item"), col("code", "Code"), col("opening", "Opening", "int"), col("inward", "Purchase Inward", "int"), col("extra", "Extra Stock", "int"), col("returns", "Purchase Return", "int"), col("sales", "Sales Outward", "int"), col("other", "Other +/-", "int"), col("closing", "Closing", "int"), col("current", "Stock Now", "int")],
        rows,
        totals: addUp(rows, ["opening", "inward", "extra", "returns", "sales", "other", "closing", "current"]),
        note: "Closing = Opening + Purchase Inward + Extra Stock - Purchase Return - Sales Outward +/- Other (adjustments, write-offs, audits). In stock units.",
      };
    },
  },

  "item-stock-ledger": {
    group: "Inventory",
    title: "Item-wise Stock Ledger",
    build: async (ctx) => {
      const columns = [col("date", "Date", "date"), col("type", "Transaction"), col("ref", "Reference / Reason"), col("batch", "Batch"), col("in", "In", "int"), col("out", "Out", "int"), col("balance", "Balance", "int"), col("by", "By")];
      if (!ctx.product) return { columns, rows: [], note: "Choose an item (Product filter) to see its stock ledger." };
      const pid = oid(ctx.product);
      const product = await Product.findById(pid, "name qty").lean();
      const when = { $ifNull: ["$entryDate", "$createdAt"] };
      const [before] = await StockLedger.aggregate([{ $match: { product: pid } }, { $match: { $expr: { $lt: [when, ctx.start] } } }, { $group: { _id: null, qty: { $sum: "$qtyChange" } } }]);
      const entries = await StockLedger.find({ product: pid, $expr: { $and: [{ $gte: [when, ctx.start] }, { $lte: [when, ctx.end] }] } })
        .populate("batch", "batchNo")
        .populate("performedBy", "username")
        .sort({ createdAt: 1 })
        .lean();
      let balance = before?.qty || 0;
      const opening = balance;
      const rows = [{ id: "opening", date: ctx.start, type: "Opening balance", ref: "", batch: "", in: null, out: null, balance, by: "" }];
      const sums = zeroMoves();
      for (const e of entries) {
        if (!e.qtyChange && e.type !== "rack-transfer") continue;
        balance += e.qtyChange;
        const g = MOVEMENT_GROUP[e.type] || "other";
        sums[g] += e.qtyChange;
        rows.push({ id: String(e._id), date: e.entryDate || e.createdAt, type: TYPE_LABEL[e.type] || e.type, ref: [e.reason, e.remarks].filter(Boolean).join(" · "), batch: e.batch?.batchNo || "", in: e.qtyChange > 0 ? e.qtyChange : null, out: e.qtyChange < 0 ? -e.qtyChange : null, balance, by: e.performedBy?.username || "" });
      }
      return {
        columns,
        rows,
        totals: { in: rows.reduce((s, r) => s + (r.in || 0), 0), out: rows.reduce((s, r) => s + (r.out || 0), 0), balance },
        summary: [
          { label: "Opening", value: opening, type: "int" },
          { label: "Purchase inward + extra", value: sums.inward + sums.extra, type: "int" },
          { label: "Returns + sales out", value: -(sums.returns + sums.sales), type: "int" },
          { label: "Closing", value: balance, type: "int" },
        ],
        note: `${product?.name || "Item"}: in stock units. Stock now: ${product?.qty ?? 0}.`,
      };
    },
  },
};

function poColumns() {
  return [col("ref", "PO No"), col("date", "Date", "date"), col("party", "Supplier"), col("status", "Status"), col("ordered", "Ordered", "int"), col("received", "Received", "int"), col("pending", "Pending", "int"), col("taxable", "Taxable", "money"), col("gst", "GST", "money"), col("total", "PO Value", "money"), col("expected", "Expected By", "date")];
}
