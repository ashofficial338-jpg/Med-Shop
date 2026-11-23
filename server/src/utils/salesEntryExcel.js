import ExcelJS from "exceljs";
import { GST_RATES, PAYMENT_MODES } from "./salesEntryCalc.js";

// Sales Entry Excel template (download) and reader (upload).
//
// One row per product. Rows with the same Invoice Ref are one invoice: its
// date, customer and payment details are taken from its first row (later
// rows may leave them blank). The Invoice Ref is also what stops the same
// invoice being imported twice (see routes/salesEntries.js).

export const COLUMNS = [
  { key: "ref", header: "Invoice Ref", width: 14, required: true, note: "Your own number for the invoice, e.g. INV-1. Rows with the same ref are one invoice." },
  { key: "date", header: "Invoice Date", width: 14, required: true, note: "DD-MM-YYYY" },
  { key: "customerName", header: "Customer Name", width: 22, note: "Needed for Credit. Leave blank for a walk-in." },
  { key: "mobile", header: "Mobile", width: 13, note: "10 digits (optional)" },
  { key: "address", header: "Address", width: 28, note: "Optional" },
  { key: "paymentMode", header: "Payment Mode", width: 15, required: true, note: PAYMENT_MODES.join(" / ") },
  { key: "amountReceived", header: "Amount Received (Credit)", width: 14, note: "Credit only: paid now. Blank = 0." },
  { key: "product", header: "Product Name", width: 26, required: true, note: "A new name is added to the Product List." },
  { key: "hsn", header: "HSN Code", width: 11, note: "Optional" },
  { key: "unit", header: "Unit", width: 10, note: "Strip, Bottle, Box, Tube, Vial, Jar or Piece (optional)" },
  { key: "qty", header: "Quantity", width: 10, required: true, note: "Above 0" },
  { key: "rate", header: "Rate", width: 10, required: true, note: "Price per unit before GST" },
  { key: "discount", header: "Discount %", width: 11, note: "0-100 (optional; Admin only)" },
  { key: "gst", header: "GST %", width: 8, required: true, note: GST_RATES.join(" / ") },
  { key: "lineTotal", header: "Line Total (auto)", width: 14, note: "Worked out for you - not read on upload" },
];

const SAMPLE = [
  ["INV-1", "23-11-2026", "Ravi Kumar", "9840123456", "12 Gandhi St, Chennai", "Cash", "", "Dolo 650", "3004", "Strip", 2, 30, 0, 12],
  ["INV-1", "", "", "", "", "", "", "Cetirizine 10mg", "3004", "Strip", 1, 18, 5, 12],
  ["INV-2", "23-11-2026", "Priya S", "", "", "Credit", 100, "Vitamin C Syrup", "2106", "Bottle", 1, 120, 0, 18],
];

export async function buildTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sales Entries", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = COLUMNS.map((c) => ({ header: c.required ? `${c.header} *` : c.header, key: c.key, width: c.width }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.alignment = { vertical: "middle", wrapText: true };
  head.height = 32;
  head.eachCell((cell, i) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLUMNS[i - 1].required ? "FF0B4A8F" : "FF5E6B7F" } };
    cell.note = COLUMNS[i - 1].note;
  });
  SAMPLE.forEach((row) => ws.addRow(row));
  const col = (key) => String.fromCharCode(65 + COLUMNS.findIndex((c) => c.key === key));
  const [q, r, d, g] = ["qty", "rate", "discount", "gst"].map(col);
  const total = col("lineTotal");
  for (let n = 2; n <= 500; n++) {
    ws.getCell(`${total}${n}`).value = { formula: `IF(${q}${n}="","",ROUND(${q}${n}*${r}${n}*(1-N(${d}${n})/100)*(1+N(${g}${n})/100),2))` };
    ws.getCell(`${total}${n}`).numFmt = "#,##0.00";
    ws.getCell(`${col("paymentMode")}${n}`).dataValidation = { type: "list", allowBlank: true, formulae: [`"${PAYMENT_MODES.join(",")}"`] };
    ws.getCell(`${g}${n}`).dataValidation = { type: "list", allowBlank: true, formulae: [`"${GST_RATES.join(",")}"`] };
    ws.getCell(`${col("date")}${n}`).numFmt = "dd-mm-yyyy";
  }

  const help = wb.addWorksheet("Instructions");
  help.columns = [{ width: 26 }, { width: 90 }];
  help.addRow(["Sales Entry upload - how to fill this file"]).font = { bold: true, size: 14 };
  help.addRow([]);
  [
    ["One row per product", "Put each product on its own row. Rows with the same Invoice Ref are one invoice (see INV-1 in the sample)."],
    ["Invoice details", "Date, customer, payment mode and amount received are read from the first row of each invoice."],
    ["Required (*)", "Invoice Ref, Invoice Date, Payment Mode, Product Name, Quantity, Rate and GST %."],
    ["Invoice numbers", "SALES-001, SALES-002, ... are given automatically when saved. Invoice Ref is only your own reference."],
    ["Duplicates", "An Invoice Ref that was already imported is skipped, so the same file can't be saved twice."],
    ["Before saving", "After upload you'll see a preview with any errors. Nothing is saved until you confirm."],
    ["Sample rows", "Delete the three sample rows (INV-1, INV-2) before adding your own."],
  ].forEach(([k, v]) => {
    const row = help.addRow([k, v]);
    row.getCell(1).font = { bold: true };
    row.getCell(2).alignment = { wrapText: true };
  });
  help.addRow([]);
  help.addRow(["Column", "What to enter"]).font = { bold: true };
  COLUMNS.forEach((c) => help.addRow([`${c.header}${c.required ? " *" : ""}`, c.note]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---- Reading an uploaded file ----

function cellValue(cell) {
  let v = cell?.value;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    if ("result" in v) v = v.result; // formula
    else if ("richText" in v) v = v.richText.map((t) => t.text).join("");
    else if ("text" in v) v = v.text; // hyperlink
  }
  return v ?? "";
}
const text = (v) => (v instanceof Date ? v : String(v ?? "").trim());
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9%]/g, "");

// "23-11-2026", "23/11/2026", "2026-11-23" or a real Excel date -> "2026-11-23".
export function toIsoDate(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // Excel dates arrive as UTC midnight of that calendar day.
    return v.toISOString().slice(0, 10);
  }
  const s = String(v || "").trim();
  let m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return valid(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`);
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return valid(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`);
  return null;
}
function valid(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

export function toPaymentMode(v) {
  const s = norm(v);
  if (!s) return null;
  const alias = { bank: "Bank Transfer", banktransfer: "Bank Transfer", neft: "Bank Transfer", rtgs: "Bank Transfer", imps: "Bank Transfer", gpay: "UPI", phonepe: "UPI", paytm: "UPI", debitcard: "Card", creditcard: "Card" };
  return PAYMENT_MODES.find((m) => norm(m) === s) || alias[s] || null;
}

const num = (v) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[,₹\s%]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

// Reads the upload into invoices: [{ ref, rows: [excel row numbers], body, errors }].
// `body` is shaped like the Sales Entry form's save request.
export async function readUpload(buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    return { error: "This file couldn't be read. Upload the .xlsx Sales Entry template (File > Save As > Excel Workbook)." };
  }
  const ws = wb.getWorksheet("Sales Entries") || wb.worksheets[0];
  if (!ws) return { error: "The file has no sheets." };

  // Columns are found by their headings, so moved columns still work.
  const where = {};
  ws.getRow(1).eachCell((cell, i) => {
    const h = norm(String(cellValue(cell)).replace(/\*/g, ""));
    const c = COLUMNS.find((col) => norm(col.header) === h);
    if (c) where[c.key] = i;
  });
  const missing = COLUMNS.filter((c) => c.required && !where[c.key]).map((c) => c.header);
  if (missing.length) return { error: `Columns not found: ${missing.join(", ")}. Use the Sales Entry template.` };

  const byRef = new Map();
  const order = [];
  let rowCount = 0;
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const get = (key) => (where[key] ? text(cellValue(row.getCell(where[key]))) : "");
    const cells = Object.fromEntries(COLUMNS.filter((c) => c.key !== "lineTotal").map((c) => [c.key, get(c.key)]));
    if (Object.values(cells).every((v) => v === "")) return; // blank row
    rowCount++;
    const ref = String(cells.ref || "").trim();
    const key = ref ? ref.toLowerCase() : `__row${n}`;
    if (!byRef.has(key)) {
      byRef.set(key, { ref, rows: [], first: cells, lines: [], errors: [] });
      order.push(key);
    }
    const inv = byRef.get(key);
    inv.rows.push(n);
    // A later row that repeats invoice details must agree with the first row.
    for (const k of ["date", "customerName", "paymentMode"]) {
      const a = String(inv.first[k] instanceof Date ? toIsoDate(inv.first[k]) : inv.first[k] || "");
      const b = String(cells[k] instanceof Date ? toIsoDate(cells[k]) : cells[k] || "");
      if (b && a && a.toLowerCase() !== b.toLowerCase()) inv.errors.push(`Row ${n}: ${COLUMNS.find((c) => c.key === k).header} differs from row ${inv.rows[0]} of the same invoice.`);
    }
    inv.lines.push({ n, ...cells });
  });
  if (!rowCount) return { error: "No sales rows found. Fill in the Sales Entries sheet (below the heading row) and upload again." };
  if (byRef.size > 500) return { error: "Upload at most 500 invoices at a time." };

  const invoices = order.map((key) => {
    const inv = byRef.get(key);
    const f = inv.first;
    const errors = [...inv.errors];
    if (!inv.ref) errors.push(`Row ${inv.rows[0]}: Invoice Ref is required.`);
    const date = toIsoDate(f.date);
    if (!date) errors.push(`Row ${inv.rows[0]}: enter a valid Invoice Date (DD-MM-YYYY).`);
    else if (date > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) errors.push(`Row ${inv.rows[0]}: Invoice Date is in the future.`);
    const paymentMode = toPaymentMode(f.paymentMode);
    if (!paymentMode) errors.push(`Row ${inv.rows[0]}: Payment Mode must be ${PAYMENT_MODES.join(", ")}.`);
    const mobile = String(f.mobile || "").replace(/\D/g, "");
    if (mobile && mobile.length !== 10) errors.push(`Row ${inv.rows[0]}: Mobile must be 10 digits.`);
    if (paymentMode === "Credit" && !f.customerName) errors.push(`Row ${inv.rows[0]}: Customer Name is required for Credit.`);
    const received = num(f.amountReceived);
    if (Number.isNaN(received) || received < 0) errors.push(`Row ${inv.rows[0]}: Amount Received must be a number.`);

    const items = inv.lines.map((l) => {
      const qty = num(l.qty);
      const rate = num(l.rate);
      const discount = num(l.discount);
      const gst = num(l.gst);
      if (!l.product) errors.push(`Row ${l.n}: Product Name is required.`);
      if (qty === null || Number.isNaN(qty) || !(qty > 0)) errors.push(`Row ${l.n}: Quantity must be above 0.`);
      if (rate === null || Number.isNaN(rate) || rate < 0) errors.push(`Row ${l.n}: enter a valid Rate.`);
      if (Number.isNaN(discount) || (discount !== null && (discount < 0 || discount > 100))) errors.push(`Row ${l.n}: Discount % must be 0-100.`);
      if (gst === null || !GST_RATES.includes(gst)) errors.push(`Row ${l.n}: GST % must be ${GST_RATES.join(", ")}.`);
      return { name: String(l.product || "").slice(0, 200), hsnCode: String(l.hsn || ""), unit: String(l.unit || ""), qty, rate, discountPercent: discount || 0, gstPercent: gst };
    });

    return {
      ref: inv.ref,
      rows: inv.rows,
      errors,
      body: {
        invoiceDate: date,
        customer: { name: String(f.customerName || ""), mobile, address: String(f.address || "") },
        paymentMode,
        amountReceived: paymentMode === "Credit" ? received || 0 : undefined,
        items,
      },
    };
  });
  return { invoices };
}
