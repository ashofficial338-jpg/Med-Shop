import { Router } from "express";
import Product from "../models/Product.js";
import Vendor from "../models/Vendor.js";
import Purchase from "../models/Purchase.js";
import Sale from "../models/Sale.js";
import Customer from "../models/Customer.js";
import Batch from "../models/Batch.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { rackPositionError, NO_RACK } from "../utils/rack.js";
import { normalizeName, toPackUnit } from "../utils/productAutoCreate.js";
import { saleLineInternalQty } from "../utils/saleHelpers.js";
import { mapHeaders, rowFields, text, num, parseDate, todayIso, pickOption, streamTemplate, headerKey } from "../utils/excelImport.js";

// Excel upload for Purchases and Sales (Admin).
//
//   GET  /api/imports/purchases/template   the .xlsx template
//   POST /api/imports/purchases/check      read rows -> invoices + problems
//   GET  /api/imports/sales/template
//   POST /api/imports/sales/check
//
// "check" never saves anything. It groups the rows into invoices, checks
// every row against the Product List, suppliers / customers, stock and the
// invoices already recorded, and returns for each invoice its errors (it
// can't be saved), warnings (it can, but look) and the exact request body
// to save it with. The browser then saves each ticked invoice through the
// normal POST /api/purchases, /api/purchases/direct or /api/sales - the
// same validation, stock, ledger and GST handling as entering it by hand.

const router = Router();
router.use(requireAuth, requireRole("admin"));

const GST_VALUES = [0, 5, 12, 18, 28];
const PURCHASE_MODES = ["Credit", "Cash", "Bank Transfer", "Cheque", "UPI", "Other"];
const SALE_MODES = ["Cash", "Card", "UPI", "Other", "Credit"];
const MAX_ROWS = 20000;
const round2 = (n) => Number(Number(n || 0).toFixed(2));
const fmt = (n) => `₹${round2(n).toFixed(2)}`;

// The file's headers -> fields. Several spellings are understood, so a
// supplier's or billing software's own export usually maps without edits.
const PURCHASE_ALIASES = {
  invoiceNo: ["invoiceno", "invoice", "invoicenumber", "invno", "billno", "billnumber", "purchaseinvoiceno", "supplierinvoiceno"],
  date: ["date", "invoicedate", "billdate", "purchasedate", "invdate"],
  supplier: ["supplier", "suppliername", "vendor", "vendorname", "distributor", "party", "partyname"],
  product: ["product", "productname", "item", "itemname", "medicine", "medicinename", "name", "brandname", "description"],
  qty: ["qty", "quantity", "qtypacks", "packs", "quantitypacks", "noofpacks"],
  rate: ["rate", "purchaserate", "costprice", "cost", "purchaseprice", "ptr", "rateperpack"],
  gst: ["gst", "gstpercent", "gstrate", "tax", "taxpercent", "gstpercentage"],
  batchNo: ["batch", "batchno", "batchnumber", "lot", "lotno"],
  expiry: ["expiry", "expirydate", "exp", "expdate", "expiresOn".toLowerCase()],
  rack: ["rack", "rackposition", "location", "shelf"],
  sellingPrice: ["sellingprice", "mrp", "salerate", "sellingrate", "packrate", "saleprice"],
  hsn: ["hsn", "hsncode", "hsnsac"],
  packUnit: ["packunit", "unit", "uom", "pack"],
  paymentMode: ["paymentmode", "payment", "mode", "paymode", "paymenttype"],
  amountPaid: ["amountpaid", "paid", "paidnow", "paidamount"],
  invoiceTotal: ["invoicetotal", "total", "billtotal", "nettotal", "grandtotal", "netamount", "invoiceamount"],
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
  invoiceTotal: ["invoicetotal", "total", "billtotal", "nettotal", "grandtotal", "netamount", "invoiceamount"],
};

// ---------- templates ----------

router.get("/purchases/template", async (req, res) => {
  await streamTemplate(res, "GuganMedicals_Purchase_Upload_Template.xlsx", {
    sheetName: "Purchases",
    columns: [
      { header: "Invoice No", key: "invoiceNo", width: 16, required: true, note: "Required. Rows with the same Supplier and Invoice No are one purchase invoice." },
      { header: "Invoice Date", key: "date", width: 14, date: true, note: "DD-MM-YYYY. Blank = today." },
      { header: "Supplier Name", key: "supplier", width: 24, note: "A registered supplier's name is matched automatically. Any other name is saved as an unregistered supplier (must be paid, not Credit). Blank = purchase without supplier." },
      { header: "Product Name", key: "product", width: 26, required: true, note: "Required. Matched to the Product List ignoring case and spaces. A new name is added to the Product List." },
      { header: "Qty (Packs)", key: "qty", width: 12, required: true, note: "Required. Whole packs (strips, bottles...)." },
      { header: "Purchase Rate (per pack)", key: "rate", width: 16, note: "Cost per pack before GST. Blank = 0." },
      { header: "GST %", key: "gst", width: 10, options: GST_VALUES.map(String), note: "0, 5, 12, 18 or 28. For an existing product its saved GST is used." },
      { header: "Batch No", key: "batchNo", width: 14, note: "Blank = the invoice number." },
      { header: "Expiry Date", key: "expiry", width: 14, note: "DD-MM-YYYY, or MM/YY (e.g. 06/27 = end of June 2027)." },
      { header: "Rack", key: "rack", width: 10, note: "A rack position like A-001, or No Rack. Blank = the product's current rack." },
      { header: "Selling Price (per pack)", key: "sellingPrice", width: 16, note: "Optional. Sets the selling price of a new product." },
      { header: "HSN Code", key: "hsn", width: 12 },
      { header: "Pack Unit", key: "packUnit", width: 12, options: ["Strip", "Bottle", "Box", "Tube", "Vial", "Jar", "Piece"], note: "For new products. Blank = Strip." },
      { header: "Payment Mode", key: "paymentMode", width: 14, options: PURCHASE_MODES, note: "Blank = Credit for a registered supplier, Cash otherwise." },
      { header: "Amount Paid", key: "amountPaid", width: 12, note: "Credit purchases only: amount paid now (once per invoice)." },
      { header: "Invoice Total", key: "invoiceTotal", width: 14, note: "Optional. The bill's total, to cross-check the calculated total." },
    ],
    samples: [
      { invoiceNo: "INV-1001", date: "20-11-2026", supplier: "Sri Balaji Pharma", product: "Dolo 650", qty: 20, rate: 22.5, gst: 12, batchNo: "DL2611", expiry: "06/28", rack: "A-001", sellingPrice: 32, hsn: "3004", packUnit: "Strip", paymentMode: "Credit", amountPaid: 0, invoiceTotal: 1008 },
      { invoiceNo: "INV-1001", date: "20-11-2026", supplier: "Sri Balaji Pharma", product: "Azithral 500", qty: 10, rate: 95, gst: 12, batchNo: "AZ5521", expiry: "03/28", rack: "B-004", sellingPrice: 132, hsn: "3004", packUnit: "Strip", paymentMode: "Credit", amountPaid: 0, invoiceTotal: 1008 },
    ],
    instructions: [
      "Purchase Excel Upload - how to fill this sheet",
      "One row per product line. Rows with the same Supplier Name and Invoice No become one purchase invoice.",
      "Required: Invoice No, Product Name, Qty (Packs). Everything else is optional and gets the same defaults as the purchase form.",
      "Dates: DD-MM-YYYY (20-11-2026). Expiry can also be MM/YY (06/28 = 30 June 2028).",
      "Supplier: a registered supplier's name is matched automatically (Credit allowed). Any other name is saved as an unregistered supplier, which must be paid (Cash, UPI, Bank Transfer, Cheque or Other). Leave it blank for a purchase without supplier.",
      "Products: matched to the Product List ignoring case, spaces and punctuation (\"DOLO-650\" = \"Dolo 650\"). A new name is added to the Product List with the row's GST, HSN, pack unit and selling price.",
      "Invoice-level columns (date, payment mode, amount paid, invoice total) only need to be filled on one row of the invoice; if they are filled on several rows they must agree.",
      "Nothing is saved until you review the preview and click Save. Invoices already recorded are shown as duplicates and are not saved again, so a corrected file can simply be uploaded again.",
      "Supported files: .xlsx and .xls. Column names can differ slightly (e.g. 'Bill No', 'MRP', 'Batch') - they are matched automatically.",
    ],
  });
});

router.get("/sales/template", async (req, res) => {
  await streamTemplate(res, "GuganMedicals_Sales_Upload_Template.xlsx", {
    sheetName: "Sales",
    columns: [
      { header: "Invoice No", key: "invoiceNo", width: 16, required: true, note: "Required. Rows with the same Invoice No are one bill. Used to stop the same invoice being imported twice." },
      { header: "Invoice Date", key: "date", width: 14, date: true, note: "DD-MM-YYYY. Blank = today. Cannot be in the future." },
      { header: "Customer Name", key: "customer", width: 22, note: "Blank = Walk-in. Matched by phone first, then by name; a new customer is added." },
      { header: "Customer Phone", key: "phone", width: 14, note: "10 digits. Optional." },
      { header: "Product Name", key: "product", width: 26, required: true, note: "Required. Must already be in the Product List (with stock)." },
      { header: "Unit (Pack/Loose)", key: "unit", width: 14, options: ["Pack", "Loose"], note: "Blank = Pack. Loose only for products sold loose." },
      { header: "Qty", key: "qty", width: 8, required: true, note: "Required. Whole numbers." },
      { header: "Selling Rate", key: "rate", width: 12, note: "Per pack / loose unit, before GST. Blank = the product's current price." },
      { header: "GST %", key: "gst", width: 10, options: GST_VALUES.map(String), note: "Optional cross-check. The product's saved GST is used." },
      { header: "Discount", key: "discount", width: 10, note: "Bill discount in ₹ (once per invoice)." },
      { header: "Payment Mode", key: "paymentMode", width: 14, options: SALE_MODES, note: "Blank = Cash. Credit needs a customer." },
      { header: "Amount Received", key: "amountReceived", width: 14, note: "Credit bills only: amount received at billing (once per invoice)." },
      { header: "Invoice Total", key: "invoiceTotal", width: 14, note: "Optional. The bill's total, to cross-check the calculated total." },
    ],
    samples: [
      { invoiceNo: "S-5001", date: "21-11-2026", customer: "Ravi Kumar", phone: "9876543210", product: "Dolo 650", unit: "Pack", qty: 2, rate: 32, gst: 12, discount: 0, paymentMode: "Cash", invoiceTotal: 71.68 },
      { invoiceNo: "S-5002", date: "21-11-2026", customer: "", phone: "", product: "Azithral 500", unit: "Pack", qty: 1, rate: 132, gst: 12, discount: 5, paymentMode: "UPI", invoiceTotal: 142.84 },
    ],
    instructions: [
      "Sales Excel Upload - how to fill this sheet",
      "One row per product line. Rows with the same Invoice No become one bill in Bill History, with its own bill number. The Invoice No you give is kept, so the same invoice can't be imported twice.",
      "Required: Invoice No, Product Name, Qty. Products must already be in the Product List and have enough stock - stock is taken earliest expiry first, exactly as at the billing counter.",
      "Dates: DD-MM-YYYY (21-11-2026). The bill is dated on the Invoice Date, so Dashboard, Day Book and reports show it on that day.",
      "Customer: matched by phone, then by name. A new customer is added automatically. Blank = Walk-in. A Credit bill needs a customer.",
      "Selling Rate: per pack (or per loose unit for Loose lines), before GST. Blank = the product's current price. GST always comes from the product.",
      "Invoice-level columns (date, customer, discount, payment mode, amount received, invoice total) only need to be filled on one row of the invoice; if filled on several rows they must agree.",
      "Nothing is saved until you review the preview and click Save. Invoices already imported are shown as duplicates and are not saved again, so a corrected file can simply be uploaded again.",
      "Supported files: .xlsx and .xls. Column names can differ slightly (e.g. 'Bill No', 'Mobile', 'Price') - they are matched automatically.",
    ],
  });
});

// ---------- shared ----------

// Body: { rows: [{ row, cells: { header: value } }] } -> mapped rows.
function readRows(req, aliases) {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows) return { error: "Choose an Excel file to upload." };
  if (rows.length === 0) return { error: "The file has no rows to import. Fill the template below its header row." };
  if (rows.length > MAX_ROWS) return { error: `The file has ${rows.length} rows; upload at most ${MAX_ROWS} at a time.` };
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r.cells || {})))];
  const { fieldByHeader, mapped, unknown } = mapHeaders(headers, aliases);
  const out = rows
    .map((r) => ({ row: Number(r.row) || 0, f: rowFields(r.cells, fieldByHeader) }))
    .filter((r) => Object.keys(r.f).length > 0);
  return { rows: out, columns: { mapped, unknown } };
}

// The first non-blank value of `field` across an invoice's rows, and an
// error when the rows disagree.
function invoiceValue(rows, field, label, same = (a, b) => headerKey(a) === headerKey(b)) {
  const given = rows.filter((r) => r.f[field] !== undefined);
  if (!given.length) return { value: undefined };
  const value = given[0].f[field];
  const other = given.find((r) => !same(r.f[field], value));
  return other ? { value, error: `${label} differs between rows ${given[0].row} and ${other.row} of this invoice.` } : { value };
}

const missingColumns = (columns, required) => {
  const have = new Set(columns.mapped.map((m) => m.field));
  return required.filter(([field]) => !have.has(field)).map(([, label]) => label);
};

// ---------- purchases ----------

router.post("/purchases/check", async (req, res) => {
  const read = readRows(req, PURCHASE_ALIASES);
  if (read.error) return res.status(400).json({ message: read.error });
  const missing = missingColumns(read.columns, [["invoiceNo", "Invoice No"], ["product", "Product Name"], ["qty", "Qty"]]);
  if (missing.length) {
    return res.status(400).json({ message: `The file is missing the ${missing.join(", ")} column${missing.length > 1 ? "s" : ""}. Download the template to see the expected columns.` });
  }

  const today = todayIso();
  const [vendors, products] = await Promise.all([
    Vendor.find({}, "name isActive").lean(),
    Product.find({ isActive: true }, "name productCode gstPercent packUnit packRate rack").lean(),
  ]);
  const vendorByKey = new Map(vendors.map((v) => [normalizeName(v.name), v]));
  const productByKey = new Map();
  for (const p of products) {
    productByKey.set(normalizeName(p.name), p);
    if (p.productCode && !productByKey.has(normalizeName(p.productCode))) productByKey.set(normalizeName(p.productCode), p);
  }
  const rackChecks = new Map();
  const rackError = async (raw) => {
    if (!rackChecks.has(raw)) rackChecks.set(raw, await rackPositionError(raw, { required: false }));
    return rackChecks.get(raw);
  };

  // Group rows: same supplier + invoice no = one invoice (in file order).
  const groups = new Map();
  for (const r of read.rows) {
    const key = `${normalizeName(r.f.supplier)}|${text(r.f.invoiceNo).toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const invoiceNos = [...new Set(read.rows.map((r) => text(r.f.invoiceNo)).filter(Boolean))];
  const recorded = invoiceNos.length
    ? await Purchase.find({ invoiceNo: { $in: invoiceNos.map((n) => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")) } }, "vendor supplierName invoiceNo date total").lean()
    : [];

  const invoices = [];
  for (const [key, rows] of groups) {
    const errors = [];
    const warnings = [];
    const invoiceNo = text(rows[0].f.invoiceNo);
    const supplierName = text(rows[0].f.supplier);
    if (!invoiceNo) errors.push(`Invoice No is missing (row${rows.length > 1 ? "s" : ""} ${rows.map((r) => r.row).join(", ")}).`);

    // Supplier: registered (matched by name) / unregistered (typed) / none.
    const vendor = supplierName ? vendorByKey.get(normalizeName(supplierName)) : null;
    let kind = vendor ? "vendor" : supplierName ? "unregistered" : "none";
    if (vendor && vendor.isActive === false) {
      errors.push(`Supplier "${vendor.name}" is inactive. Activate it on Suppliers first.`);
    }

    const dateV = invoiceValue(rows, "date", "Invoice Date", (a, b) => parseDate(a) === parseDate(b));
    const modeV = invoiceValue(rows, "paymentMode", "Payment Mode");
    const paidV = invoiceValue(rows, "amountPaid", "Amount Paid", (a, b) => num(a) === num(b));
    const totalV = invoiceValue(rows, "invoiceTotal", "Invoice Total", (a, b) => num(a) === num(b));
    for (const v of [dateV, modeV, paidV, totalV]) if (v.error) errors.push(v.error);

    let date = today;
    if (dateV.value !== undefined) {
      const d = parseDate(dateV.value);
      if (!d) errors.push(`Invoice Date "${dateV.value}" isn't a date. Use DD-MM-YYYY.`);
      else if (d > today) errors.push(`Invoice Date ${d} is in the future.`);
      else date = d;
    }

    let paymentMode = kind === "vendor" ? "Credit" : "Cash";
    if (modeV.value !== undefined) {
      const m = pickOption(modeV.value, PURCHASE_MODES);
      if (!m) errors.push(`Payment Mode "${modeV.value}" isn't one of ${PURCHASE_MODES.join(", ")}.`);
      else paymentMode = m;
    }
    if (paymentMode === "Credit" && kind !== "vendor") {
      errors.push(
        supplierName
          ? `"${supplierName}" isn't a registered supplier, so this purchase can't be on Credit. Add the supplier on Suppliers first, or use a paid mode.`
          : "A purchase without a supplier can't be on Credit. Choose Cash, UPI, Bank Transfer, Cheque or Other."
      );
    }

    // Already recorded? (vendor + invoice no for registered suppliers; any
    // supplier-less purchase with that invoice no otherwise - the database
    // allows one per invoice no.)
    const dup = recorded.find(
      (p) => p.invoiceNo.toLowerCase() === invoiceNo.toLowerCase() && (kind === "vendor" ? String(p.vendor) === String(vendor._id) : !p.vendor)
    );
    const duplicate = Boolean(dup);
    if (dup) errors.push(`Already recorded: invoice ${dup.invoiceNo} dated ${new Date(dup.date).toLocaleDateString("en-IN")} (${fmt(dup.total)}).`);

    const lines = [];
    const seen = new Map();
    for (const r of rows) {
      const f = r.f;
      const lineErrors = [];
      const lineWarnings = [];
      const name = text(f.product);
      const product = name ? productByKey.get(normalizeName(name)) : null;
      if (!name) lineErrors.push("Product Name is missing.");

      const qty = num(f.qty);
      if (qty === undefined) lineErrors.push("Qty is missing.");
      else if (!(qty > 0) || !Number.isInteger(qty)) lineErrors.push(`Qty "${f.qty}" must be a whole number above 0.`);

      const rate = num(f.rate);
      if (rate !== undefined && !(rate >= 0)) lineErrors.push(`Purchase Rate "${f.rate}" isn't a valid amount.`);
      if (rate === undefined) lineWarnings.push("No purchase rate - saved at ₹0.");

      const gstIn = num(f.gst);
      if (gstIn !== undefined && !GST_VALUES.includes(gstIn)) lineErrors.push(`GST "${f.gst}" must be 0, 5, 12, 18 or 28.`);
      const gst = product ? product.gstPercent : GST_VALUES.includes(gstIn) ? gstIn : 0;
      if (product && gstIn !== undefined && GST_VALUES.includes(gstIn) && gstIn !== product.gstPercent) {
        lineWarnings.push(`File says GST ${gstIn}%, the product is saved with ${product.gstPercent}% - ${product.gstPercent}% is used.`);
      }

      let expiryDate = "";
      if (f.expiry !== undefined) {
        const e = parseDate(f.expiry, { monthOnly: true });
        if (!e) lineErrors.push(`Expiry "${f.expiry}" isn't a date. Use DD-MM-YYYY or MM/YY.`);
        else {
          expiryDate = e;
          if (e < today) lineWarnings.push(`Expired on ${e}.`);
        }
      }

      let rack = "";
      if (f.rack !== undefined) {
        const raw = /^no\s*rack$/i.test(text(f.rack)) ? NO_RACK : text(f.rack).toUpperCase();
        const problem = await rackError(raw);
        if (problem) lineErrors.push(problem);
        else rack = raw;
      } else if (product?.rack) rack = product.rack;

      const sellingPrice = num(f.sellingPrice);
      if (sellingPrice !== undefined && !(sellingPrice >= 0)) lineErrors.push(`Selling Price "${f.sellingPrice}" isn't a valid amount.`);

      if (!product && name) lineWarnings.push("New product - it will be added to the Product List.");
      if (product && sellingPrice >= 0 && round2(sellingPrice) !== round2(product.packRate)) {
        lineWarnings.push(
          kind === "vendor"
            ? `Selling price ${fmt(sellingPrice)} is not applied - the product keeps ${fmt(product.packRate)}. Change it on Products if needed.`
            : `The product's selling price changes from ${fmt(product.packRate)} to ${fmt(sellingPrice)}.`
        );
      }

      const batchNo = text(f.batchNo).slice(0, 30);
      const dupKey = `${product ? product._id : normalizeName(name)}|${batchNo.toLowerCase()}`;
      if (name && seen.has(dupKey)) lineWarnings.push(`Same product${batchNo ? " and batch" : ""} as row ${seen.get(dupKey)} - both lines will be added.`);
      else seen.set(dupKey, r.row);

      const amount = round2((qty > 0 ? qty : 0) * (rate >= 0 ? rate : 0));
      lines.push({
        row: r.row,
        product: name,
        productId: product?._id || null,
        matchedName: product?.name || null,
        isNew: !product && Boolean(name),
        qty: qty ?? null,
        rate: rate ?? 0,
        gst,
        amount,
        gstAmount: round2((amount * gst) / 100),
        batchNo,
        expiryDate,
        rack,
        errors: lineErrors,
        warnings: lineWarnings,
        item:
          kind === "vendor"
            ? {
                product: product?._id,
                newProduct: product ? undefined : { name, gstPercent: gst, hsnCode: text(f.hsn), unit: toPackUnit(f.packUnit), sellingPrice },
                qtyPacks: qty,
                costPrice: rate ?? 0,
                batchNo,
                expiryDate: expiryDate || undefined,
                rack,
              }
            : {
                product: product?._id,
                newProduct: product ? undefined : { name, gstPercent: gst, packUnit: toPackUnit(f.packUnit) },
                qtyPacks: qty,
                costPrice: rate ?? 0,
                sellingPrice,
                batchNo,
                expiryDate: expiryDate || undefined,
                rack,
              },
      });
    }

    const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
    const gstAmount = round2(lines.reduce((s, l) => s + l.gstAmount, 0));
    const total = round2(subtotal + gstAmount);
    const excelTotal = num(totalV.value);
    if (totalV.value !== undefined && !(excelTotal >= 0)) errors.push(`Invoice Total "${totalV.value}" isn't a valid amount.`);
    else if (excelTotal !== undefined && Math.abs(excelTotal - total) > 1) {
      warnings.push(`Invoice Total in the file is ${fmt(excelTotal)}; calculated from the lines it is ${fmt(total)}.`);
    }

    let amountPaid = paymentMode === "Credit" ? 0 : total;
    if (paidV.value !== undefined) {
      const paid = num(paidV.value);
      if (!(paid >= 0)) errors.push(`Amount Paid "${paidV.value}" isn't a valid amount.`);
      else if (paymentMode === "Credit") {
        if (paid > total + 0.005) errors.push(`Amount Paid ${fmt(paid)} is more than the invoice total ${fmt(total)}.`);
        else amountPaid = round2(paid);
      } else if (Math.abs(paid - total) > 1) warnings.push(`A ${paymentMode} purchase is paid in full (${fmt(total)}); Amount Paid ${fmt(paid)} is ignored.`);
    }

    const ok = errors.length === 0 && lines.every((l) => l.errors.length === 0);
    const items = lines.map((l) => l.item);
    invoices.push({
      key,
      invoiceNo,
      supplier: vendor?.name || supplierName,
      supplierKind: kind,
      date,
      paymentMode,
      amountPaid,
      subtotal,
      gstAmount,
      total,
      excelTotal: excelTotal ?? null,
      rows: rows.map((r) => r.row),
      lines: lines.map(({ item, ...l }) => l),
      errors,
      warnings,
      duplicate,
      ok,
      save: ok
        ? kind === "vendor"
          ? { endpoint: "/purchases", body: { vendor: vendor._id, invoiceNo, date, paymentMode, amountPaid, tdsAmount: 0, items } }
          : { endpoint: "/purchases/direct", body: { supplierName, invoiceNo, date, paymentMode, items } }
        : null,
    });
  }

  res.json({ columns: read.columns, rowsRead: read.rows.length, invoices });
});

// ---------- sales ----------

router.post("/sales/check", async (req, res) => {
  const read = readRows(req, SALE_ALIASES);
  if (read.error) return res.status(400).json({ message: read.error });
  const missing = missingColumns(read.columns, [["invoiceNo", "Invoice No"], ["product", "Product Name"], ["qty", "Qty"]]);
  if (missing.length) {
    return res.status(400).json({ message: `The file is missing the ${missing.join(", ")} column${missing.length > 1 ? "s" : ""}. Download the template to see the expected columns.` });
  }

  const today = todayIso();
  const products = await Product.find({ isActive: true }, "name productCode gstPercent packRate looseRate soldAs unitsPerPack packUnit looseUnitName qty").lean();
  const productByKey = new Map();
  for (const p of products) {
    productByKey.set(normalizeName(p.name), p);
    if (p.productCode && !productByKey.has(normalizeName(p.productCode))) productByKey.set(normalizeName(p.productCode), p);
  }

  // Group rows by invoice no (in file order).
  const groups = new Map();
  for (const r of read.rows) {
    const key = text(r.f.invoiceNo).toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const refs = [...groups.values()].map((rows) => text(rows[0].f.invoiceNo)).filter(Boolean);
  const imported = refs.length
    ? await Sale.find({ importRef: { $in: refs.map((n) => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")) } }, "importRef billNo createdAt total").lean()
    : [];

  const phones = [];
  const names = [];
  for (const r of read.rows) {
    const ph = cleanPhone(r.f.phone);
    if (ph) phones.push(ph);
    if (text(r.f.customer)) names.push(text(r.f.customer));
  }
  const customers = phones.length || names.length
    ? await Customer.find({ isActive: true, $or: [{ phone: { $in: phones } }, { name: { $in: names.map((n) => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")) } }] }, "name phone").lean()
    : [];

  // Earliest-expiry batch with stock, per product (what a sale draws first).
  const firstBatch = new Map();
  const usedIds = [...new Set(read.rows.map((r) => productByKey.get(normalizeName(r.f.product))?._id).filter(Boolean).map(String))];
  if (usedIds.length) {
    const batches = await Batch.find({ product: { $in: usedIds }, qtyRemaining: { $gt: 0 }, isDeleted: { $ne: true } }, "product batchNo expiryDate").sort({ expiryDate: 1 }).lean();
    for (const b of batches) if (!firstBatch.has(String(b.product))) firstBatch.set(String(b.product), b);
  }

  const invoices = [];
  for (const [key, rows] of groups) {
    const errors = [];
    const warnings = [];
    const invoiceNo = text(rows[0].f.invoiceNo);
    if (!invoiceNo) errors.push(`Invoice No is missing (row${rows.length > 1 ? "s" : ""} ${rows.map((r) => r.row).join(", ")}).`);

    const dateV = invoiceValue(rows, "date", "Invoice Date", (a, b) => parseDate(a) === parseDate(b));
    const custV = invoiceValue(rows, "customer", "Customer Name", (a, b) => normalizeName(a) === normalizeName(b));
    const phoneV = invoiceValue(rows, "phone", "Customer Phone", (a, b) => cleanPhone(a) === cleanPhone(b));
    const modeV = invoiceValue(rows, "paymentMode", "Payment Mode");
    const discV = invoiceValue(rows, "discount", "Discount", (a, b) => num(a) === num(b));
    const recvV = invoiceValue(rows, "amountReceived", "Amount Received", (a, b) => num(a) === num(b));
    const totalV = invoiceValue(rows, "invoiceTotal", "Invoice Total", (a, b) => num(a) === num(b));
    for (const v of [dateV, custV, phoneV, modeV, discV, recvV, totalV]) if (v.error) errors.push(v.error);

    let date = today;
    if (dateV.value !== undefined) {
      const d = parseDate(dateV.value);
      if (!d) errors.push(`Invoice Date "${dateV.value}" isn't a date. Use DD-MM-YYYY.`);
      else if (d > today) errors.push(`Invoice Date ${d} is in the future.`);
      else date = d;
    }

    let paymentMode = "Cash";
    if (modeV.value !== undefined) {
      const m = pickOption(modeV.value, SALE_MODES);
      if (!m) errors.push(`Payment Mode "${modeV.value}" isn't one of ${SALE_MODES.join(", ")}.`);
      else paymentMode = m;
    }

    // Customer: by phone, then by exact name; otherwise a new one.
    const customerName = text(custV.value);
    let phone = "";
    if (phoneV.value !== undefined) {
      phone = cleanPhone(phoneV.value);
      if (!phone) errors.push(`Customer Phone "${phoneV.value}" must be a 10-digit number.`);
    }
    let customer = null;
    let newCustomer = null;
    if (phone) customer = customers.find((c) => c.phone === phone) || null;
    if (!customer && customerName && !phone) {
      const byName = customers.filter((c) => normalizeName(c.name) === normalizeName(customerName));
      if (byName.length === 1) customer = byName[0];
      else if (byName.length > 1) warnings.push(`${byName.length} customers are named "${customerName}" - add the phone number to pick the right one. A new customer will be added otherwise.`);
    }
    if (customer && customerName && normalizeName(customer.name) !== normalizeName(customerName)) {
      warnings.push(`Phone ${phone} belongs to "${customer.name}" - the bill goes to that customer.`);
    }
    if (!customer && (customerName || phone)) {
      newCustomer = { name: customerName, phone };
      warnings.push(`New customer "${customerName || phone}" will be added.`);
    }
    if (paymentMode === "Credit" && !customer && !newCustomer) errors.push("A Credit bill needs a customer name or phone.");

    const dup = imported.find((s) => s.importRef.toLowerCase() === invoiceNo.toLowerCase());
    const duplicate = Boolean(dup);
    if (dup) errors.push(`Already imported as bill ${dup.billNo} on ${new Date(dup.createdAt).toLocaleDateString("en-IN")} (${fmt(dup.total)}).`);

    let overrideExpired = false;
    const lines = [];
    for (const r of rows) {
      const f = r.f;
      const lineErrors = [];
      const lineWarnings = [];
      const name = text(f.product);
      const product = name ? productByKey.get(normalizeName(name)) : null;
      if (!name) lineErrors.push("Product Name is missing.");
      else if (!product) lineErrors.push(`"${name}" isn't in the Product List. Add it on Products (or through a purchase) first.`);

      let unitType = "pack";
      if (f.unit !== undefined) {
        const u = headerKey(f.unit);
        if (["loose", "l", "tablet", "tab", "capsule", "cap", "unit", "units", "piece", "pcs", "ml"].includes(u)) unitType = "loose";
        else if (!["pack", "p", "strip", "bottle", "box", "packs", "tube", "vial", "jar"].includes(u)) lineErrors.push(`Unit "${f.unit}" must be Pack or Loose.`);
      }
      if (product && unitType === "loose" && product.soldAs !== "pack-and-loose") lineErrors.push(`${product.name} isn't sold loose - use Pack.`);

      const qty = num(f.qty);
      if (qty === undefined) lineErrors.push("Qty is missing.");
      else if (!(qty > 0) || !Number.isInteger(qty)) lineErrors.push(`Qty "${f.qty}" must be a whole number above 0.`);

      const currentRate = product ? (unitType === "pack" ? product.packRate : product.looseRate) : 0;
      let rate = currentRate;
      if (f.rate !== undefined) {
        const r2 = num(f.rate);
        if (!(r2 >= 0)) lineErrors.push(`Selling Rate "${f.rate}" isn't a valid amount.`);
        else rate = round2(r2);
      } else if (product) lineWarnings.push(`No rate - the current price ${fmt(currentRate)} is used.`);

      const gstIn = num(f.gst);
      if (gstIn !== undefined && !GST_VALUES.includes(gstIn)) lineErrors.push(`GST "${f.gst}" must be 0, 5, 12, 18 or 28.`);
      const gst = product?.gstPercent ?? 0;
      if (product && GST_VALUES.includes(gstIn) && gstIn !== gst) lineWarnings.push(`File says GST ${gstIn}%, the product is saved with ${gst}% - ${gst}% is used.`);

      if (product) {
        const b = firstBatch.get(String(product._id));
        const exp = b?.expiryDate ? new Date(b.expiryDate).toISOString().slice(0, 10) : null;
        if (exp && exp < date) lineErrors.push(`The next batch to sell (${b.batchNo}) expired on ${exp}, before this bill's date.`);
        else if (exp && exp < today) {
          overrideExpired = true;
          lineWarnings.push(`Batch ${b.batchNo} has expired since (${exp}); it was valid on the bill date.`);
        }
      }

      const amount = round2((qty > 0 ? qty : 0) * rate);
      lines.push({
        row: r.row,
        product: name,
        productId: product?._id || null,
        matchedName: product?.name || null,
        unitType,
        unitLabel: product ? (unitType === "pack" ? product.packUnit : product.looseUnitName) : "",
        qty: qty ?? null,
        rate,
        gst,
        amount,
        gstAmount: round2((amount * gst) / 100),
        internalQty: product && qty > 0 ? saleLineInternalQty(product, unitType, qty) : 0,
        errors: lineErrors,
        warnings: lineWarnings,
      });
    }

    const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
    const gstAmount = round2(lines.reduce((s, l) => s + l.gstAmount, 0));
    let discount = 0;
    if (discV.value !== undefined) {
      const d = num(discV.value);
      if (!(d >= 0)) errors.push(`Discount "${discV.value}" isn't a valid amount.`);
      else if (d > subtotal + gstAmount) errors.push(`Discount ${fmt(d)} is more than the bill amount ${fmt(subtotal + gstAmount)}.`);
      else discount = round2(d);
    }
    const total = round2(subtotal + gstAmount - discount);
    const excelTotal = num(totalV.value);
    if (totalV.value !== undefined && !(excelTotal >= 0)) errors.push(`Invoice Total "${totalV.value}" isn't a valid amount.`);
    else if (excelTotal !== undefined && Math.abs(excelTotal - total) > 1) {
      warnings.push(`Invoice Total in the file is ${fmt(excelTotal)}; calculated from the lines it is ${fmt(total)}.`);
    }

    let amountReceived = paymentMode === "Credit" ? 0 : total;
    if (recvV.value !== undefined) {
      const rcv = num(recvV.value);
      if (!(rcv >= 0)) errors.push(`Amount Received "${recvV.value}" isn't a valid amount.`);
      else if (paymentMode === "Credit") {
        if (rcv > total + 0.005) errors.push(`Amount Received ${fmt(rcv)} is more than the bill total ${fmt(total)}.`);
        else amountReceived = round2(rcv);
      } else if (Math.abs(rcv - total) > 1) warnings.push(`A ${paymentMode} bill is paid in full (${fmt(total)}); Amount Received ${fmt(rcv)} is ignored.`);
    }

    invoices.push({
      key,
      invoiceNo,
      date,
      customer: customer ? { _id: customer._id, name: customer.name, phone: customer.phone || "" } : null,
      newCustomer,
      paymentMode,
      discount,
      amountReceived,
      subtotal,
      gstAmount,
      total,
      excelTotal: excelTotal ?? null,
      rows: rows.map((r) => r.row),
      lines,
      errors,
      warnings,
      duplicate,
      overrideExpired,
    });
  }

  // Stock: bills are saved oldest first, each taking from what's left.
  // A bill that can't be filled is marked; it doesn't use up stock.
  const left = new Map(products.map((p) => [String(p._id), p.qty]));
  const order = [...invoices].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const inv of order) {
    const ready = inv.errors.length === 0 && inv.lines.every((l) => l.errors.length === 0);
    if (!ready) continue;
    const need = new Map();
    for (const l of inv.lines) need.set(String(l.productId), (need.get(String(l.productId)) || 0) + l.internalQty);
    let short = false;
    for (const l of inv.lines) {
      const id = String(l.productId);
      const have = left.get(id) || 0;
      if (need.get(id) > have) {
        const p = products.find((x) => String(x._id) === id);
        const unit = p.soldAs === "pack-and-loose" ? p.looseUnitName : p.packUnit;
        l.errors.push(`Not enough stock: needs ${need.get(id)} ${unit}, ${have} left${have !== p.qty ? " after earlier bills in this file" : ""}.`);
        short = true;
      }
    }
    if (!short) for (const [id, n] of need) left.set(id, left.get(id) - n);
  }

  for (const inv of invoices) {
    inv.ok = inv.errors.length === 0 && inv.lines.every((l) => l.errors.length === 0);
    inv.save = inv.ok
      ? {
          endpoint: "/sales",
          newCustomer: inv.newCustomer,
          body: {
            customer: inv.customer?._id || null,
            paymentMode: inv.paymentMode,
            discount: inv.discount,
            ...(inv.paymentMode === "Credit" ? { amountReceived: inv.amountReceived } : {}),
            date: inv.date,
            importRef: inv.invoiceNo,
            ...(inv.overrideExpired ? { overrideExpired: true, overrideExpiredReason: "Imported sale dated before the batch expired" } : {}),
            items: inv.lines.map((l) => ({ product: l.productId, unitType: l.unitType, qty: l.qty, rate: l.rate })),
          },
        }
      : null;
    for (const l of inv.lines) delete l.internalQty;
  }
  // Saved in date order, so stock is used the way the check assumed.
  invoices.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  res.json({ columns: read.columns, rowsRead: read.rows.length, invoices });
});

// "98765 43210", "+91-9876543210", 9876543210 -> "9876543210"; junk -> "".
function cleanPhone(v) {
  if (v === undefined || v === null || v === "") return "";
  let d = String(typeof v === "number" ? Math.round(v) : v).replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^\d{10}$/.test(d) ? d : "";
}

export default router;
