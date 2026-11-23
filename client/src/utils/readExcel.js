// Reads the first sheet of an .xlsx / .xls file in the browser into
// [{ row, cells: { "<header>": value } }] for the Excel upload check.
// The header row is the first row with at least two filled cells (a title
// row above the table is skipped). Date cells become "YYYY-MM-DD" (read from
// the cell's own day number, so the computer's time zone can't shift them).
// The reader library is loaded only when a file is actually read.

const MAX_BYTES = 10 * 1024 * 1024;
const pad = (n) => String(n).padStart(2, "0");

export async function readExcelRows(file) {
  if (!file) throw new Error("Choose an Excel file first.");
  if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error("Choose an Excel file (.xlsx or .xls).");
  if (file.size > MAX_BYTES) throw new Error("The file is larger than 10 MB. Split it into smaller files.");

  const XLSX = await import("xlsx");
  let wb;
  try {
    wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false, cellNF: true, cellText: false });
  } catch {
    throw new Error("This file couldn't be read as an Excel workbook. Save it again as .xlsx and retry.");
  }
  // The first sheet that has data (the template's Instructions sheet is second).
  const sheet = wb.SheetNames.map((n) => wb.Sheets[n]).find((ws) => ws && ws["!ref"]);
  if (!sheet) throw new Error("The file is empty.");
  const date1904 = Boolean(wb.Workbook?.WBProps?.date1904);
  const range = XLSX.utils.decode_range(sheet["!ref"]);

  const valueAt = (r, c) => {
    const cell = sheet[XLSX.utils.encode_cell({ r, c })];
    if (!cell || cell.v === undefined || cell.v === null) return "";
    if (cell.t === "n" && cell.z && XLSX.SSF.is_date(cell.z)) {
      const d = XLSX.SSF.parse_date_code(cell.v, { date1904 });
      if (d && d.y) return `${d.y}-${pad(d.m)}-${pad(d.d)}`;
    }
    if (cell.t === "d" && cell.v instanceof Date) {
      const d = cell.v;
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
    if (cell.t === "b") return cell.v ? "TRUE" : "FALSE";
    return cell.v;
  };

  let headerRow = -1;
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 20); r++) {
    let filled = 0;
    for (let c = range.s.c; c <= range.e.c; c++) if (String(valueAt(r, c)).trim() !== "") filled += 1;
    if (filled >= 2) {
      headerRow = r;
      break;
    }
  }
  if (headerRow < 0) throw new Error("No header row found. The first row should hold the column names.");

  const headers = [];
  for (let c = range.s.c; c <= range.e.c; c++) headers[c] = String(valueAt(headerRow, c)).trim();

  const rows = [];
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const cells = {};
    let any = false;
    for (let c = range.s.c; c <= range.e.c; c++) {
      if (!headers[c]) continue;
      const v = valueAt(r, c);
      if (String(v).trim() === "") continue;
      cells[headers[c]] = v;
      any = true;
    }
    if (any) rows.push({ row: r + 1, cells });
  }
  return rows;
}
