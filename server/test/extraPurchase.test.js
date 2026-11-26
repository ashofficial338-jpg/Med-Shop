// Extra Purchase Excel upload: template, all-optional preview, import, stock,
// incomplete records, history and duplicates - over real HTTP against a
// throwaway in-memory database (never a real one).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import mongoose from "mongoose";
import ExcelJS from "exceljs";
import Product from "../src/models/Product.js";
import Batch from "../src/models/Batch.js";
import Purchase from "../src/models/Purchase.js";

process.env.TZ = "Asia/Kolkata";
const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5096;
const API = `http://127.0.0.1:${PORT}/api`;
const PASSWORD = "Test-password-1";
let mongo, server, token;

before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = mongo.getUri("extra_purchase_test");
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:/);
  const env = { ...process.env, MONGO_URI: uri, JWT_SECRET: "extra-test-secret-".padEnd(48, "x"), PORT: String(PORT), ADMIN_SEED_EMAIL: "admin@test.local", ADMIN_SEED_PASSWORD: PASSWORD };
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
const ok = async (method, url, body) => {
  const r = await call(method, url, body);
  assert.ok([200, 201].includes(r.status), `${method} ${url} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const stockOf = async (id) => (await Product.findById(id).lean()).qty;
const per = (p) => (p.soldAs === "pack-and-loose" ? p.unitsPerPack : 1);

test("extra purchase upload: every column optional, stock only for identified rows, no duplicates", async () => {
  // Template: the 13 columns, in order, none marked required.
  const t = await call("GET", "/extra-purchases/template");
  assert.equal(t.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(t.body);
  const headers = wb.worksheets[0].getRow(1).values.slice(1);
  assert.deepEqual(headers, ["Purchase Date", "Supplier Name", "Supplier Invoice Number", "Item Code", "Item Name", "Category", "Quantity", "Unit", "Purchase Rate", "Discount", "GST %", "Total Amount", "Remarks"]);

  const [a, b] = await Product.find({ isActive: true }).sort({ name: 1 }).limit(2).lean();
  const start = { a: await stockOf(a._id), b: await stockOf(b._id) };
  const raw = [
    { row: 2, cells: { "Purchase Date": "2026-11-20", "Supplier Name": "Upload Test Pharma", "Supplier Invoice Number": "UT-1", "Item Code": a.productCode, Quantity: 5, "Purchase Rate": 10, Remarks: "first line" } },
    { row: 3, cells: { "Supplier Name": "Upload Test Pharma", "Supplier Invoice Number": "UT-1", "Item Name": "Brand New Syrup XYZ", Category: "Syrups", Unit: "Bottle", Quantity: 3, "GST %": 7, "Total Amount": 330 } },
    { row: 4, cells: { "Item Name": b.name } },
    { row: 5, cells: { "Supplier Name": "Local market", "Total Amount": 450, Remarks: "bill to check" } },
    { row: 6, cells: { "Item Name": b.name, Quantity: "abc" } },
    { row: 8, cells: { "Item Name": b.name.toUpperCase(), Quantity: 2, Discount: "" } },
  ];

  const p = await ok("POST", "/extra-purchases/preview", { raw });
  const status = Object.fromEntries(p.rows.map((r) => [r.row, r.status]));
  assert.deepEqual(status, { 2: "ready", 3: "ready", 4: "incomplete", 5: "incomplete", 6: "incomplete", 8: "ready" });
  const row = (n) => p.rows.find((r) => r.row === n);
  assert.equal(row(2).match, "code");
  assert.equal(row(3).match, "new");
  assert.equal(row(3).rateN, 110, "rate worked out from the total");
  assert.ok(row(3).warnings.some((w) => /isn't a GST slab/.test(w)));
  assert.equal(row(4).warnings.length, 0, "blanks are never warnings");
  assert.equal(row(5).warnings.length, 0);
  assert.deepEqual(row(4).missing, ["quantity"]);
  assert.deepEqual(row(5).missing, ["item", "quantity"]);
  assert.ok(row(6).warnings.some((w) => /Quantity "abc"/.test(w)));
  assert.equal(row(8).match, "name");
  assert.equal(p.groups.length, 2, "UT-1 lines together; the no-supplier row on its own");
  assert.equal(p.summary.ready, 3);
  assert.equal(p.summary.incomplete, 3);

  // Import.
  const rows = p.rows.map((r) => ({ row: r.row, date: r.date, supplier: r.supplier, invoiceNo: r.invoiceNo, itemCode: r.itemCode, itemName: r.itemName, category: r.category, qty: r.qty, unit: r.unit, rate: r.rate, discount: r.discount, gst: r.gst, total: r.total, remarks: r.remarks }));
  const file = Buffer.from("pretend-excel-bytes");
  const body = { rows, fileName: "my upload.xlsx", fileType: "application/vnd.ms-excel", fileData: file.toString("base64"), paymentMode: "Credit", clientRef: "test-import-1" };
  const imp = (await ok("POST", "/extra-purchases/import", body)).import;
  assert.match(imp.refNo, /^IMP-\d{6}$/);
  assert.deepEqual([imp.totalRows, imp.importedRows, imp.incompleteRows, imp.failedRows], [6, 3, 3, 0]);
  assert.equal(imp.purchases.length, 2);
  assert.equal(await stockOf(a._id), start.a + 5 * per(a));
  assert.equal(await stockOf(b._id), start.b + 2 * per(b));
  const fresh = await Product.findOne({ name: "Brand New Syrup XYZ" }).lean();
  assert.ok(fresh, "new item added");
  assert.equal(fresh.qty, 3);
  assert.equal(fresh.packUnit, "Bottle");
  const saved = await Purchase.find({ importBatch: imp._id }).lean();
  assert.ok(saved.every((x) => x.source === "extra" && /^EXP-\d{6}$/.test(x.extraRef) && !x.purchaseOrder));
  assert.equal(saved.find((x) => x.invoiceNo === "UT-1").items.find((i) => String(i.product) === String(a._id)).remarks, "first line");
  for (const id of [a._id, b._id, fresh._id]) {
    const batches = await Batch.find({ product: id }).lean();
    assert.equal(batches.reduce((s, x) => s + x.qtyRemaining, 0), await stockOf(id));
  }

  // Same confirm sent twice: nothing more.
  const again = await ok("POST", "/extra-purchases/import", body);
  assert.equal(again.alreadySaved, true);
  assert.equal(await stockOf(a._id), start.a + 5 * per(a));
  // The same file uploaded again: the invoiced rows are recognised as already recorded.
  const p2 = await ok("POST", "/extra-purchases/preview", { raw });
  assert.equal(p2.rows.find((r) => r.row === 2).status, "duplicate");
  assert.equal(p2.rows.find((r) => r.row === 3).status, "duplicate");

  // History, original file, PDF.
  const hist = await ok("GET", "/extra-purchases/history");
  assert.equal(hist[0].refNo, imp.refNo);
  assert.equal(hist[0].uploadedBy.username.length > 0, true);
  const orig = await call("GET", `/extra-purchases/history/${imp._id}/file`);
  assert.equal(orig.status, 200);
  assert.deepEqual(orig.body, file);
  const pdf = await call("GET", `/extra-purchases/history/${imp._id}/pdf`);
  assert.equal(pdf.type, "application/pdf");
  const inv = await call("GET", `/purchases/${saved[0]._id}/pdf`);
  assert.equal(inv.type, "application/pdf");

  // Incomplete records: complete one (stock added), discard one.
  const open = await ok("GET", "/extra-purchases/incomplete?status=Open");
  assert.equal(open.length, 3);
  const r4 = open.find((x) => x.row === 4);
  const r5 = open.find((x) => x.row === 5);
  const stillMissing = await call("POST", `/extra-purchases/incomplete/${r4._id}/complete`, {});
  assert.equal(stillMissing.status, 400);
  assert.match(stillMissing.body.message, /quantity/);
  const before4 = await stockOf(b._id);
  await ok("POST", `/extra-purchases/incomplete/${r4._id}/complete`, { qty: "4", rate: "12" });
  assert.equal(await stockOf(b._id), before4 + 4 * per(b));
  const again4 = await call("POST", `/extra-purchases/incomplete/${r4._id}/complete`, { qty: "4" });
  assert.equal(again4.status, 404, "a completed record can't add stock twice");
  await ok("POST", `/extra-purchases/incomplete/${r5._id}/discard`);
  const after = await ok("GET", `/extra-purchases/history/${imp._id}`);
  assert.equal(after.importedRows, 4);
  assert.equal(after.incompleteRows, 2);
  assert.equal(after.purchases.length, 3);

  // In the purchase reports, marked as extra purchases.
  const all = `from=2020-01-01&to=${new Date().toLocaleDateString("en-CA")}`;
  const rep = await ok("GET", `/reports/management?report=pi-register&${all}`);
  assert.ok(rep.rows.filter((r) => /^Extra \(EXP-/.test(r.source)).length >= 3);
  const list = await ok("GET", "/purchases?source=extra");
  assert.equal(list.length, 3);
});
