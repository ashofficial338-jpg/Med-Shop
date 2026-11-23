import ExcelJS from "exceljs";

// Shared pieces of the Purchase and Sales Excel uploads (routes/imports.js).
// The browser reads the file (.xlsx or .xls) and sends its rows as
// { row, cells: { "<header text>": value } }; this file maps those headers
// to fields and turns cell text into clean numbers and dates.

// "GST % (0/5/12/18/28)" -> "gst", "Qty (Packs)" -> "qtypacks".
export const headerKey = (h) =>
  String(h ?? "")
    .replace(/\([^)]*\)/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

// Maps the file's own headers to fields using `aliases` ({ field: [keys] }).
// Returns { fieldByHeader, mapped: [{ header, field }], unknown: [header] }.
export function mapHeaders(headers, aliases) {
  const lookup = new Map();
  for (const [field, keys] of Object.entries(aliases)) for (const k of keys) lookup.set(k, field);
  const fieldByHeader = new Map();
  const used = new Set();
  const mapped = [];
  const unknown = [];
  for (const h of headers) {
    const field = lookup.get(headerKey(h));
    // The first column for a field wins; a second one is reported as unused.
    if (field && !used.has(field)) {
      used.add(field);
      fieldByHeader.set(h, field);
      mapped.push({ header: h, field });
    } else if (String(h ?? "").trim()) unknown.push(h);
  }
  return { fieldByHeader, mapped, unknown };
}

// One row's cells as { field: value }, dropping blank cells.
export function rowFields(cells, fieldByHeader) {
  const out = {};
  for (const [header, value] of Object.entries(cells || {})) {
    const field = fieldByHeader.get(header);
    if (!field) continue;
    const v = typeof value === "string" ? value.trim() : value;
    if (v !== "" && v !== null && v !== undefined) out[field] = v;
  }
  return out;
}

export const text = (v) => (v === undefined || v === null ? "" : String(v).trim().replace(/\s+/g, " "));

// "1,250.50", "₹ 40", 40 -> number; blank -> undefined; junk -> NaN.
export function num(v) {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "number") return v;
  const cleaned = String(v).replace(/[₹,\s]|rs\.?|inr/gi, "").replace(/%$/, "");
  if (cleaned === "") return undefined;
  return Number(cleaned);
}

const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const lastDay = (y, m) => new Date(y, m, 0).getDate();
const fullYear = (y) => (y < 100 ? 2000 + y : y);

function validYmd(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= lastDay(y, m) && y >= 1990 && y <= 2100)) return null;
  return iso(y, m, d);
}

// Excel day number (days since 1899-12-30) -> "YYYY-MM-DD".
function fromSerial(n) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

// A date cell -> "YYYY-MM-DD", "" when blank, null when it can't be read.
// Accepts YYYY-MM-DD, DD-MM-YYYY / DD/MM/YY / DD.MM.YYYY (Indian day-first),
// "20 Nov 2026", and Excel day numbers. With `monthOnly` (expiry dates)
// "06/27", "06/2027", "Jun-27", "JUN 2027" mean the last day of that month.
export function parseDate(v, { monthOnly = false } = {}) {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v === "number") return v > 20000 && v < 80000 ? fromSerial(v) : null;
  const s = String(v).trim().toLowerCase();
  let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return validYmd(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) return validYmd(fullYear(+m[3]), +m[2], +m[1]);
  if ((m = s.match(/^(\d{1,2})[\s-]+([a-z]{3})[a-z]*[\s-,]+(\d{2}|\d{4})$/))) {
    const mon = MONTHS.indexOf(m[2]) + 1;
    return mon ? validYmd(fullYear(+m[3]), mon, +m[1]) : null;
  }
  if (monthOnly) {
    if ((m = s.match(/^(\d{1,2})[-/.](\d{2}|\d{4})$/))) {
      const y = fullYear(+m[2]);
      return +m[1] >= 1 && +m[1] <= 12 ? validYmd(y, +m[1], lastDay(y, +m[1])) : null;
    }
    if ((m = s.match(/^([a-z]{3})[a-z]*[\s\-/,']+(\d{2}|\d{4})$/))) {
      const mon = MONTHS.indexOf(m[1]) + 1;
      const y = fullYear(+m[2]);
      return mon ? validYmd(y, mon, lastDay(y, mon)) : null;
    }
  }
  if (/^\d+(\.\d+)?$/.test(s)) return parseDate(Number(s), { monthOnly });
  return null;
}

// Today in the shop's time zone (the server runs in it - see tz.js).
export function todayIso() {
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

// Picks one of `allowed` ignoring case/spaces ("bank transfer", "UPI").
export function pickOption(v, allowed) {
  const k = headerKey(v);
  return allowed.find((a) => headerKey(a) === k) || null;
}

// Streams an .xlsx template: a data sheet (bold headers, notes, dropdowns,
// sample rows) and an Instructions sheet.
export async function streamTemplate(res, filename, { sheetName, columns, samples, instructions }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 16 }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E7490" } };
  head.height = 20;
  columns.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    if (c.note) cell.note = c.note;
    if (c.required) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B4F63" } };
  });
  for (const s of samples) ws.addRow(s);
  // Dropdowns and formats down to row 2000.
  columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.date) col.numFmt = "dd-mm-yyyy";
    if (!c.options) return;
    for (let r = 2; r <= 2000; r++) {
      ws.getCell(r, i + 1).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`"${c.options.join(",")}"`],
        showErrorMessage: true,
        errorTitle: "Choose from the list",
        error: `Allowed: ${c.options.join(", ")}`,
      };
    }
  });

  const help = wb.addWorksheet("Instructions");
  help.getColumn(1).width = 110;
  instructions.forEach((line, i) => {
    const row = help.addRow([line]);
    if (i === 0) row.font = { bold: true, size: 13 };
    row.alignment = { wrapText: true };
  });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
  await wb.xlsx.write(res);
  res.end();
}
