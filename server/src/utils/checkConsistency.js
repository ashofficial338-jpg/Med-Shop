import "../tz.js";
import "dotenv/config";
import mongoose from "mongoose";
import Product from "../models/Product.js";
import Batch from "../models/Batch.js";
import Sale from "../models/Sale.js";
import Purchase from "../models/Purchase.js";
import CustomerPayment from "../models/CustomerPayment.js";
import SupplierPayment from "../models/SupplierPayment.js";

// `npm run check` - reads the whole database and reports anything that doesn't
// agree with itself. Changes nothing, unless run as `npm run check -- --fix`,
// which corrects one thing only: a product's stock total that differs from
// the sum of its batches (the batches are what sales draw from, so they are
// the ones that are right).
const near = (a, b) => Math.abs(a - b) < 0.02;

async function run() {
  const fix = process.argv.includes("--fix");
  // Really only reading: no index or collection is created on connecting.
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false });

  const problems = [];
  const [products, batches] = await Promise.all([Product.find().lean(), Batch.find().lean()]);
  const inBatches = new Map();
  for (const b of batches) inBatches.set(String(b.product), (inBatches.get(String(b.product)) || 0) + b.qtyRemaining);
  let fixed = 0;
  for (const p of products) {
    const sum = inBatches.get(String(p._id)) || 0;
    if (p.qty === sum) continue;
    problems.push(`Stock: ${p.name} (${p.productCode}) total ${p.qty}, batches hold ${sum}${p.isActive ? "" : " [deleted product]"}`);
    if (fix) {
      await Product.updateOne({ _id: p._id, qty: p.qty }, { $set: { qty: sum } });
      fixed += 1;
    }
  }
  const unpriced = products.filter((p) => p.isActive && p.qty > 0 && !(p.packRate > 0));
  for (const p of unpriced) problems.push(`Price: ${p.name} (${p.productCode}) has stock but no selling price`);

  const [sales, purchases, receipts, payments] = await Promise.all([Sale.find().lean(), Purchase.find().lean(), CustomerPayment.find().lean(), SupplierPayment.find().lean()]);
  for (const s of sales) {
    if (!near(s.subtotal + s.gstAmount - (s.discount || 0), s.total)) problems.push(`Bill ${s.billNo}: total ${s.total} doesn't match its lines`);
    if ((s.amountPaid ?? s.total) > s.total + 0.01) problems.push(`Bill ${s.billNo}: more received (${s.amountPaid}) than its total (${s.total})`);
  }
  for (const p of purchases) {
    if (!near(p.subtotal + p.gstAmount, p.total)) problems.push(`Purchase ${p.invoiceNo}: total ${p.total} doesn't match its lines`);
    if ((p.amountPaid ?? p.total) > p.total + 0.01) problems.push(`Purchase ${p.invoiceNo}: more paid (${p.amountPaid}) than its total (${p.total})`);
  }

  // What each account owes by its bills must equal bills less payments.
  const voided = new Set(sales.filter((s) => s.paymentStatus === "void").map((s) => String(s._id)));
  for (const r of receipts) if (r.sale && voided.has(String(r.sale))) problems.push(`Receipt ${r.paymentNo} (${r.amount}) is for a voided bill`);
  const account = (docs, paid, key) => {
    const m = new Map();
    const at = (id) => m.get(String(id)) || m.set(String(id), { due: 0, ledger: 0 }).get(String(id));
    for (const d of docs) {
      if (!d[key] || d.paymentMode !== "Credit" || d.paymentStatus === "void") continue;
      const a = at(d[key]);
      a.due += d.total - (d.amountPaid ?? d.total);
      a.ledger += d.total;
    }
    for (const p of paid) at(p[key]).ledger -= p.amount;
    return m;
  };
  for (const [id, a] of account(sales, receipts, "customer")) if (!near(a.due, a.ledger)) problems.push(`Customer ${id}: bills say ${a.due.toFixed(2)} due, ledger says ${a.ledger.toFixed(2)}`);
  for (const [id, a] of account(purchases, payments, "vendor")) if (!near(a.due, a.ledger)) problems.push(`Supplier ${id}: purchases say ${a.due.toFixed(2)} due, ledger says ${a.ledger.toFixed(2)}`);

  console.log(`Checked ${products.length} products, ${batches.length} batches, ${sales.length} bills, ${purchases.length} purchases, ${receipts.length + payments.length} payments.`);
  console.log(problems.length ? problems.join("\n") : "Everything agrees.");
  if (fix) console.log(`Stock totals corrected: ${fixed}`);
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
