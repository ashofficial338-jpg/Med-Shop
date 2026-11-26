// Purchase Order -> Purchase Invoice -> stock in -> Purchase Return -> stock
// out -> cancellations, over real HTTP against a throwaway in-memory database
// (never a real one). Checks every stock number along the way.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import mongoose from "mongoose";
import Product from "../src/models/Product.js";
import Batch from "../src/models/Batch.js";
import Vendor from "../src/models/Vendor.js";
import StockLedger from "../src/models/StockLedger.js";
import CancelledPurchase from "../src/models/CancelledPurchase.js";
import Purchase from "../src/models/Purchase.js";

process.env.TZ = "Asia/Kolkata";
const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5097;
const API = `http://127.0.0.1:${PORT}/api`;
const PASSWORD = "Test-password-1";
let mongo, server, token;

before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = mongo.getUri("purchase_flow_test");
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:/);
  const env = { ...process.env, MONGO_URI: uri, JWT_SECRET: "flow-test-secret-".padEnd(48, "x"), PORT: String(PORT), ADMIN_SEED_EMAIL: "admin@test.local", ADMIN_SEED_PASSWORD: PASSWORD };
  for (const f of ["seedAdmin.js", "seedDemoData.js"]) await promisify(execFile)(process.execPath, [path.join("src/utils", f)], { cwd: SERVER, env, timeout: 60_000 });
  await mongoose.connect(uri);
  server = spawn(process.execPath, ["src/server.js"], { cwd: SERVER, env, stdio: ["ignore", "ignore", "pipe"] });
  server.errors = "";
  server.stderr.on("data", (d) => (server.errors += d));
  for (let i = 0; ; i++) {
    if (await fetch(`${API}/health`).then((r) => r.ok, () => false)) break;
    assert.ok(i < 100 && server.exitCode === null, `server did not start: ${server.errors}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  const r = await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@test.local", password: PASSWORD }) });
  token = (await r.json()).token;
  assert.ok(token);
});

after(async () => {
  server?.kill();
  await mongoose.disconnect();
  await mongo?.stop();
});

async function call(method, url, body) {
  const r = await fetch(API + url, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const type = r.headers.get("content-type") || "";
  return { status: r.status, type, body: type.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) };
}
const ok = async (method, url, body, status = [200, 201]) => {
  const r = await call(method, url, body);
  assert.ok([].concat(status).includes(r.status), `${method} ${url} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const refused = async (method, url, body, pattern) => {
  const r = await call(method, url, body);
  assert.equal(r.status, 400, `${method} ${url} should be refused, got ${r.status} ${JSON.stringify(r.body)}`);
  if (pattern) assert.match(r.body.message, pattern);
  return r.body;
};
const stockOf = async (id) => (await Product.findById(id).lean()).qty;
async function assertBatchesAgree(id) {
  const batches = await Batch.find({ product: id }).lean();
  assert.equal(batches.reduce((s, b) => s + b.qtyRemaining, 0), await stockOf(id), "batches add up to the product's stock");
  for (const b of batches) assert.equal((b.locations || []).reduce((s, l) => s + l.qty, 0), b.qtyRemaining, `batch ${b.batchNo} rack locations add up`);
}
const isPdf = async (url) => {
  const r = await call("GET", url);
  assert.equal(r.status, 200, url);
  assert.equal(r.type, "application/pdf");
  assert.equal(r.body.subarray(0, 5).toString(), "%PDF-");
};

test("PO -> invoice -> stock in -> return -> stock out, with every cancellation reversing correctly", async () => {
  const vendor = await Vendor.findOne({ isActive: { $ne: false } }).lean();
  const [a, b] = await Product.find({ isActive: true }).sort({ name: 1 }).limit(2).lean();
  const per = (p) => (p.soldAs === "pack-and-loose" ? p.unitsPerPack : 1);
  const start = { a: await stockOf(a._id), b: await stockOf(b._id) };

  // 1. Raising an order changes no stock.
  const po = await ok("POST", "/purchase-orders", { vendor: vendor._id, items: [{ product: a._id, qty: 10, rate: 20, discountPercent: 10, gstPercent: 12 }, { product: b._id, qty: 5, rate: 8 }] });
  assert.match(po.poNo, /^PO-\d{6}$/);
  assert.equal(po.status, "Pending");
  assert.equal(po.subtotal, 180 + 40);
  assert.equal(po.gstAmount, Number((180 * 0.12 + (40 * (b.gstPercent || 0)) / 100).toFixed(2)));
  assert.equal(await stockOf(a._id), start.a, "a PO never adds stock");
  await isPdf(`/purchase-orders/${po._id}/pdf`);
  const draft = await ok("POST", "/purchase-orders", { vendor: vendor._id, status: "Draft", items: [{ product: a._id, qty: 1 }] });
  assert.equal(draft.status, "Draft");
  await refused("POST", "/purchases", { purchaseOrder: draft._id, items: [{ product: a._id, qtyPacks: 1 }] }, /pending order/);

  // 2. First (partial) invoice against it.
  const pi1 = await ok("POST", "/purchases", { purchaseOrder: po._id, invoiceNo: "SUP-1", paymentMode: "Credit", items: [{ product: a._id, qtyPacks: 4, costPrice: 20, discountPercent: 10, batchNo: "FLOW-A" }] });
  assert.match(pi1.piNo, /^PI-\d{6}$/);
  assert.equal(String(pi1.vendor._id), String(vendor._id), "supplier comes from the PO");
  assert.equal(await stockOf(a._id), start.a + 4 * per(a));
  let detail = await ok("GET", `/purchase-orders/${po._id}`);
  assert.equal(detail.status, "Partially Received");
  assert.deepEqual(detail.items.map((i) => [i.received, i.pending]), [[4, 6], [0, 5]]);
  const inward = await StockLedger.find({ refId: pi1._id }).lean();
  assert.equal(inward.length, 1);
  assert.equal(inward[0].type, "purchase");

  // Viewing / editing without changes never adds stock again.
  await ok("GET", `/purchases/${pi1._id}`);
  await isPdf(`/purchases/${pi1._id}/pdf`);
  await ok("PUT", `/purchases/${pi1._id}`, { invoiceNo: "SUP-1", paymentMode: "Credit", items: [{ product: a._id, qtyPacks: 4, costPrice: 20, discountPercent: 10, batchNo: "FLOW-A" }] });
  assert.equal(await stockOf(a._id), start.a + 4 * per(a), "an unchanged edit moves no stock");

  // Can't receive more than ordered, or an item not on the order.
  await refused("POST", "/purchases", { purchaseOrder: po._id, invoiceNo: "SUP-X", items: [{ product: a._id, qtyPacks: 7 }] }, /Only 6/);
  const other = await Product.findOne({ _id: { $nin: [a._id, b._id] }, isActive: true }).lean();
  await refused("POST", "/purchases", { purchaseOrder: po._id, invoiceNo: "SUP-X", items: [{ product: other._id, qtyPacks: 1 }] }, /not on purchase order/);

  // 3. Second invoice completes the order.
  const pi2 = await ok("POST", "/purchases", { purchaseOrder: po._id, invoiceNo: "SUP-2", paymentMode: "Credit", items: [{ product: a._id, qtyPacks: 6, costPrice: 20, batchNo: "FLOW-A2" }, { product: b._id, qtyPacks: 5, costPrice: 8 }] });
  assert.equal((await ok("GET", `/purchase-orders/${po._id}`)).status, "Completed");
  assert.equal(await stockOf(a._id), start.a + 10 * per(a));
  assert.equal(await stockOf(b._id), start.b + 5 * per(b));
  await refused("POST", "/purchases", { purchaseOrder: po._id, invoiceNo: "SUP-3", items: [{ product: a._id, qtyPacks: 1 }] }, /completed/);

  // 4. Return from the first invoice: never more than is eligible.
  const elig = await ok("GET", `/purchase-returns/invoice/${pi1._id}`);
  assert.equal(elig.lines.length, 1);
  assert.equal(elig.lines[0].eligiblePacks, 4);
  assert.equal(elig.lines[0].rate, 18);
  const batchId = elig.lines[0].batch;
  await refused("POST", "/purchase-returns", { purchase: pi1._id, items: [{ batch: batchId, qtyPacks: 5 }] }, /only 4 can be returned/);
  const pr1 = await ok("POST", "/purchase-returns", { purchase: pi1._id, reason: "Damaged", items: [{ batch: batchId, qtyPacks: 3 }] });
  assert.match(pr1.returnNo, /^PR-\d{6}$/);
  assert.equal(pr1.subtotal, 54);
  assert.equal(pr1.total, Number((54 * 1.12).toFixed(2)));
  assert.equal(await stockOf(a._id), start.a + 7 * per(a), "a return takes stock off");
  await refused("POST", "/purchase-returns", { purchase: pi1._id, items: [{ batch: batchId, qtyPacks: 2 }] }, /only 1 can be returned/);
  await isPdf(`/purchase-returns/${pr1._id}/pdf`);
  await assertBatchesAgree(a._id);

  // An invoice with a return can't drop below it or be cancelled.
  await refused("PUT", `/purchases/${pi1._id}`, { invoiceNo: "SUP-1", paymentMode: "Credit", items: [{ product: a._id, qtyPacks: 2, costPrice: 20, discountPercent: 10, batchNo: "FLOW-A" }] }, /returned to the supplier/);
  const blocked = await call("DELETE", `/purchases/${pi1._id}`);
  assert.equal(blocked.status, 400);
  assert.match(blocked.body.message, /Cancel the return first/);

  // 5. Cancelling the return puts the stock back, once.
  await ok("POST", `/purchase-returns/${pr1._id}/cancel`, { reason: "Supplier refused" });
  assert.equal(await stockOf(a._id), start.a + 10 * per(a));
  await refused("POST", `/purchase-returns/${pr1._id}/cancel`, {}, /already cancelled/);
  assert.equal(await stockOf(a._id), start.a + 10 * per(a), "a second cancel moves nothing");

  // 6. Cancelling an invoice reverses its stock, keeps a copy, and reopens the PO.
  const before = await Purchase.countDocuments();
  await ok("DELETE", `/purchases/${pi1._id}`, { reason: "Wrong bill" });
  assert.equal(await Purchase.countDocuments(), before - 1);
  assert.equal(await stockOf(a._id), start.a + 6 * per(a));
  const copy = await CancelledPurchase.findOne({ purchaseId: pi1._id }).lean();
  assert.equal(copy.piNo, pi1.piNo);
  assert.equal(copy.reason, "Wrong bill");
  detail = await ok("GET", `/purchase-orders/${po._id}`);
  assert.equal(detail.status, "Partially Received");
  assert.equal(detail.cancelledInvoices.length, 1);
  const ledger = await StockLedger.find({ refId: pi1._id }).lean();
  assert.equal(ledger.reduce((s, e) => s + e.qtyChange, 0), 0, "stock-in and its reversal both stay in the ledger");
  await assertBatchesAgree(a._id);
  await assertBatchesAgree(b._id);

  // 7. PO rules: lines can't go below what's received; cancel closes it.
  await refused("PUT", `/purchase-orders/${po._id}`, { vendor: vendor._id, items: [{ product: a._id, qty: 5 }, { product: b._id, qty: 5 }] }, /already been received/);
  await ok("POST", `/purchase-orders/${po._id}/cancel`, { reason: "Rest not needed" });
  await refused("DELETE", `/purchase-orders/${po._id}`, null, /can't be deleted/);
  await ok("DELETE", `/purchase-orders/${draft._id}`);

  // 8. Reports: each opens, downloads, and the stock formula holds.
  const all = `from=2020-01-01&to=${new Date().toLocaleDateString("en-CA")}`;
  for (const key of ["po-register", "pi-register", "pr-register", "purchase-inward", "supplier-purchase", "current-stock", "stock-movement", "item-stock-ledger"]) {
    const rep = await ok("GET", `/reports/management?report=${key}&${all}&product=${a._id}`);
    assert.ok(Array.isArray(rep.rows), key);
    await isPdf(`/reports/management?report=${key}&${all}&product=${a._id}&format=pdf`);
    const x = await call("GET", `/reports/management?report=${key}&${all}&vendor=${vendor._id}&format=excel`);
    assert.equal(x.status, 200, key);
  }
  const moves = await ok("GET", `/reports/management?report=stock-movement&${all}&product=${a._id}`);
  const row = moves.rows[0];
  assert.equal(row.closing, row.opening + row.inward + row.extra - row.returns - row.sales + row.other);
  assert.equal(row.current, await stockOf(a._id));
  const led = await ok("GET", `/reports/management?report=item-stock-ledger&${all}&product=${a._id}`);
  assert.equal(led.rows.at(-1).balance, row.closing);
  const piRep = await ok("GET", `/reports/management?report=pi-register&${all}&vendor=${vendor._id}`);
  assert.ok(piRep.rows.some((r) => r.ref === pi2.piNo && r.poNo === po.poNo));
  const poRep = await ok("GET", `/reports/management?report=po-register&${all}`);
  assert.equal(poRep.rows.find((r) => r.ref === po.poNo).status, "Cancelled");

  // 9. List exports open.
  for (const u of ["/purchase-orders/export?format=excel", "/purchase-orders/export?format=pdf", "/purchase-returns/export?format=excel", "/purchase-returns/export?format=pdf", "/purchases/export?format=pdf"]) {
    assert.equal((await call("GET", u)).status, 200, u);
  }
});
