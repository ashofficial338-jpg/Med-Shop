// Every Excel / PDF download, over real HTTP: starts the real server on a
// throwaway in-memory database, signs in, downloads each file, opens it and
// compares it with the figures the screens get. Never touches a real database.
//
// Reading the PDFs uses the client's pdfjs-dist, so `npm ci` in client/ first.
// MONGOMS_SYSTEM_BINARY can point at an installed mongod to skip the download.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import mongoose from "mongoose";
import ExcelJS from "exceljs";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import Customer from "../src/models/Customer.js";
import Vendor from "../src/models/Vendor.js";
import Sale from "../src/models/Sale.js";
import Purchase from "../src/models/Purchase.js";
import Expense from "../src/models/Expense.js";
import User from "../src/models/User.js";
import Product from "../src/models/Product.js";
import StockLedger from "../src/models/StockLedger.js";

process.env.TZ = "Asia/Kolkata";
const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pdfjs = await import(pathToFileURL(path.join(SERVER, "../client/node_modules/pdfjs-dist/legacy/build/pdf.mjs")).href);
const PORT = 5098;
const API = `http://127.0.0.1:${PORT}/api`;
const PASSWORD = "Test-password-1";
const TAMIL = "தமிழ் மருந்தகம்";
const SECRET = "exports-test-secret-".padEnd(48, "x");
// 1:30 AM India time is still the previous day in UTC.
const EARLY = new Date("2026-03-05T01:30:00+05:30");
const ALL = `from=2020-01-01&to=${new Date().toLocaleDateString("en-CA")}`;

let mongo, server, tokens;
const ids = {};

before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = mongo.getUri("exports_test");
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:/);
  const env = { ...process.env, MONGO_URI: uri, JWT_SECRET: SECRET, PORT: String(PORT), ADMIN_SEED_EMAIL: "admin@test.local", ADMIN_SEED_PASSWORD: PASSWORD };
  // Not the sync version: that would stop this process reading mongod's log, and mongod would wait for it forever.
  for (const f of ["seedAdmin.js", "seedDemoData.js"]) await promisify(execFile)(process.execPath, [path.join("src/utils", f)], { cwd: SERVER, env, timeout: 60_000 });

  await mongoose.connect(uri);
  const admin = await User.findOne({ role: "admin" });
  const hash = await bcrypt.hash(PASSWORD, 4);
  await User.create([
    { email: "view@test.local", username: "view", role: "staff", passwordHash: hash, permissions: ["reports.view"] },
    { email: "export@test.local", username: "export", role: "staff", passwordHash: hash, permissions: ["reports.view", "reports.export"] },
    { email: "gone@test.local", username: "gone", role: "staff", passwordHash: hash, isActive: false, permissions: ["reports.view", "reports.export"] },
  ]);
  const nophone = await Customer.create({ name: "No Phone Customer", address: "Anna Nagar" });
  const tamil = await Customer.create({ name: TAMIL, phone: "9111111112" });
  const symbols = await Customer.create({ name: "Edge & Sons \"A\" <B> / C: O'Neil", phone: "9111111113" });
  const idle = await Customer.create({ name: "Never Bought", email: "findme@example.com" });
  const bareVendor = await Vendor.create({ name: "Bare Vendor", contactPerson: "Raghavan" });
  const tamilVendor = await Vendor.create({ name: TAMIL });
  Object.assign(ids, { nophone: nophone.id, tamil: tamil.id, symbols: symbols.id, idle: idle.id, bareVendor: bareVendor.id, tamilVendor: tamilVendor.id });

  const base = await Sale.findOne().lean();
  const bill = (customer, billNo, date, extra = {}) => {
    const b = { ...base, _id: new mongoose.Types.ObjectId(), billNo, customer, createdAt: date, updatedAt: date, createdBy: admin._id, amountPaid: base.total, paymentMode: "Cash", ...extra };
    for (const k of ["archiveNo", "importRef", "clientRef"]) delete b[k];
    return b;
  };
  const bills = [];
  for (let i = 0; i < 120; i++) bills.push(bill([nophone._id, tamil._id, symbols._id][i % 3], `T-${i}`, new Date(Date.now() - i * 86400000), i % 2 ? { paymentMode: "Credit", amountPaid: 0 } : {}));
  bills.push(bill(nophone._id, "EARLY-1", EARLY));
  bills.push(bill(symbols._id, "VOID-1", new Date(), { paymentStatus: "void", total: 987654 }));
  await Sale.collection.insertMany(bills);
  ids.tamilSale = String(bills[1]._id);
  ids.plainSale = String(bills[0]._id);
  const p = await Purchase.findOne().lean();
  for (const k of ["_id", "archiveNo", "clientRef"]) delete p[k];
  await Purchase.collection.insertMany([
    { ...p, vendor: bareVendor._id, invoiceNo: "EARLY-P", date: EARLY, paymentMode: "Credit", amountPaid: 0 },
    { ...p, vendor: tamilVendor._id, invoiceNo: "TAMIL-P", date: new Date(), paymentMode: "Cash", amountPaid: p.total },
  ]);
  await Expense.create({ category: "Other", amount: 10, date: EARLY, notes: "EARLYNOTE", createdBy: admin._id, recordedBy: admin._id });
  await Expense.collection.insertOne({ category: "Other", amount: 11, paymentMode: "Cash", date: new Date(), notes: `${"very long note ".repeat(700)}ENDOFNOTE`, createdBy: admin._id, createdAt: new Date() });

  server = spawn(process.execPath, ["src/server.js"], { cwd: SERVER, env, stdio: ["ignore", "ignore", "pipe"] });
  server.errors = "";
  server.stderr.on("data", (d) => (server.errors += d));
  for (let i = 0; ; i++) {
    if (await fetch(`${API}/health`).then((r) => r.ok, () => false)) break;
    assert.ok(i < 100 && server.exitCode === null, `server did not start: ${server.errors}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  const login = async (email) => {
    const r = await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) });
    return (await r.json()).token;
  };
  const gone = await User.findOne({ username: "gone" });
  tokens = {
    admin: await login("admin@test.local"),
    view: await login("view@test.local"),
    export: await login("export@test.local"),
    expired: jwt.sign({ sub: admin.id, role: "admin" }, SECRET, { expiresIn: -10 }),
    forged: jwt.sign({ sub: admin.id, role: "admin" }, "another-secret"),
    gone: jwt.sign({ sub: gone.id, role: "staff" }, SECRET, { expiresIn: "1h" }),
  };
  assert.ok(tokens.admin && tokens.view && tokens.export);
});

after(async () => {
  server?.kill();
  await mongoose.disconnect();
  await mongo?.stop();
});

// ---------- helpers ----------

async function get(url, who = "admin") {
  const r = await fetch(API + url, { headers: who ? { Authorization: `Bearer ${tokens[who]}`, Origin: "https://med-shop-lac.vercel.app" } : {} });
  return { status: r.status, headers: r.headers, type: r.headers.get("content-type") || "", body: Buffer.from(await r.arrayBuffer()) };
}
const json = async (url) => {
  const r = await get(url);
  assert.equal(r.status, 200, `${url} -> ${r.status} ${r.body}`);
  return JSON.parse(r.body);
};
const withFormat = (url, f) => `${url}${url.includes("?") ? "&" : "?"}format=${f}`;
const squash = (s) => String(s).replace(/\s+/g, "");
const JUNK = /\bundefined\b|\bNaN\b|\bnull\b|Invalid Date|\[object/;

async function excel(url) {
  const r = await get(withFormat(url, "excel"));
  assert.equal(r.status, 200, `${url} excel -> ${r.status} ${r.body.slice(0, 200)}`);
  assert.equal(r.type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.match(r.headers.get("content-disposition"), /^attachment; filename="[\w.-]+\.xlsx"/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(r.body);
  const sheets = wb.worksheets.map((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: true }, (row) => rows.push(Array.from({ length: ws.columnCount }, (_, i) => row.getCell(i + 1).value ?? null)));
    return rows;
  });
  for (const rows of sheets) for (const row of rows) for (const v of row) assert.ok(!(typeof v === "string" && JUNK.test(v)) && !Number.isNaN(v) && !v?.error, `${url} excel cell ${JSON.stringify(v)}`);
  return sheets;
}
async function readPdf(body) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(body), verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(" "));
  return { text: pages.join("\n"), pages: doc.numPages };
}
async function pdf(url) {
  const r = await get(withFormat(url, "pdf"));
  assert.equal(r.status, 200, `${url} pdf -> ${r.status} ${r.body.slice(0, 200)}`);
  assert.equal(r.type, "application/pdf");
  assert.match(r.headers.get("content-disposition"), /^attachment; filename="[\w.-]+\.pdf"/);
  assert.equal(r.body.subarray(0, 5).toString(), "%PDF-");
  const out = await readPdf(r.body);
  assert.doesNotMatch(out.text, JUNK, `${url} pdf text`);
  return out;
}
// Real Tamil letters, and none of the Latin-1 debris Helvetica drew instead.
function assertTamil(text, what) {
  assert.match(text, /[஀-௿]{3}/, `${what}: no Tamil text`);
  assert.doesNotMatch(text, /[ºÍ»¼½¾Â®´ÁÒû]/, `${what}: garbled text`);
}
const inr = (v) => Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (d) => new Date(d).toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata" }).replace(/\//g, "-");
const col = (sheet, header) => sheet[0].indexOf(header);

// ---------- Management Reports ----------

async function checkManagement(query) {
  const url = `/reports/management?${query}`;
  const j = await json(url);
  const withTotals = Boolean(j.totals && j.rows.length);
  const typeOf = (c, r) => (c.type === "by-row" ? r.type || "money" : c.type);
  const [sheet] = await excel(url);
  assert.deepEqual(sheet[0].map((h) => String(h).trim()), j.columns.map((c) => c.label), `${query} headers`);
  assert.equal(sheet.length - 1, j.rows.length + (withTotals ? 1 : 0), `${query} row count`);
  j.rows.forEach((r, i) =>
    j.columns.forEach((c, k) => {
      let want = r[c.key] === undefined || r[c.key] === "" ? null : r[c.key];
      if (want !== null && typeOf(c, r) === "date") want = dmy(want);
      assert.equal(sheet[i + 1][k], want, `${query} row ${i} ${c.key}`);
    })
  );
  if (withTotals) j.columns.forEach((c, k) => k && j.totals[c.key] !== undefined && assert.equal(sheet.at(-1)[k], j.totals[c.key], `${query} total ${c.key}`));

  const { text, pages } = await pdf(url);
  const t = squash(text);
  for (const r of j.rows)
    for (const c of j.columns) {
      const v = r[c.key], type = typeOf(c, r);
      if (v === null || v === undefined || v === "" || v === TAMIL) continue;
      const want = type === "date" ? dmy(v) : typeof v !== "number" ? v : type === "money" ? inr(v) : type === "pct" ? `${v}%` : String(v);
      assert.ok(t.includes(squash(want)), `${query} pdf has no ${c.key} = ${want}`);
    }
  for (const s of j.summary || []) assert.ok(t.includes(squash(`${s.label}: ${s.type === "money" ? `Rs. ${inr(s.value)}` : s.value}`)), `${query} pdf summary ${s.label}`);
  assert.ok(t.includes(`Page${pages}of${pages}`));
  if (!j.rows.length) assert.ok(t.includes("Norecordsfound"));
  if (j.rows.some((r) => Object.values(r).includes(TAMIL))) assertTamil(text, query);
  return j;
}

test("all management reports: Excel and PDF match the screen", async () => {
  const { reports } = await json("/reports/management/options");
  assert.equal(reports.length, 23);
  for (const r of reports) await checkManagement(`report=${r.key}&${ALL}`);
});

test("management reports: filters, empty periods and party pages", async () => {
  const { customers, vendors, products } = await json("/reports/management/options");
  await checkManagement("report=sales-daily&from=2019-01-01&to=2019-01-02");
  await checkManagement(`report=sales-daily&${ALL}&product=${products[0]._id}`);
  await checkManagement(`report=sales-daily&${ALL}&customer=walk-in`);
  await checkManagement(`report=business-summary&${ALL}&vendor=${vendors[0]._id}`);
  for (const c of customers) await checkManagement(`report=sales-daily&${ALL}&customer=${c._id}`);
  for (const v of vendors) await checkManagement(`report=purchase-daily&${ALL}&vendor=${v._id}`);
  assert.equal((await get("/reports/management?report=no-such-report")).status, 404);
  assert.equal((await get("/reports/management?report=sales-daily&from=2026-02-01&to=2026-01-01")).status, 400);
});

// ---------- every other download ----------

test("every other download opens with clean contents", async () => {
  const o = await json("/reports/options");
  const c = ids.nophone, v = ids.bareVendor;
  const urls = [
    ...o.templates.map((t) => `/reports/export?template=${t.key}&${ALL}`),
    ...o.sections.map((s) => `/reports/export?sections=${s.key}&${ALL}`),
    "/reports/export?from=2019-01-01&to=2019-01-02",
    `/dashboard/export?${ALL}`, `/dashboard/profitability/export?${ALL}`,
    "/customers/export", `/customers/${c}/ledger/export`, `/customers/${ids.idle}/ledger/export`, `/customers/${ids.symbols}/ledger/export`, `/customers/${ids.tamil}/ledger/export`,
    "/vendors/export", `/vendors/${v}/ledger/export`, `/vendors/${ids.tamilVendor}/ledger/export`, `/vendors/${v}/report/export?period=month`, `/vendors/${v}/report/export?period=quarter`,
    "/sales/export", "/purchases/export", "/expenses/export", "/day-book/export", `/day-book/export?date=${new Date().toLocaleDateString("en-CA")}`,
    "/stock-ledger/export", "/stock-ledger/export?type=purchase",
    "/products/stock-report", "/products/composition-report", "/products/expiry-tracker/export",
    "/racks/stock", "/racks/expiry?days=3650",
  ];
  for (const u of urls) {
    assert.ok((await excel(u)).length > 0, u);
    assert.ok(squash((await pdf(u)).text).length > 40, `${u} pdf is blank`);
  }
  for (const u of ["/products/import/template", "/imports/purchases/template", "/imports/sales/template"]) {
    const r = await get(u);
    assert.equal(r.status, 200, u);
    await new ExcelJS.Workbook().xlsx.load(r.body);
  }
});

test("sales, purchases and expenses exports hold the same records as their lists", async () => {
  for (const [list, key, header] of [["/sales", "billNo", "Bill No"], ["/purchases", "invoiceNo", "Invoice No"]]) {
    for (const q of ["", "?payment=paid", "?paymentMode=Credit", "?from=2026-03-05&to=2026-03-05"]) {
      const rows = await json(list + q);
      const [sheet] = await excel(`${list}/export${q}`);
      assert.deepEqual(sheet.slice(1).map((r) => r[col(sheet, header)]).sort(), rows.map((r) => r[key]).sort(), list + q);
      const total = (xs) => xs.reduce((s, n) => s + Number(n), 0).toFixed(2);
      assert.equal(total(sheet.slice(1).map((r) => r[col(sheet, "Total")])), total(rows.map((r) => r.total)));
    }
  }
  const expenses = await json("/expenses");
  const [sheet] = await excel("/expenses/export");
  assert.equal(sheet.length - 1, expenses.length);
});

test("customer and vendor downloads follow the page's search and filter", async () => {
  const names = async (url) => (await excel(url))[0].slice(1).map((r) => r[0]).sort();
  const customers = await json("/customers?q=%20");
  const vendors = await json("/vendors");
  const of = (rows) => rows.map((r) => r.name).sort();
  assert.deepEqual(await names("/customers/export"), of(customers));
  assert.deepEqual(await names("/customers/export?show=due"), of(customers.filter((c) => c.outstandingBalance > 0)));
  assert.deepEqual(await names("/customers/export?show=new"), of(customers.filter((c) => c.billCount === 0)));
  assert.deepEqual(await names("/customers/export?show=top"), of(customers.filter((c) => c.totalSales > 0).sort((a, b) => b.totalSales - a.totalSales).slice(0, 10)));
  assert.deepEqual(await names("/customers/export?q=anna"), ["No Phone Customer"]); // address
  assert.deepEqual(await names("/customers/export?q=findme"), ["Never Bought"]); // email
  assert.deepEqual(await names("/customers/export?q=findme&show=due"), []);
  assert.deepEqual(await names("/vendors/export"), of(vendors));
  assert.deepEqual(await names("/vendors/export?show=due"), of(vendors.filter((v) => v.outstandingPayable > 0)));
  assert.deepEqual(await names("/vendors/export?show=clear"), of(vendors.filter((v) => !(v.outstandingPayable > 0))));
  assert.deepEqual(await names("/vendors/export?show=new"), of(vendors.filter((v) => v.purchaseCount === 0)));
  assert.deepEqual(await names("/vendors/export?q=raghavan"), ["Bare Vendor"]); // contact person
});

test("dates in downloads are India dates, also just after midnight", async () => {
  const dateOf = (sheet, header, value) => sheet.find((r) => r[col(sheet, header)] === value)?.[col(sheet, "Date")];
  assert.equal(dateOf((await excel("/sales/export"))[0], "Bill No", "EARLY-1"), "2026-03-05");
  assert.equal(dateOf((await excel("/purchases/export"))[0], "Invoice No", "EARLY-P"), "2026-03-05");
  assert.equal(dateOf((await excel("/expenses/export"))[0], "Notes", "EARLYNOTE"), "2026-03-05");
  assert.equal(dateOf((await excel(`/customers/${ids.nophone}/ledger/export`))[0], "Ref", "EARLY-1"), "2026-03-05");
  assert.equal(dateOf((await excel(`/vendors/${ids.bareVendor}/ledger/export`))[0], "Ref", "EARLY-P"), "2026-03-05");
  const book = await excel("/dashboard/export?from=2026-03-05&to=2026-03-05");
  const sales = book.find((s) => s[0].includes("Bill No"));
  assert.equal(dateOf(sales, "Bill No", "EARLY-1"), "2026-03-05");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  assert.match((await get(withFormat("/day-book/export", "pdf"))).headers.get("content-disposition"), new RegExp(`DayBook_${today}`));
});

test("a customer or vendor without a phone has a clean ledger heading", async () => {
  assert.match((await pdf(`/customers/${ids.nophone}/ledger/export`)).text, /Ledger\s+Outstanding: Rs\./);
  assert.match((await pdf(`/vendors/${ids.bareVendor}/ledger/export`)).text, /Ledger\s+Outstanding Payable: Rs\./);
  assert.doesNotMatch((await pdf(`/vendors/${ids.bareVendor}/report/export?period=month`)).text, /·\s+(·|\d+ record)/);
});

test("Tamil names print correctly in every kind of PDF", async () => {
  for (const u of [`/reports/management?report=sales-customer&${ALL}`, "/customers/export", "/vendors/export", "/sales/export", "/purchases/export", `/customers/${ids.tamil}/ledger/export`, `/reports/export?sections=parties,sales,transactions&${ALL}`])
    assertTamil((await pdf(u)).text, u);
  // and Excel keeps them exactly
  assert.ok((await excel("/customers/export"))[0].some((r) => r[0] === TAMIL));
});

test("bill and invoice copies: English bills are unchanged, Tamil ones are readable", async () => {
  const bill = async (id) => {
    const r = await get(`/sales/${id}/pdf`);
    assert.equal(r.status, 200);
    assert.equal(r.type, "application/pdf");
    return readPdf(r.body);
  };
  const plain = await bill(ids.plainSale);
  const { billText } = await json(`/sales/${ids.plainSale}`);
  assert.equal(squash(plain.text), squash(billText));
  const tamil = await bill(ids.tamilSale);
  assertTamil(tamil.text, "bill");
  const total = (await json(`/sales/${ids.tamilSale}`)).billText.match(/NET PAYABLE: ([\d.]+)/)[1];
  assert.ok(squash(tamil.text).includes(`NETPAYABLE:${total}`));
  for (const kind of ["sales", "purchase"]) {
    const r = await get(`/invoice-archive/${kind}/pending?limit=100`);
    assert.equal(r.status, 200, `${kind} pending ${r.body}`);
    const list = JSON.parse(r.body);
    assert.ok(list.length > 0, `no ${kind} copies to check`);
    assert.ok(list.every((inv) => inv._id || inv.id));
    for (const inv of list) {
      const id = inv._id || inv.id;
      const p = await get(`/invoice-archive/${kind}/${id}/file.pdf`);
      const x = await get(`/invoice-archive/${kind}/${id}/file.xlsx`);
      assert.equal(p.status, 200, `${kind} pdf ${p.body.slice(0, 100)}`);
      assert.equal(x.status, 200);
      assert.doesNotMatch((await readPdf(p.body)).text, JUNK);
      await new ExcelJS.Workbook().xlsx.load(x.body);
    }
  }
});

test("a very long note stays in its own row", async () => {
  const { pages, text } = await pdf("/expenses/export");
  assert.ok(pages <= 4, `${pages} pages`);
  assert.ok(squash(text).includes(`Page${pages}of${pages}`));
  assert.ok((await excel("/expenses/export"))[0].some((r) => String(r.at(-1)).endsWith("ENDOFNOTE"))); // nothing cut in Excel
});

// ---------- sign-in, permissions, errors ----------

test("downloads need a valid sign-in and the right permission", async () => {
  const m = `/reports/management?report=sales-daily&${ALL}`;
  const adminOnly = ["/customers/export", "/vendors/export", "/purchases/export", "/expenses/export", "/stock-ledger/export", "/day-book/export", `/dashboard/export?${ALL}`, "/products/stock-report", "/products/expiry-tracker/export", `/customers/${ids.tamil}/ledger/export`, `/vendors/${ids.bareVendor}/ledger/export`];
  for (const f of ["excel", "pdf"]) {
    for (const u of [m, `/reports/export?${ALL}`, "/sales/export", "/racks/stock", ...adminOnly]) {
      const url = withFormat(u, f);
      for (const [who, code] of [[null, "NO_TOKEN"], ["expired", "TOKEN_EXPIRED"], ["forged", "TOKEN_INVALID"], ["gone", "SESSION_REVOKED"]]) {
        const r = await get(url, who);
        assert.equal(r.status, 401, `${url} as ${who}`);
        assert.equal(JSON.parse(r.body).code, code);
      }
    }
    for (const u of [m, `/reports/export?${ALL}`]) {
      assert.equal((await get(withFormat(u, f), "view")).status, 403);
      assert.equal((await get(withFormat(u, f), "export")).status, 200);
    }
    for (const u of adminOnly) assert.equal((await get(withFormat(u, f), "export")).status, 403, u);
  }
  assert.equal((await get(m, "view")).status, 200); // may look, not download
});

test("the browser on the live site may read every download (CORS)", async () => {
  const r = await get(withFormat(`/reports/management?report=sales-daily&${ALL}`, "pdf"));
  assert.equal(r.headers.get("access-control-allow-origin"), "https://med-shop-lac.vercel.app");
  assert.match(r.headers.get("access-control-expose-headers") || "", /Content-Disposition/i);
});

test("bad requests get a JSON message, never a server error or a broken file", async () => {
  for (const u of ["/day-book/export?date=abc", "/day-book?date=abc", "/sales/export?from=abc", "/purchases/export?from=abc", "/expenses/export?to=abc", `/reports/management?report=sales-daily&from=abc`, "/reports/export?from=abc", "/dashboard/export?from=abc", "/dashboard/profitability/export?from=abc", "/customers/export?q[]=a", "/vendors/export?q[]=a", "/stock-ledger/export?product=abc", "/stock-ledger/extra/export?from=abc", "/stock-ledger/extra/export?product=abc", "/stock-ledger/inward-report/export?to=abc", "/stock-ledger/inward-report/export?product=abc", "/customers/abc/ledger/export", "/vendors/abc/ledger/export", "/vendors/abc/report/export"])
    for (const f of ["excel", "pdf"]) {
      const r = await get(withFormat(u, f));
      assert.ok(r.status < 500, `${u} ${f} -> ${r.status}`);
      if (r.status >= 400) {
        assert.match(r.type, /application\/json/, `${u} ${f}`);
        assert.ok(JSON.parse(r.body).message);
        assert.equal(r.headers.get("content-disposition"), null);
      }
    }
});

// ---------- Extra Stock Addition ----------

async function send(method, url, body) {
  const r = await fetch(API + url, { method, headers: { Authorization: `Bearer ${tokens.admin}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

test("extra stock: raises stock, keeps its own history, never touches purchases", async () => {
  const product = await Product.findOne({ qty: { $gt: 0 } }).lean();
  const before = { qty: product.qty, purchases: await Purchase.countDocuments(), vendors: await Vendor.countDocuments(), purchaseQty: (await json(`/stock-ledger/inward-report?${ALL}`)).purchase.totalQty };
  const today = new Date().toLocaleDateString("en-CA");
  const base = { product: product._id, qty: 7, date: "2026-03-05", reason: "Found Stock", remarks: "Behind rack A" };

  for (const [bad, why] of [[{ qty: 0 }, "zero"], [{ qty: 1.5 }, "fraction"], [{ reason: "" }, "no reason"], [{ reason: "Gift" }, "unknown reason"], [{ date: "" }, "no date"], [{ date: "2999-01-01" }, "future"], [{ reason: "Other", remarks: "" }, "other without remark"], [{ product: "" }, "no item"]]) {
    const r = await send("POST", "/stock-ledger/extra", { ...base, ...bad });
    assert.equal(r.status, 400, why);
    assert.ok(r.body.message, why);
  }
  assert.equal((await Product.findById(product._id)).qty, before.qty, "a refused entry changes nothing");

  const a = await send("POST", "/stock-ledger/extra", base);
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const b = await send("POST", "/stock-ledger/extra", { ...base, qty: 5, date: today, reason: "Free Items", remarks: "", batchNo: "FREE-1", costPrice: 0 });
  assert.equal(b.status, 201, JSON.stringify(b.body));

  assert.equal((await Product.findById(product._id)).qty, before.qty + 12);
  assert.equal(await Purchase.countDocuments(), before.purchases);
  assert.equal(await Vendor.countDocuments(), before.vendors);
  const entry = await StockLedger.findById(a.body.entry._id).lean();
  assert.equal(entry.type, "extra-stock");
  assert.equal(entry.refId, null);
  assert.equal(entry.qtyChange, 7);

  const list = await json(`/stock-ledger/extra?product=${product._id}`);
  assert.equal(list.rows.length, 2);
  assert.equal(list.totalQty, 12);
  assert.deepEqual(list.rows.map((r) => r.date), [today, "2026-03-05"], "newest first, by the chosen date");
  assert.equal(list.rows[1].remarks, "Behind rack A");
  assert.equal(list.rows[1].user, "admin");
  assert.equal((await json(`/stock-ledger/extra?product=${product._id}&reason=Free%20Items`)).rows.length, 1);
  assert.equal((await json(`/stock-ledger/extra?product=${product._id}&from=2026-03-05&to=2026-03-05`)).rows.length, 1);

  const report = await json(`/stock-ledger/inward-report?${ALL}`);
  assert.equal(report.purchase.totalQty, before.purchaseQty, "purchase inward unchanged");
  assert.ok(report.extra.rows.some((r) => r.id === String(entry._id)));
  assert.equal(report.totalQty, report.purchase.totalQty + report.extra.totalQty);
  assert.ok(report.purchase.rows.every((r) => r.invoiceNo && r.qty !== 0));

  const sheets = await excel(`/stock-ledger/inward-report/export?${ALL}`);
  assert.equal(sheets.length, 3);
  assert.equal(sheets[1].length - 1, report.purchase.rows.length);
  assert.equal(sheets[2].length - 1, report.extra.rows.length);
  const extraSheet = (await excel(`/stock-ledger/extra/export?product=${product._id}`))[0];
  assert.equal(extraSheet.length - 1, 2);
  assert.equal(extraSheet[2][col(extraSheet, "Reason")], "Found Stock");
  const { text } = await pdf(`/stock-ledger/inward-report/export?${ALL}`);
  assert.ok(squash(text).includes(squash("Found Stock")));
  await pdf(`/stock-ledger/extra/export?product=${product._id}`);
});
