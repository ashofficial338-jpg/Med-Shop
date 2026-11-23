import Sale from "../models/Sale.js";

// Dashboard "Sales overview": today / this month / this year (India time),
// and for the dashboard's period: sales by payment mode, top customers, top
// products and GST. Read straight from the bills, so it always matches
// Bill History, Day Book and Reports. Void bills don't count.

const IST_OFFSET_MS = 330 * 60 * 1000;
const r2 = (n) => Number(Number(n || 0).toFixed(2));

// Start of today / this month / this year in India time, as real instants.
function istStarts(now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  const at = (yy, mm, dd) => new Date(Date.UTC(yy, mm, dd) - IST_OFFSET_MS);
  return { today: at(y, m, d), month: at(y, m, 1), year: at(y, 0, 1) };
}

const counted = { paymentStatus: { $ne: "void" } };

async function totalsSince(start) {
  const [row] = await Sale.aggregate([
    { $match: { ...counted, createdAt: { $gte: start } } },
    { $group: { _id: null, total: { $sum: "$total" }, gst: { $sum: "$gstAmount" }, count: { $sum: 1 } } },
  ]);
  return { total: r2(row?.total), gst: r2(row?.gst), count: row?.count || 0 };
}

export async function salesOverview(start, end) {
  const starts = istStarts();
  const inRange = { ...counted, createdAt: { $gte: start, $lte: end } };
  const [today, month, year, modes, customers, products, gst] = await Promise.all([
    totalsSince(starts.today),
    totalsSince(starts.month),
    totalsSince(starts.year),
    Sale.aggregate([{ $match: inRange }, { $group: { _id: "$paymentMode", total: { $sum: "$total" }, count: { $sum: 1 } } }, { $sort: { total: -1 } }]),
    Sale.aggregate([
      { $match: inRange },
      { $group: { _id: "$customer", total: { $sum: "$total" }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
      { $limit: 6 },
      { $lookup: { from: "customers", localField: "_id", foreignField: "_id", as: "c" } },
    ]),
    Sale.aggregate([
      { $match: inRange },
      { $unwind: "$items" },
      { $group: { _id: "$items.product", name: { $last: "$items.name" }, qty: { $sum: "$items.qty" }, total: { $sum: { $add: ["$items.amount", "$items.gstAmount"] } } } },
      { $sort: { total: -1 } },
      { $limit: 6 },
    ]),
    Sale.aggregate([
      { $match: inRange },
      { $group: { _id: null, taxable: { $sum: { $subtract: ["$subtotal", { $ifNull: ["$discount", 0] }] } }, gst: { $sum: "$gstAmount" }, total: { $sum: "$total" } } },
    ]),
  ]);
  return {
    today,
    month,
    year,
    byPaymentMode: modes.map((m) => ({ mode: m._id || "Other", total: r2(m.total), count: m.count })),
    topCustomers: customers.map((c) => ({ customerId: c._id, name: c._id ? c.c[0]?.name || "Customer" : "Walk-in", total: r2(c.total), count: c.count })),
    topProducts: products.map((p) => ({ productId: p._id, name: p.name, qty: r2(p.qty), total: r2(p.total) })),
    gst: { taxable: r2(gst[0]?.taxable), gst: r2(gst[0]?.gst), total: r2(gst[0]?.total) },
  };
}
