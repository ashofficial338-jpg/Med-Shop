import PurchaseOrder from "../models/PurchaseOrder.js";
import PurchaseReturn from "../models/PurchaseReturn.js";
import CancelledPurchase from "../models/CancelledPurchase.js";
import crypto from "node:crypto";
import mongoose from "mongoose";
import Batch from "../models/Batch.js";
import Counter from "../models/Counter.js";
import Customer from "../models/Customer.js";
import CustomerPayment from "../models/CustomerPayment.js";
import DayBookAdjustment from "../models/DayBookAdjustment.js";
import Expense from "../models/Expense.js";
import Product from "../models/Product.js";
import Purchase from "../models/Purchase.js";
import Sale from "../models/Sale.js";
import StockAudit from "../models/StockAudit.js";
import StockLedger from "../models/StockLedger.js";
import SupplierPayment from "../models/SupplierPayment.js";
import Vendor from "../models/Vendor.js";
import { effectiveLocations } from "./locations.js";

// Clearing the business records (Settings > Clear All Transaction Records):
// what counts as one, the backup taken first, and the clearing itself.
//
// This is an allow-list. Anything not named here - users, their passwords,
// roles and permissions, categories, racks - is never touched.

// The removed Sales Entry module's records, still there in older databases.
const LegacySalesEntry = mongoose.model(
  "LegacySalesEntry",
  new mongoose.Schema({}, { strict: false, collection: "salesentries", autoCreate: false, autoIndex: false })
);

// Always cleared.
export const TRANSACTIONS = {
  sales: { model: Sale, label: "Sales bills (including imported)" },
  purchases: { model: Purchase, label: "Purchases (including imported)" },
  customerPayments: { model: CustomerPayment, label: "Customer payments" },
  supplierPayments: { model: SupplierPayment, label: "Supplier payments" },
  expenses: { model: Expense, label: "Expenses" },
  dayBookAdjustments: { model: DayBookAdjustment, label: "Day Book corrections" },
  stockLedger: { model: StockLedger, label: "Stock movement history" },
  stockAudits: { model: StockAudit, label: "Stock audits" },
  purchaseOrders: { model: PurchaseOrder, label: "Purchase orders" },
  purchaseReturns: { model: PurchaseReturn, label: "Purchase returns" },
  cancelledPurchases: { model: CancelledPurchase, label: "Cancelled purchase invoices" },
  legacySalesEntries: { model: LegacySalesEntry, label: "Old Sales Entry records" },
};
// Kept, unless asked for (customers, vendors) or tied to stock (batches).
const MASTERS = { batches: Batch, products: Product, customers: Customer, vendors: Vendor, counters: Counter };

// Numbers that can restart at 1. Product codes and Invoice Saver file numbers
// go on counting, so a code or a saved file name is never used twice.
export const RESTARTING_COUNTERS = ["billNo", "purchaseNo", "directPurchaseNo", "customerPaymentNo", "supplierPaymentNo", "purchaseOrderNo", "purchaseInvoiceNo", "purchaseReturnNo"];

const everything = () => [...Object.entries(TRANSACTIONS).map(([k, t]) => [k, t.model]), ...Object.entries(MASTERS)];

export async function transactionCounts() {
  const rows = await Promise.all(Object.entries(TRANSACTIONS).map(async ([key, { model, label }]) => ({ key, label, count: await model.countDocuments() })));
  const [customers, vendors, products, inStock] = await Promise.all([
    Customer.countDocuments(),
    Vendor.countDocuments(),
    Product.countDocuments(),
    Product.countDocuments({ qty: { $gt: 0 } }),
  ]);
  return { rows: rows.filter((r) => r.count > 0 || r.key !== "legacySalesEntries"), kept: { customers, vendors, products, inStock } };
}

// Changes whenever a record is added, removed or edited - so records can only
// be cleared while the backup that was taken is still complete.
export async function recordsFingerprint() {
  const parts = [];
  for (const [key, model] of everything()) {
    const [row] = await model.aggregate([{ $group: { _id: null, n: { $sum: 1 }, at: { $max: "$updatedAt" }, id: { $max: "$_id" }, seq: { $sum: "$seq" } } }]);
    parts.push([key, row?.n || 0, row?.at?.getTime?.() || 0, String(row?.id || ""), row?.seq || 0]);
  }
  return crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

// Everything clearing could touch.
export async function buildBackup() {
  const data = {};
  for (const [key, model] of everything()) data[key] = await model.find().lean();
  return { app: "gugan-medicals", kind: "transaction-backup", version: 1, createdAt: new Date(), data };
}

// Call inside a transaction. Returns how many of each were cleared.
export async function clearTransactions({ keepStock, deleteCustomers, deleteVendors, restartNumbers, userId }) {
  const counts = {};
  for (const [key, { model }] of Object.entries(TRANSACTIONS)) counts[key] = (await model.deleteMany({})).deletedCount;

  if (keepStock) {
    // What is on the shelves stays, as opening stock with no purchase behind it.
    counts.emptyBatches = (await Batch.deleteMany({ qtyRemaining: { $lte: 0 } })).deletedCount;
    await Batch.updateMany({}, [{ $set: { qtyReceived: "$qtyRemaining", purchase: null } }]);
    const entries = [];
    for (const b of await Batch.find()) {
      for (const l of effectiveLocations(b)) {
        entries.push({ product: b.product, batch: b._id, type: "manual-add", qtyChange: l.qty, rack: l.rack, reason: "Opening stock (records cleared)", performedBy: userId });
      }
    }
    if (entries.length) await StockLedger.insertMany(entries);
  } else {
    counts.batches = (await Batch.deleteMany({})).deletedCount;
    await Product.updateMany({ qty: { $ne: 0 } }, { $set: { qty: 0 } });
  }

  if (deleteCustomers) counts.customers = (await Customer.deleteMany({})).deletedCount;
  if (deleteVendors) {
    counts.vendors = (await Vendor.deleteMany({})).deletedCount;
    await Product.updateMany({ vendor: { $ne: null } }, { $set: { vendor: null } });
  }
  if (restartNumbers) await Counter.updateMany({ _id: { $in: RESTARTING_COUNTERS } }, { $set: { seq: 0 } });
  return counts;
}

// Puts a backup back, inside a transaction. Only onto records that have just
// been cleared, so nothing entered since is ever overwritten.
export async function restoreBackup(backup) {
  if (backup?.app !== "gugan-medicals" || backup.kind !== "transaction-backup" || !backup.data) throw new Error("This is not a transaction backup file.");
  for (const [key, { model, label }] of Object.entries(TRANSACTIONS)) {
    if (key === "stockLedger") continue; // may hold the kept opening stock
    if (await model.exists({})) throw new Error(`There are already records of: ${label}. Restore only works right after clearing.`);
  }
  // Stock added by hand since clearing would be lost too.
  if (await StockLedger.exists({ reason: { $ne: "Opening stock (records cleared)" } })) throw new Error("Stock has been changed since clearing. Restore only works right after clearing.");

  // lean: exactly as they were, with nothing filled in or recalculated.
  const insert = async (model, docs = []) => {
    for (let i = 0; i < docs.length; i += 500) await model.insertMany(docs.slice(i, i + 500), { lean: true, timestamps: false });
  };
  await StockLedger.deleteMany({});
  await Batch.deleteMany({});
  for (const [key, { model }] of Object.entries(TRANSACTIONS)) await insert(model, backup.data[key]);
  await insert(Batch, backup.data.batches);

  // Customers, suppliers and products: put back any that are missing; on
  // products still there only the stock and supplier are restored.
  const missing = async (model, docs = []) => {
    const have = new Set((await model.find({}, "_id").lean()).map((d) => String(d._id)));
    return docs.filter((d) => !have.has(String(d._id)));
  };
  await insert(Customer, await missing(Customer, backup.data.customers));
  await insert(Vendor, await missing(Vendor, backup.data.vendors));
  await insert(Product, await missing(Product, backup.data.products));
  await Product.updateMany({}, { $set: { qty: 0 } });
  for (const p of backup.data.products || []) await Product.updateOne({ _id: p._id }, { $set: { qty: p.qty, vendor: p.vendor ?? null } });
  for (const c of backup.data.counters || []) await Counter.updateOne({ _id: c._id }, { $max: { seq: c.seq } }, { upsert: true });
}
