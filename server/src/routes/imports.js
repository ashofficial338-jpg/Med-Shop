import crypto from "node:crypto";
import { Router } from "express";
import Product from "../models/Product.js";
import Purchase from "../models/Purchase.js";
import Sale from "../models/Sale.js";
import Batch from "../models/Batch.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { rackPositionError, NO_RACK } from "../utils/rack.js";
import { normalizeName, toPackUnit } from "../utils/productAutoCreate.js";
import { saleLineInternalQty } from "../utils/saleHelpers.js";
import { cleanPhone, partyKey } from "../utils/parties.js";
import Vendor from "../models/Vendor.js";
import { mapHeaders, rowFields, text, num, parseDate, todayIso, pickOption, streamTemplate, headerKey } from "../utils/excelImport.js";

// Excel upload for Purchases and Sales (Admin): Download Template -> Fill ->
// Upload -> Save.
//
//   GET  /api/imports/purchases/template   the .xlsx template
//   POST /api/imports/purchases/check      read rows -> entries ready to save
//   GET  /api/imports/sales/template
//   POST /api/imports/sales/check
//
// "check" never saves anything. It groups the rows into invoices and returns,
// for each, either the exact request body to save it with or the problems that
// stop it. The browser then saves each one through the normal POST
// /api/purchases or /api/sales - the same validation, stock, ledger, GST and
// supplier / customer handling as entering it by hand. Anything that can be
// worked out (a blank date, a missing invoice number, a new product, supplier
// or customer) is, rather than asked about; only what would make a wrong
// record is a problem.

const router = Router();
router.use(requireAuth, requireRole("admin"));

const GST_VALUES = [0, 5, 12, 18, 28];
const PURCHASE_MODES = ["Credit", "Cash", "Bank Transfer", "Cheque", "UPI", "Other"];
const SALE_MODES = ["Cash", "Card", "UPI", "Other", "Credit"];
const PACK_UNITS = ["Strip", "Bottle", "Box", "Tube", "Vial", "Jar", "Piece"];
const MAX_ROWS = 20000;
const round2 = (n) => Number(Number(n || 0).toFixed(2));
const fmt = (n) => `₹${round2(n).toFixed(2)}`;
const escapeRegex = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const dmy = (iso) => iso.split("-").reverse().join("-");

// The file's headers -> fields. Several spellings are understood, so a
// supplier's or billing software's own export usually maps without edits.
const PURCHASE_ALIASES = {
  invoiceNo: ["invoiceno", "invoice", "invoicenumber", "invno", "billno", "billnumber", "purchaseinvoiceno", "supplierinvoiceno"],
  date: ["date", "invoicedate", "billdate", "purchasedate", "invdate"],
  supplier: ["supplier", "suppliername", "vendor", "vendorname", "distributor", "party", "partyname"],
  product: ["product", "productname", "item", "itemname", "medicine", "medicinename", "name", "brandname", "description"],
  qty: ["qty", "quantity", "qtypacks", "packs", "quantitypacks", "noofpacks"],
  rate: ["rate", "purchaserate", "costprice", "cost", "purchaseprice", "ptr", "rateperpack"],
  discount: ["discount", "discountpercent", "disc", "discpercent", "tradediscount"],
  gst: ["gst", "gstpercent", "gstrate", "tax", "taxpercent", "gstpercentage"],
  batchNo: ["batch", "batchno", "batchnumber", "lot", "lotno"],
  expiry: ["expiry", "expirydate", "exp", "expdate", "expireson"],
  rack: ["rack", "rackposition", "location", "shelf"],
  sellingPrice: ["sellingprice", "mrp", "salerate", "sellingrate", "packrate", "saleprice"],
  hsn: ["hsn", "hsncode", "hsnsac"],
  packUnit: ["packunit", "unit", "uom", "pack"],
  unitsPerPack: ["unitsperpack", "unitsinpack", "tabletsperstrip", "packsize", "looseunits"],
  paymentMode: ["paymentmode", "payment", "mode", "paymode", "paymenttype"],
  amountPaid: ["amountpaid", "paid", "paidnow", "paidamount"],
};

const SALE_ALIASES = {
  invoiceNo: ["invoiceno", "invoice", "invoicenumber", "invno", "billno", "billnumber", "ref", "invoiceref", "receiptno"],
  date: ["date", "invoicedate", "billdate", "saledate", "invdate"],
  customer: ["customer", "customername", "patient", "patientname", "name", "party", "partyname"],
  phone: ["phone", "mobile", "customerphone", "customermobile", "mobileno", "phoneno", "contact", "contactno"],
  product: ["product", "productname", "item", "itemname", "medicine", "medicinename", "brandname", "description"],
  unit: ["unittype", "unit", "packorloose", "saleunit", "sellingunit", "uom"],
  qty: ["qty", "quantity", "qtysold"],
  rate: ["rate", "sellingrate", "sellingprice", "price", "mrp", "salerate", "saleprice", "unitprice"],
  gst: ["gst", "gstpercent", "gstrate", "tax", "taxpercent", "gstpercentage"],
  discount: ["discount", "discountamount", "disc", "billdiscount"],
  paymentMode: ["paymentmode", "payment", "mode", "paymode", "paymenttype"],
  amountReceived: ["amountreceived", "received", "paid", "amountpaid", "receivednow"],
};

// ---------- templates ----------

router.get("/purchases/template", async (req, res) => {
  await streamTemplate(res, "GuganMedicals_Purchase_Upload_Template.xlsx", {
    sheetName: "Purchases",
    columns: [
      { header: "Invoice No", key: "invoiceNo", width: 16, note: "Rows with the same Supplier and Invoice No are one purchase. Blank = numbered automatically." },
      { header: "Invoice Date", key: "date", width: 14, date: true, note: "DD-MM-YYYY. Blank = today." },
      { header: "Supplier Name", key: "supplier", width: 26, note: "A new supplier is added to the Supplier List automatically. Blank = no supplier." },
      { header: "Product Name", key: "product", width: 28, required: true, note: "Required. A new product is added to the Product List automatically." },
      { header: "Qty (Packs)", key: "qty", width: 12, required: true, note: "Required. Whole packs (strips, bottles...)." },
      { header: "Purchase Rate", key: "rate", width: 15, note: "Cost per pack, before discount and GST." },
      { header: "Discount %", key: "discount", width: 12, note: "Trade discount on this line. Blank = 0." },
      { header: "GST %", key: "gst", width: 9, options: GST_VALUES.map(String), note: "For a new product. An existing product keeps its saved GST." },
      { header: "Selling Price", key: "sellingPrice", width: 14, note: "Per pack. Becomes the product's price." },
      { header: "Batch No", key: "batchNo", width: 14, note: "Blank = the invoice number." },
      { header: "Expiry Date", key: "expiry", width: 13, note: "DD-MM-YYYY or MM/YY (06/28 = end of June 2028)." },
      { header: "Pack Unit", key: "packUnit", width: 11, options: PACK_UNITS, note: "For a new product. Blank = Strip." },
      { header: "Units Per Pack", key: "unitsPerPack", width: 14, note: "For a new product sold loose too, e.g. 10 tablets in a strip." },
      { header: "Payment Mode", key: "paymentMode", width: 15, options: PURCHASE_MODES, note: "Blank = Credit with a supplier, Cash without." },
      { header: "Amount Paid", key: "amountPaid", width: 13, note: "For Credit purchases: amount paid now (on any one row of the invoice)." },
    ],
    samples: [
      { invoiceNo: "INV-1001", date: "20-11-2026", supplier: "Sri Balaji Pharma", product: "Dolo 650", qty: 20, rate: 22.5, discount: 5, gst: 12, sellingPrice: 32, batchNo: "DL2611", expiry: "06/28", packUnit: "Strip", unitsPerPack: 15, paymentMode: "Credit", amountPaid: 100 },
      { invoiceNo: "INV-1001", date: "20-11-2026", supplier: "Sri Balaji Pharma", product: "Cough Syrup", qty: 10, rate: 60, gst: 5, sellingPrice: 85, batchNo: "CS55", expiry: "03/28", packUnit: "Bottle" },
    ],
    instructions: [
      "How to upload purchases",
      "1. Fill the Purchases sheet: one row for each product. Only Product Name and Qty are required.",
      "2. Rows with the same Supplier Name and Invoice No become one purchase.",
      "3. Save the file, then choose Upload Excel on the Purchases page and press Save.",
      "New suppliers and products are added to their lists automatically; existing ones are recognised even if typed in different capitals or spacing.",
      "An invoice that is already recorded is skipped, so uploading the same file again never saves it twice.",
      "The Example sheet shows two filled rows. It is not uploaded.",
    ],
  });
});

router.get("/sales/template", async (req, res) => {
  await streamTemplate(res, "GuganMedicals_Sales_Upload_Template.xlsx", {
    sheetName: "Sales",
    columns: [
      { header: "Invoice No", key: "invoiceNo", width: 16, note: "Rows with the same Invoice No are one bill. Blank = rows for the same customer and date, next to each other, are one bill." },
      { header: "Invoice Date", key: "date", width: 14, date: true, note: "DD-MM-YYYY. Blank = today." },
      { header: "Customer Name", key: "customer", width: 24, note: "A new customer is added to the Customer List automatically. Blank = walk-in." },
      { header: "Customer Phone", key: "phone", width: 16, note: "10 digits. Optional." },
      { header: "Product Name", key: "product", width: 28, required: true, note: "Required. A product you have in stock." },
      { header: "Unit (Pack/Loose)", key: "unit", width: 16, options: ["Pack", "Loose"], note: "Blank = Pack." },
      { header: "Qty", key: "qty", width: 8, required: true, note: "Required. Whole number." },
      { header: "Selling Rate", key: "rate", width: 13, note: "Before GST. Blank = the product's price." },
      { header: "Discount", key: "discount", width: 11, note: "Bill discount in ₹ (on any one row of the bill)." },
      { header: "Payment Mode", key: "paymentMode", width: 15, options: SALE_MODES, note: "Blank = Cash. Credit needs a customer." },
      { header: "Amount Received", key: "amountReceived", width: 17, note: "For Credit bills: amount received now (on any one row of the bill)." },
    ],
    samples: [
      { invoiceNo: "S-5001", date: "21-11-2026", customer: "Ravi Kumar", phone: "9876543210", product: "Dolo 650", unit: "Pack", qty: 2, rate: 32, paymentMode: "Credit", amountReceived: 20 },
      { invoiceNo: "S-5002", date: "21-11-2026", product: "Cough Syrup", unit: "Pack", qty: 1, rate: 85, discount: 5, paymentMode: "UPI" },
    ],
    instructions: [
      "How to upload sales",
      "1. Fill the Sales sheet: one row for each product sold. Only Product Name and Qty are required.",
      "2. Rows with the same Invoice No become one bill.",
      "3. Save the file, then choose Upload Excel on the Bills page and press Save.",
      "New customers are added to the Customer List automatically; existing ones are recognised by phone or name.",
      "Stock is reduced as at the counter, so products must have been purchased first.",
      "A bill that is already uploaded is skipped, so uploading the same file again never saves it twice.",
      "The Example sheet shows two filled rows. It is not uploaded.",
    ],
  });
});

// ---------- shared ----------

// Body: { rows: [{ row, cells: { header: value } }] } -> mapped rows.
function readRows(req, aliases, required) {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows) return { error: "Choose an Excel file to upload." };
  if (rows.length === 0) return { error: "The file has no rows. Fill the template below its header row." };
  if (rows.length > MAX_ROWS) return { error: `The file has ${rows.length} rows; upload at most ${MAX_ROWS} at a time.` };
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r.cells || {})))];
  const { fieldByHeader, mapped } = mapHeaders(headers, aliases);
  const have = new Set(mapped.map((m) => m.field));
  const missing = required.filter(([field]) => !have.has(field)).map(([, label]) => label);
  if (missing.length) return { error: `The file has no ${missing.join(" or ")} column. Please use the template.` };
  const out = rows.map((r) => ({ row: Number(r.row) || 0, f: rowFields(r.cells, fieldByHeader) })).filter((r) => Object.keys(r.f).length > 0);
  if (!out.length) return { error: "The file has no rows. Fill the template below its header row." };
  return { rows: out };
}

// An invoice's value: the first one filled in across its rows.
const firstOf = (rows, field) => rows.find((r) => r.f[field] !== undefined)?.f[field];

// Rows that belong together. With an invoice number, all rows having it; the
// rest, as long as they follow one another with the same party and date.
function groupRows(rows, partyOf, dateOf, numbered) {
  const groups = [];
  const byNumber = new Map();
  let open = null;
  for (const r of rows) {
    const no = text(r.f.invoiceNo).toLowerCase();
    if (no) {
      const key = numbered(no, partyOf(r));
      if (!byNumber.has(key)) {
        byNumber.set(key, { rows: [] });
        groups.push(byNumber.get(key));
      }
      byNumber.get(key).rows.push(r);
      open = null;
      continue;
    }
    const same = `${partyOf(r)}|${dateOf(r)}`;
    if (!open || open.same !== same) {
      open = { same, rows: [] };
      groups.push(open);
    }
    open.rows.push(r);
  }
  return groups.map((g) => g.rows);
}

// The same rows uploaded again are the same entry (see utils/transaction.js).
const rowsRef = (kind, rows) => `xl-${crypto.createHash("sha256").update(JSON.stringify([kind, rows.map((r) => [r.row, r.f])])).digest("hex").slice(0, 40)}`;

const readDate = (value, today, errors) => {
  if (value === undefined) return today;
  const d = parseDate(value);
  if (!d) errors.push(`Date "${value}" isn't a date. Use DD-MM-YYYY.`);
  else if (d > today) errors.push(`Date ${dmy(d)} is in the future.`);
  else return d;
  return today;
};

const productsByKey = (products) => {
  const map = new Map();
  for (const p of products) map.set(normalizeName(p.name), p);
  for (const p of products) if (p.productCode && !map.has(normalizeName(p.productCode))) map.set(normalizeName(p.productCode), p);
  return map;
};

const summarize = (entries) => ({
  entries,
  ready: entries.filter((e) => e.save).length,
  alreadySaved: entries.filter((e) => e.alreadySaved).length,
  problems: entries.flatMap((e) => e.problems),
});

// ---------- purchases ----------

router.post("/purchases/check", async (req, res) => {
  const read = readRows(req, PURCHASE_ALIASES, [["product", "Product Name"], ["qty", "Qty"]]);
  if (read.error) return res.status(400).json({ message: read.error });

  const today = todayIso();
  const [vendors, products] = await Promise.all([
    Vendor.find({}, "name").lean(),
    Product.find({ isActive: true }, "name productCode gstPercent rack").lean(),
  ]);
  const vendorByKey = new Map(vendors.map((v) => [partyKey(v.name), v]));
  const productByKey = productsByKey(products);
  const rackOk = new Map();

  const groups = groupRows(
    read.rows,
    (r) => partyKey(r.f.supplier),
    (r) => text(r.f.date),
    (no, party) => `${party}|${no}`
  );
  const invoiceNos = [...new Set(read.rows.map((r) => text(r.f.invoiceNo)).filter(Boolean))];
  const refs = groups.map((rows) => rowsRef("purchase", rows));
  const recorded = invoiceNos.length
    ? await Purchase.find({ invoiceNo: { $in: invoiceNos.map((n) => new RegExp(`^${escapeRegex(n)}$`, "i")) } }, "vendor invoiceNo").lean()
    : [];
  const uploaded = new Set((await Purchase.find({ clientRef: { $in: refs } }, "clientRef").lean()).map((p) => p.clientRef));

  const entries = [];
  for (const [g, rows] of groups.entries()) {
    const errors = [];
    const invoiceNo = text(firstOf(rows, "invoiceNo")).slice(0, 60);
    const supplierName = text(firstOf(rows, "supplier")).slice(0, 150);
    const vendor = supplierName ? vendorByKey.get(partyKey(supplierName)) : null;
    const date = readDate(firstOf(rows, "date"), today, errors);

    let paymentMode = supplierName ? "Credit" : "Cash";
    const mode = firstOf(rows, "paymentMode");
    if (mode !== undefined) {
      const m = pickOption(mode, PURCHASE_MODES);
      if (!m) errors.push(`Payment Mode "${mode}" must be ${PURCHASE_MODES.join(", ")}.`);
      else paymentMode = m;
    }
    if (paymentMode === "Credit" && !supplierName) errors.push("A Credit purchase needs a Supplier Name.");

    const alreadySaved =
      uploaded.has(refs[g]) ||
      (Boolean(invoiceNo) && recorded.some((p) => p.invoiceNo.toLowerCase() === invoiceNo.toLowerCase() && String(p.vendor || "") === String(vendor?._id || "")));

    let subtotal = 0;
    let gstAmount = 0;
    const items = [];
    for (const r of rows) {
      const f = r.f;
      const bad = (m) => errors.push(`Row ${r.row}: ${m}`);
      const name = text(f.product).slice(0, 150);
      const product = name ? productByKey.get(normalizeName(name)) : null;
      if (!normalizeName(name)) bad("Product Name is missing.");
      const qty = num(f.qty);
      if (!(qty > 0) || !Number.isInteger(qty)) bad(f.qty === undefined ? "Qty is missing." : `Qty "${f.qty}" must be a whole number above 0.`);
      const rate = num(f.rate) ?? 0;
      if (!(rate >= 0)) bad(`Purchase Rate "${f.rate}" isn't a valid amount.`);
      const discountPercent = num(f.discount) ?? 0;
      if (!(discountPercent >= 0 && discountPercent <= 100)) bad(`Discount "${f.discount}" must be 0 to 100%.`);
      const gstIn = num(f.gst);
      if (!product && gstIn !== undefined && !GST_VALUES.includes(gstIn)) bad(`GST "${f.gst}" must be 0, 5, 12, 18 or 28.`);
      const gst = product ? product.gstPercent : gstIn ?? 0;
      let expiryDate;
      if (f.expiry !== undefined) {
        expiryDate = parseDate(f.expiry, { monthOnly: true });
        if (!expiryDate) bad(`Expiry "${f.expiry}" isn't a date. Use DD-MM-YYYY or MM/YY.`);
      }
      const sellingPrice = num(f.sellingPrice);
      if (sellingPrice !== undefined && !(sellingPrice >= 0)) bad(`Selling Price "${f.sellingPrice}" isn't a valid amount.`);
      const unitsPerPack = num(f.unitsPerPack);
      if (!product && unitsPerPack !== undefined && !(Number.isInteger(unitsPerPack) && unitsPerPack >= 1)) bad(`Units Per Pack "${f.unitsPerPack}" must be a whole number.`);

      // An unknown rack isn't worth refusing a purchase for.
      let rack = product?.rack || "";
      if (f.rack !== undefined) {
        const raw = /^no\s*rack$/i.test(text(f.rack)) ? NO_RACK : text(f.rack).toUpperCase();
        if (!rackOk.has(raw)) rackOk.set(raw, !(await rackPositionError(raw, { required: false })));
        if (rackOk.get(raw)) rack = raw;
      }

      const amount = round2((qty > 0 ? qty : 0) * rate * (1 - discountPercent / 100));
      subtotal += amount;
      gstAmount += round2((amount * gst) / 100);
      items.push({
        ...(product
          ? { product: product._id }
          : { newProduct: { name, gstPercent: gst, hsnCode: text(f.hsn), packUnit: toPackUnit(f.packUnit), unitsPerPack: unitsPerPack > 1 ? unitsPerPack : undefined, looseUnitName: unitsPerPack > 1 ? "Tablet" : undefined } }),
        qtyPacks: qty,
        costPrice: rate,
        discountPercent,
        ...(sellingPrice !== undefined ? { sellingPrice } : {}),
        batchNo: text(f.batchNo).slice(0, 30),
        expiryDate: expiryDate || undefined,
        rack,
      });
    }

    const total = round2(subtotal + gstAmount);
    let amountPaid = 0;
    const paid = num(firstOf(rows, "amountPaid"));
    if (paid !== undefined && paymentMode === "Credit") {
      if (!(paid >= 0)) errors.push(`Amount Paid "${firstOf(rows, "amountPaid")}" isn't a valid amount.`);
      else if (paid > total + 0.01) errors.push(`Amount Paid ${fmt(paid)} is more than the total ${fmt(total)}.`);
      else amountPaid = round2(paid);
    }

    const where = `${invoiceNo || `Row ${rows[0].row}`}${supplierName ? ` (${supplierName})` : ""}`;
    entries.push({
      ref: invoiceNo || `Row ${rows[0].row}`,
      party: vendor?.name || supplierName || "No supplier",
      isNewParty: Boolean(supplierName) && !vendor,
      total,
      alreadySaved,
      problems: alreadySaved ? [] : errors.map((m) => `${where}: ${m}`),
      save:
        alreadySaved || errors.length
          ? null
          : { endpoint: "/purchases", body: { clientRef: refs[g], ...(vendor ? { vendor: vendor._id } : { supplierName }), invoiceNo, date, paymentMode, amountPaid, items } },
    });
  }
  res.json(summarize(entries));
});

// ---------- sales ----------

router.post("/sales/check", async (req, res) => {
  const read = readRows(req, SALE_ALIASES, [["product", "Product Name"], ["qty", "Qty"]]);
  if (read.error) return res.status(400).json({ message: read.error });

  const today = todayIso();
  const products = await Product.find({ isActive: true }, "name productCode gstPercent packRate looseRate soldAs unitsPerPack packUnit looseUnitName qty").lean();
  const productByKey = productsByKey(products);

  const groups = groupRows(
    read.rows,
    (r) => `${partyKey(r.f.customer)}${cleanPhone(r.f.phone)}`,
    (r) => text(r.f.date),
    (no) => no
  );
  const refs = groups.map((rows) => rowsRef("sale", rows));
  const invoiceNos = [...new Set(read.rows.map((r) => text(r.f.invoiceNo)).filter(Boolean))];
  const imported = new Set(
    (invoiceNos.length ? await Sale.find({ importRef: { $in: invoiceNos.map((n) => new RegExp(`^${escapeRegex(n.slice(0, 60))}$`, "i")) } }, "importRef").lean() : []).map((s) => s.importRef.toLowerCase())
  );
  const uploaded = new Set((await Sale.find({ clientRef: { $in: refs } }, "clientRef").lean()).map((s) => s.clientRef));

  // Earliest-expiry batch with stock, per product (what a sale draws first).
  const firstBatch = new Map();
  const usedIds = [...new Set(read.rows.map((r) => productByKey.get(normalizeName(r.f.product))?._id).filter(Boolean).map(String))];
  if (usedIds.length) {
    const batches = await Batch.find({ product: { $in: usedIds }, qtyRemaining: { $gt: 0 }, expiryDate: { $ne: null } }, "product batchNo expiryDate").sort({ expiryDate: 1 }).lean();
    for (const b of batches) if (!firstBatch.has(String(b.product))) firstBatch.set(String(b.product), b);
  }

  const entries = [];
  for (const [g, rows] of groups.entries()) {
    const errors = [];
    const invoiceNo = text(firstOf(rows, "invoiceNo")).slice(0, 60);
    const date = readDate(firstOf(rows, "date"), today, errors);
    const name = text(firstOf(rows, "customer")).slice(0, 100);
    const rawPhone = firstOf(rows, "phone");
    const phone = cleanPhone(rawPhone);
    if (rawPhone !== undefined && !phone) errors.push(`Customer Phone "${rawPhone}" must be a 10-digit number.`);

    let paymentMode = "Cash";
    const mode = firstOf(rows, "paymentMode");
    if (mode !== undefined) {
      const m = pickOption(mode, SALE_MODES);
      if (!m) errors.push(`Payment Mode "${mode}" must be ${SALE_MODES.join(", ")}.`);
      else paymentMode = m;
    }
    if (paymentMode === "Credit" && !name && !phone) errors.push("A Credit bill needs a Customer Name.");

    const alreadySaved = uploaded.has(refs[g]) || (Boolean(invoiceNo) && imported.has(invoiceNo.toLowerCase()));

    let overrideExpired = false;
    let subtotal = 0;
    let gstAmount = 0;
    const items = [];
    for (const r of rows) {
      const f = r.f;
      const bad = (m) => errors.push(`Row ${r.row}: ${m}`);
      const pname = text(f.product);
      const product = pname ? productByKey.get(normalizeName(pname)) : null;
      if (!pname) bad("Product Name is missing.");
      else if (!product) bad(`"${pname}" isn't in the Product List. Enter its purchase first.`);

      let unitType = "pack";
      const u = headerKey(f.unit);
      if (["loose", "l", "tablet", "tab", "capsule", "cap", "unit", "units", "piece", "pcs", "ml"].includes(u) && product?.soldAs === "pack-and-loose") unitType = "loose";
      else if (u === "loose") bad(`${pname} isn't sold loose.`);

      const qty = num(f.qty);
      if (!(qty > 0) || !Number.isInteger(qty)) bad(f.qty === undefined ? "Qty is missing." : `Qty "${f.qty}" must be a whole number above 0.`);
      const current = product ? (unitType === "pack" ? product.packRate : product.looseRate) : 0;
      const given = num(f.rate);
      if (given !== undefined && !(given >= 0)) bad(`Selling Rate "${f.rate}" isn't a valid amount.`);
      const rate = given >= 0 ? round2(given) : current;

      if (product) {
        const b = firstBatch.get(String(product._id));
        const exp = b ? new Date(b.expiryDate).toISOString().slice(0, 10) : null;
        if (exp && exp < date) bad(`the next batch of ${product.name} (${b.batchNo}) had expired on ${dmy(exp)}.`);
        else if (exp && exp < today) overrideExpired = true; // it was still valid on the bill's date
      }

      const amount = round2((qty > 0 ? qty : 0) * rate);
      subtotal += amount;
      gstAmount += round2((amount * (product?.gstPercent || 0)) / 100);
      if (product && qty > 0) items.push({ product: product._id, unitType, qty, rate, _need: saleLineInternalQty(product, unitType, qty), _row: r.row });
    }

    const gross = round2(subtotal + gstAmount);
    let discount = 0;
    const d = num(firstOf(rows, "discount"));
    if (d !== undefined) {
      if (!(d >= 0)) errors.push(`Discount "${firstOf(rows, "discount")}" isn't a valid amount.`);
      else if (d > gross + 0.005) errors.push(`Discount ${fmt(d)} is more than the bill amount ${fmt(gross)}.`);
      else discount = round2(d);
    }
    const total = round2(gross - discount);
    let amountReceived = 0;
    const rcv = num(firstOf(rows, "amountReceived"));
    if (rcv !== undefined && paymentMode === "Credit") {
      if (!(rcv >= 0)) errors.push(`Amount Received "${firstOf(rows, "amountReceived")}" isn't a valid amount.`);
      else if (rcv > total + 0.01) errors.push(`Amount Received ${fmt(rcv)} is more than the total ${fmt(total)}.`);
      else amountReceived = round2(rcv);
    }

    entries.push({
      ref: invoiceNo || `Row ${rows[0].row}`,
      party: name || phone || "Walk-in",
      date,
      total,
      alreadySaved,
      errors,
      items,
      body: {
        clientRef: refs[g],
        ...(name || phone ? { newCustomer: { name, phone } } : {}),
        paymentMode,
        discount,
        ...(paymentMode === "Credit" ? { amountReceived } : {}),
        date,
        ...(invoiceNo ? { importRef: invoiceNo } : {}),
        ...(overrideExpired ? { overrideExpired: true, overrideExpiredReason: "Uploaded sale dated before the batch expired" } : {}),
      },
    });
  }

  // Stock: bills are saved oldest first, each taking from what's left.
  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const left = new Map(products.map((p) => [String(p._id), p.qty]));
  for (const e of entries) {
    if (e.alreadySaved || e.errors.length) continue;
    const need = new Map();
    for (const i of e.items) need.set(String(i.product), (need.get(String(i.product)) || 0) + i._need);
    for (const [id, n] of need) {
      if (n <= (left.get(id) || 0)) continue;
      const p = products.find((x) => String(x._id) === id);
      const unit = p.soldAs === "pack-and-loose" ? p.looseUnitName : p.packUnit;
      e.errors.push(`not enough stock of ${p.name}: needs ${n} ${unit}, ${left.get(id) || 0} left. Enter its purchase first.`);
    }
    if (!e.errors.length) for (const [id, n] of need) left.set(id, left.get(id) - n);
  }

  res.json(
    summarize(
      entries.map(({ errors, items, body, ...e }) => ({
        ...e,
        problems: e.alreadySaved ? [] : errors.map((m) => `${e.ref}${e.party !== "Walk-in" ? ` (${e.party})` : ""}: ${m}`),
        save: e.alreadySaved || errors.length ? null : { endpoint: "/sales", body: { ...body, items: items.map(({ _need, _row, ...i }) => i) } },
      }))
    )
  );
});

export default router;
