import ExcelJS from "exceljs";
import { addChartsToWorkbook } from "./excelCharts.js";

// Reports & Analytics Excel workbook, one sheet per report section, built
// from the same buildAnalytics() result as the screen and the PDF. Derived
// figures (gross/net profit, margins, CGST/SGST, change vs previous period,
// totals) are live Excel formulas, so they stay right if a number is edited;
// each formula also carries its computed result for viewers that don't
// recalculate. Main lists get filters; losses, low stock and expiries are
// highlighted with conditional formatting; charts are native Excel charts.

export const EXCEL_SHEETS = {
  summary: "Dashboard Summary",
  sales: "Revenue and Sales",
  expenses: "Expenses",
  purchases: "Purchases",
  products: "Products and Brands",
  inventory: "Inventory and Stock",
  parties: "Customers and Suppliers",
  gst: "GST and Tax Reports",
  pnl: "Profit and Loss",
  transactions: "Transaction History",
};

const ARGB = (hex) => `FF${hex.replace("#", "").toUpperCase()}`;
const BRAND = "#0E7C74";
const INK = "#15232B";
const MUTED = "#64717D";
const HEADER_FILL = "#E6F3F1";
const DANGER = "#C43D36";
const WARNING_FILL = "#FDF1E2";
const DANGER_FILL = "#FBE9E8";
const C_REVENUE = "#2A78D6";
const C_EXPENSE = "#EB6834";
const C_PROFIT = "#1BAF7A";

const FMT = {
  money: '"₹"#,##0.00;[Red]-"₹"#,##0.00',
  pct: "0.0%;[Red]-0.0%",
  int: "#,##0",
  qty: "#,##0.##",
  date: "dd-mmm-yyyy",
  text: "@",
};

const IST_OFFSET = 5.5 * 60 * 60 * 1000;
// Excel dates have no time zone; show the shop's (IST) wall-clock date.
const excelDate = (d) => (d ? new Date(new Date(d).getTime() + IST_OFFSET) : null);
const colLetter = (n) => {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const frac = (pct) => (pct === null || pct === undefined ? null : pct / 100);

function makeSheet(wb, name, { shopName, title, meta, generated }) {
  const ws = wb.addWorksheet(name, { properties: { tabColor: { argb: ARGB(BRAND) } }, views: [{ showGridLines: false }] });
  ws.getCell("A1").value = shopName;
  ws.getCell("A1").font = { bold: true, size: 15, color: { argb: ARGB(BRAND) } };
  ws.getCell("A2").value = `${title} — ${name}`;
  ws.getCell("A2").font = { bold: true, size: 12, color: { argb: ARGB(INK) } };
  ws.getCell("A3").value = meta;
  ws.getCell("A3").font = { size: 10, color: { argb: ARGB(MUTED) } };
  ws.getCell("A4").value = `Generated on ${generated}`;
  ws.getCell("A4").font = { size: 9, italic: true, color: { argb: ARGB(MUTED) } };
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  ws.headerFooter = { oddFooter: `&L${shopName} · ${name}&RPage &P of &N` };
  return { ws, row: 6, primary: null };
}

function note(s, text) {
  const cell = s.ws.getCell(`A${s.row}`);
  cell.value = text;
  cell.font = { italic: true, size: 9, color: { argb: ARGB(MUTED) } };
  s.row += 1;
}

// Writes one titled table at the sheet's current row and returns where its
// rows landed. columns: [{ header, key, type, width, formula(rowRefs),
// total: "sum" | (totalRefs) => formula | undefined }]. A formula column's
// computed value is read from row[key] and stored as the formula's result.
function block(s, heading, columns, rows, { filter = false, negative = [], dataBar, status, empty = "No records found for this period.", totalLabel = "Total" } = {}) {
  const { ws } = s;
  if (heading) {
    const cell = ws.getCell(`A${s.row}`);
    cell.value = heading;
    cell.font = { bold: true, size: 12, color: { argb: ARGB(BRAND) } };
    s.row += 1;
  }
  columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.max(col.width || 10, c.width || (c.type === "text" ? 22 : 15));
  });
  const letter = Object.fromEntries(columns.map((c, i) => [c.key, colLetter(i + 1)]));

  const headerRow = s.row;
  const header = ws.getRow(headerRow);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: ARGB(INK) } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ARGB(HEADER_FILL) } };
    cell.alignment = { vertical: "middle", horizontal: c.type && c.type !== "text" ? "right" : "left", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: ARGB(BRAND) } } };
  });
  header.height = 20;
  s.row += 1;

  if (!rows.length) {
    note(s, empty);
    s.row += 1;
    return null;
  }

  const first = s.row;
  rows.forEach((r, idx) => {
    const n = first + idx;
    const refs = Object.fromEntries(columns.map((c) => [c.key, `${letter[c.key]}${n}`]));
    const row = ws.getRow(n);
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      let value = r[c.key];
      if (c.type === "pct") value = frac(value);
      if (c.type === "date") value = excelDate(value);
      cell.value = c.formula ? { formula: c.formula(refs), result: value ?? undefined } : value ?? null;
      if (c.type) cell.numFmt = FMT[c.type];
    });
  });
  const last = first + rows.length - 1;
  s.row = last + 1;

  let totalRow = null;
  if (columns.some((c) => c.total)) {
    totalRow = s.row;
    const refs = Object.fromEntries(columns.map((c) => [c.key, `${letter[c.key]}${totalRow}`]));
    const row = ws.getRow(totalRow);
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (i === 0) cell.value = totalLabel;
      else if (c.total === "sum") {
        const result = rows.reduce((t, r) => t + (Number(c.type === "pct" ? frac(r[c.key]) : r[c.key]) || 0), 0);
        cell.value = { formula: `SUBTOTAL(9,${letter[c.key]}${first}:${letter[c.key]}${last})`, result };
      } else if (typeof c.total === "function") cell.value = { formula: c.total(refs, { first, last, letter }), result: undefined };
      if (c.type) cell.numFmt = FMT[c.type];
      cell.font = { bold: true, color: { argb: ARGB(INK) } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ARGB(HEADER_FILL) } };
      cell.border = { top: { style: "thin", color: { argb: ARGB(BRAND) } } };
    });
    s.row += 1;
  }

  // Losses / negative balances in red.
  negative.forEach((key) =>
    ws.addConditionalFormatting({
      ref: `${letter[key]}${first}:${letter[key]}${totalRow || last}`,
      rules: [{ type: "cellIs", operator: "lessThan", formulae: [0], style: { font: { color: { argb: ARGB(DANGER) }, bold: true } } }],
    })
  );
  if (dataBar) {
    ws.addConditionalFormatting({
      ref: `${letter[dataBar]}${first}:${letter[dataBar]}${last}`,
      rules: [{ type: "dataBar", minLength: 0, maxLength: 100, cfvo: [{ type: "min" }, { type: "max" }], color: { argb: ARGB(C_REVENUE) } }],
    });
  }
  // Whole-row highlight by a status column's text, e.g. "Out of stock".
  if (status) {
    const range = `A${first}:${colLetter(columns.length)}${last}`;
    ws.addConditionalFormatting({
      ref: range,
      rules: status.map((rule, i) => ({
        type: "expression",
        priority: i + 1,
        formulae: [`ISNUMBER(SEARCH("${rule.text}",$${letter[rule.key]}${first}))`],
        style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: ARGB(rule.fill) } }, font: rule.font ? { color: { argb: ARGB(rule.font) } } : undefined },
      })),
    });
  }
  // One filter per sheet (an Excel limit), on its main list.
  if (filter && !s.primary) {
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: last, column: columns.length } };
    s.primary = { headerRow };
  }
  s.row += 1;
  return { headerRow, first, last, totalRow, letter };
}

export async function buildAnalyticsWorkbook({ shopName, title, meta, analytics: a, transactions, sections }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = shopName;
  wb.created = new Date();
  // Excel recalculates every formula when the file is opened.
  wb.calcProperties = { fullCalcOnLoad: true };
  const generated = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const ctx = { shopName, title, meta, generated };
  const charts = [];
  const has = (key) => sections.includes(key);
  const k = a.kpis;
  const pv = a.previous;

  const grossCol = { header: "Gross Profit", key: "grossProfit", type: "money", formula: (r) => `${r.revenue}-${r.cogs}`, total: "sum" };
  const marginCol = (num = "grossProfit") => ({
    header: "Margin",
    key: "marginPct",
    type: "pct",
    width: 11,
    formula: (r) => `IF(${r.revenue}=0,"",${r[num]}/${r.revenue})`,
    total: (r) => `IF(${r.revenue}=0,"",${r[num]}/${r.revenue})`,
  });

  if (has("summary")) {
    const s = makeSheet(wb, EXCEL_SHEETS.summary, ctx);
    const { ws } = s;
    // KPI table: metric | this period | previous | change. Derived rows are formulas over the inputs above them.
    const start = s.row;
    ws.getCell(`A${start}`).value = "Key Figures";
    ws.getCell(`A${start}`).font = { bold: true, size: 12, color: { argb: ARGB(BRAND) } };
    const head = ws.getRow(start + 1);
    ["Metric", "This Period", pv ? "Previous Period" : null, pv ? "Change" : null].forEach((h, i) => {
      if (!h) return;
      const cell = head.getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ARGB(HEADER_FILL) } };
      cell.border = { bottom: { style: "thin", color: { argb: ARGB(BRAND) } } };
    });
    const metrics = [
      { id: "rev", label: "Revenue (net of GST & discounts)", key: "revenue", fmt: "money" },
      { id: "cogs", label: "Cost of Goods Sold", key: "cogs", fmt: "money" },
      { id: "gp", label: "Gross Profit", fmt: "money", f: (c) => `${c}{rev}-${c}{cogs}`, key: "grossProfit" },
      { id: "exp", label: "Expenses", key: "expenses", fmt: "money" },
      { id: "wo", label: "Expired Stock Write-off", key: "expiredWriteOff", fmt: "money" },
      { id: "np", label: "Net Profit", fmt: "money", f: (c) => `${c}{gp}-${c}{exp}-${c}{wo}`, key: "profit" },
      { id: "nm", label: "Net Profit Margin", fmt: "pct", f: (c) => `IF(${c}{rev}=0,"",${c}{np}/${c}{rev})`, key: "netMarginPct", pct: true },
      { id: "gm", label: "Gross Margin", fmt: "pct", f: (c) => `IF(${c}{rev}=0,"",${c}{gp}/${c}{rev})`, key: "grossMarginPct", pct: true },
      { id: "pur", label: "Purchases", key: "purchases", fmt: "money" },
      { id: "bills", label: "Bills", key: "salesCount", fmt: "int" },
      { id: "avg", label: "Average Bill Value", fmt: "money", f: (c) => `IF(${c}{bills}=0,0,${c}{rev}/${c}{bills})`, key: "avgBillValue" },
      { id: "og", label: "Output GST", key: "outputGst", fmt: "money" },
      { id: "ig", label: "Input GST", key: "inputGst", fmt: "money" },
      { id: "ng", label: "Net GST Payable", fmt: "money", f: (c) => `${c}{og}-${c}{ig}`, key: "netGst" },
    ];
    const rowOf = Object.fromEntries(metrics.map((m, i) => [m.id, start + 2 + i]));
    const resolve = (template) => template.replace(/\{(\w+)\}/g, (_, id) => rowOf[id]);
    metrics.forEach((m) => {
      const n = rowOf[m.id];
      const row = ws.getRow(n);
      row.getCell(1).value = m.label;
      const put = (colIdx, letter, src) => {
        const v = src[m.key];
        const result = m.pct ? frac(v) : v;
        const cell = row.getCell(colIdx);
        cell.value = m.f ? { formula: resolve(m.f(letter)), result: result ?? undefined } : result;
        cell.numFmt = FMT[m.fmt];
        if (m.f) cell.font = { bold: m.id === "np" };
      };
      put(2, "B", k);
      if (pv) {
        put(3, "C", pv);
        const cell = row.getCell(4);
        // Margins change in percentage points; amounts in % of the previous value.
        cell.value = m.pct ? { formula: `IF(OR(B${n}="",C${n}=""),"",B${n}-C${n})` } : { formula: `IF(C${n}=0,"",(B${n}-C${n})/ABS(C${n}))` };
        cell.numFmt = FMT.pct;
      }
    });
    const kpiEnd = start + 1 + metrics.length;
    if (pv) {
      ws.addConditionalFormatting({
        ref: `D${start + 2}:D${kpiEnd}`,
        rules: [
          { type: "cellIs", operator: "lessThan", formulae: [0], style: { font: { color: { argb: ARGB(DANGER) } } } },
          { type: "cellIs", operator: "greaterThan", formulae: [0], style: { font: { color: { argb: "FF178A55" } } } },
        ],
      });
      ws.getCell(`A${kpiEnd + 1}`).value = `Previous period: ${a.previousPeriod.from} to ${a.previousPeriod.to}. Change is % of the previous value (percentage points for margins).`;
      ws.getCell(`A${kpiEnd + 1}`).font = { italic: true, size: 9, color: { argb: ARGB(MUTED) } };
    }
    ws.getColumn(1).width = 36;
    s.row = kpiEnd + 3;
    if (!a.hasData) note(s, "No sales, purchases or expenses were recorded in this period. Add records or import products to see figures here.");

    const t = block(
      s,
      `Trend by ${a.period.granularity}`,
      [
        { header: "Period", key: "label", type: "text", width: 18 },
        { header: "Revenue", key: "revenue", type: "money", total: "sum" },
        { header: "COGS", key: "cogs", type: "money", total: "sum" },
        { header: "Expenses", key: "expenses", type: "money", total: "sum" },
        { header: "Write-off", key: "writeOff", type: "money", total: "sum" },
        { header: "Net Profit", key: "profit", type: "money", formula: (r) => `${r.revenue}-${r.cogs}-${r.expenses}-${r.writeOff}`, total: "sum" },
        { header: "Net Margin", key: "marginPct", type: "pct", formula: (r) => `IF(${r.revenue}=0,"",${r.profit}/${r.revenue})`, total: (r) => `IF(${r.revenue}=0,"",${r.profit}/${r.revenue})` },
        { header: "Purchases", key: "purchases", type: "money", total: "sum" },
        { header: "Bills", key: "bills", type: "int", total: "sum" },
      ],
      a.trend,
      { negative: ["profit", "marginPct"], filter: true }
    );
    if (t) {
      const cats = { col: "A", from: t.first, to: t.last, values: a.trend.map((x) => x.label) };
      charts.push({
        sheet: EXCEL_SHEETS.summary,
        type: "column",
        title: "Revenue vs Expenses",
        anchor: { col: 5, row: 5, cols: 8, rows: 16 },
        categories: cats,
        series: [
          { name: "Revenue", col: t.letter.revenue, from: t.first, to: t.last, values: a.trend.map((x) => x.revenue), color: C_REVENUE },
          { name: "Expenses", col: t.letter.expenses, from: t.first, to: t.last, values: a.trend.map((x) => x.expenses), color: C_EXPENSE },
        ],
      });
      charts.push({
        sheet: EXCEL_SHEETS.summary,
        type: "line",
        title: "Net Profit Trend",
        anchor: { col: 13, row: 5, cols: 8, rows: 16 },
        categories: cats,
        series: [{ name: "Net Profit", col: t.letter.profit, from: t.first, to: t.last, values: a.trend.map((x) => x.profit), color: C_PROFIT }],
      });
    }
  }

  if (has("sales")) {
    const s = makeSheet(wb, EXCEL_SHEETS.sales, ctx);
    block(
      s,
      "By Payment Mode",
      [
        { header: "Payment Mode", key: "mode", type: "text" },
        { header: "Bills", key: "bills", type: "int", total: "sum" },
        { header: "Revenue", key: "revenue", type: "money", total: "sum" },
        { header: "GST", key: "gst", type: "money", total: "sum" },
        { header: "Billed (incl. GST)", key: "collected", type: "money", formula: (r) => `${r.revenue}+${r.gst}`, total: "sum" },
      ],
      a.paymentModes
    );
    const cat = block(
      s,
      "By Category",
      [
        { header: "Category", key: "category", type: "text" },
        { header: "Bills", key: "bills", type: "int" },
        { header: "Revenue", key: "revenue", type: "money", total: "sum" },
        { header: "COGS", key: "cogs", type: "money", total: "sum" },
        grossCol,
        marginCol(),
      ],
      a.categories,
      { negative: ["grossProfit"], dataBar: "revenue" }
    );
    if (cat) {
      const top = a.categories.slice(0, 12);
      charts.push({
        sheet: EXCEL_SHEETS.sales,
        type: "bar",
        title: "Category-wise Sales",
        anchor: { col: 7, row: 5, cols: 8, rows: Math.max(12, top.length + 6) },
        categories: { col: "A", from: cat.first, to: cat.first + top.length - 1, values: top.map((c) => c.category) },
        series: [{ name: "Revenue", col: cat.letter.revenue, from: cat.first, to: cat.first + top.length - 1, values: top.map((c) => c.revenue), color: BRAND }],
      });
    }
    const bills = (transactions || []).filter((t) => t.type === "Sale");
    block(
      s,
      "Bills",
      [
        { header: "Date", key: "date", type: "date", width: 13 },
        { header: "Bill No", key: "ref", type: "text", width: 14 },
        { header: "Customer", key: "party", type: "text" },
        { header: "Payment", key: "mode", type: "text", width: 11 },
        { header: "Taxable", key: "taxable", type: "money", total: (r, { first, last, letter }) => `SUMIFS(${letter.taxable}${first}:${letter.taxable}${last},${letter.status}${first}:${letter.status}${last},"<>Void")` },
        { header: "GST", key: "gst", type: "money", total: (r, { first, last, letter }) => `SUMIFS(${letter.gst}${first}:${letter.gst}${last},${letter.status}${first}:${letter.status}${last},"<>Void")` },
        { header: "Total", key: "amount", type: "money", total: (r, { first, last, letter }) => `SUMIFS(${letter.amount}${first}:${letter.amount}${last},${letter.status}${first}:${letter.status}${last},"<>Void")` },
        { header: "Status", key: "status", type: "text", width: 10 },
      ],
      bills,
      { filter: true, totalLabel: "Total (excl. void)", status: [{ key: "status", text: "Void", fill: "#EEF1F4", font: MUTED }, { key: "status", text: "Due", fill: WARNING_FILL }] }
    );
  }

  if (has("expenses")) {
    const s = makeSheet(wb, EXCEL_SHEETS.expenses, ctx);
    if (a.pnl.expenseSharePct !== null && a.pnl.expenseSharePct !== 100) {
      note(s, `With the report filters on, the filtered sales carry ${a.pnl.expenseSharePct}% of these expenses (their share of revenue) in the P&L.`);
      s.row += 1;
    }
    const ec = block(
      s,
      "By Category",
      [
        { header: "Category", key: "category", type: "text" },
        { header: "Entries", key: "count", type: "int", total: "sum" },
        { header: "Amount", key: "amount", type: "money", total: "sum" },
        { header: "Share", key: "sharePct", type: "pct" },
      ],
      a.expenseCategories
    );
    // Share = amount ÷ the block's total row, which is only known once written.
    if (ec) {
      for (let n = ec.first; n <= ec.last; n++) {
        const cell = s.ws.getCell(`${ec.letter.sharePct}${n}`);
        cell.value = { formula: `IF(${ec.letter.amount}${ec.totalRow}=0,"",${ec.letter.amount}${n}/${ec.letter.amount}${ec.totalRow})`, result: cell.value ?? undefined };
      }
      charts.push({
        sheet: EXCEL_SHEETS.expenses,
        type: "bar",
        title: "Expenses by Category",
        anchor: { col: 5, row: 5, cols: 7, rows: Math.max(12, a.expenseCategories.length + 6) },
        categories: { col: "A", from: ec.first, to: ec.last, values: a.expenseCategories.map((e) => e.category) },
        series: [{ name: "Amount", col: ec.letter.amount, from: ec.first, to: ec.last, values: a.expenseCategories.map((e) => e.amount), color: C_EXPENSE }],
      });
    }
    block(
      s,
      "Expense Entries",
      [
        { header: "Date", key: "date", type: "date", width: 13 },
        { header: "Category", key: "ref", type: "text" },
        { header: "Payment", key: "mode", type: "text", width: 11 },
        { header: "Amount", key: "amount", type: "money", total: "sum" },
        { header: "Notes", key: "party", type: "text", width: 34 },
      ],
      (transactions || []).filter((t) => t.type === "Expense"),
      { filter: true }
    );
  }

  if (has("purchases")) {
    const s = makeSheet(wb, EXCEL_SHEETS.purchases, ctx);
    const sup = block(
      s,
      "By Supplier",
      [
        { header: "Supplier", key: "name", type: "text", width: 28 },
        { header: "GSTIN", key: "gstNumber", type: "text", width: 18 },
        { header: "Invoices", key: "invoices", type: "int", total: "sum" },
        { header: "Purchases", key: "purchases", type: "money", total: "sum" },
        { header: "Input GST", key: "gst", type: "money", total: "sum" },
        { header: "Outstanding Now", key: "outstanding", type: "money", total: "sum" },
      ],
      a.suppliers,
      { dataBar: "purchases" }
    );
    if (sup && a.suppliers.some((x) => x.purchases > 0)) {
      const top = a.suppliers.slice(0, 10);
      charts.push({
        sheet: EXCEL_SHEETS.purchases,
        type: "bar",
        title: "Purchases by Supplier",
        anchor: { col: 7, row: 5, cols: 7, rows: Math.max(12, top.length + 6) },
        categories: { col: "A", from: sup.first, to: sup.first + top.length - 1, values: top.map((x) => x.name) },
        series: [{ name: "Purchases", col: sup.letter.purchases, from: sup.first, to: sup.first + top.length - 1, values: top.map((x) => x.purchases), color: "#64717D" }],
      });
    }
    block(
      s,
      "Purchase Invoices",
      [
        { header: "Date", key: "date", type: "date", width: 13 },
        { header: "Invoice No", key: "ref", type: "text", width: 16 },
        { header: "Supplier", key: "party", type: "text" },
        { header: "Payment", key: "mode", type: "text", width: 13 },
        { header: "Taxable", key: "taxable", type: "money", total: "sum" },
        { header: "GST", key: "gst", type: "money", total: "sum" },
        { header: "Total", key: "amount", type: "money", total: "sum" },
        { header: "Status", key: "status", type: "text", width: 10 },
      ],
      (transactions || []).filter((t) => t.type === "Purchase"),
      { filter: true, status: [{ key: "status", text: "Due", fill: WARNING_FILL }] }
    );
  }

  if (has("products")) {
    const s = makeSheet(wb, EXCEL_SHEETS.products, ctx);
    block(
      s,
      "Product Performance",
      [
        { header: "Product", key: "name", type: "text", width: 30 },
        { header: "SKU", key: "code", type: "text", width: 12 },
        { header: "Brand", key: "brand", type: "text", width: 18 },
        { header: "Category", key: "category", type: "text", width: 16 },
        { header: "Qty (packs)", key: "qtyPacks", type: "qty", total: "sum" },
        { header: "Revenue", key: "revenue", type: "money", total: "sum" },
        { header: "COGS", key: "cogs", type: "money", total: "sum" },
        grossCol,
        marginCol(),
      ],
      a.products,
      { filter: true, negative: ["grossProfit", "marginPct"], dataBar: "revenue" }
    );
    const br = block(
      s,
      "Brand Performance",
      [
        { header: "Brand", key: "brand", type: "text" },
        { header: "Bills", key: "bills", type: "int" },
        { header: "Qty (packs)", key: "qtyPacks", type: "qty", total: "sum" },
        { header: "Revenue", key: "revenue", type: "money", total: "sum" },
        { header: "COGS", key: "cogs", type: "money", total: "sum" },
        grossCol,
        marginCol(),
      ],
      a.brands,
      { negative: ["grossProfit"] }
    );
    if (br) {
      const top = a.brands.slice(0, 10);
      charts.push({
        sheet: EXCEL_SHEETS.products,
        type: "bar",
        title: "Best-performing Brands",
        anchor: { col: 10, row: 5, cols: 7, rows: Math.max(12, top.length + 6) },
        categories: { col: "A", from: br.first, to: br.first + top.length - 1, values: top.map((b) => b.brand) },
        series: [{ name: "Revenue", col: br.letter.revenue, from: br.first, to: br.first + top.length - 1, values: top.map((b) => b.revenue), color: BRAND }],
      });
    }
    block(
      s,
      "Product Catalog",
      [
        { header: "Product", key: "name", type: "text", width: 30 },
        { header: "SKU", key: "sku", type: "text", width: 12 },
        { header: "Brand", key: "brand", type: "text", width: 18 },
        { header: "Category", key: "category", type: "text", width: 16 },
        { header: "Supplier", key: "supplier", type: "text", width: 22 },
        { header: "Selling Price", key: "sellingPrice", type: "money" },
        { header: "Purchase Price", key: "purchasePrice", type: "money" },
        { header: "GST %", key: "gstPercent", type: "int", width: 8 },
        { header: "Margin", key: "marginPct", type: "pct", width: 10, formula: (r) => `IF(OR(${r.sellingPrice}=0,${r.purchasePrice}=""),"",(${r.sellingPrice}-${r.purchasePrice})/${r.sellingPrice})` },
        { header: "Stock", key: "qtyDisplay", type: "text", width: 22 },
        { header: "Status", key: "status", type: "text", width: 13 },
      ],
      a.catalog || [],
      { negative: ["marginPct"], status: [{ key: "status", text: "Out of stock", fill: DANGER_FILL, font: DANGER }, { key: "status", text: "Low stock", fill: WARNING_FILL }], empty: "No products yet. Add products or import them from Excel on the Products page." }
    );
  }

  if (has("inventory")) {
    const s = makeSheet(wb, EXCEL_SHEETS.inventory, ctx);
    note(s, "Current stock on hand (as of now, not limited to the report period). Selling value = quantity × selling rate, excluding GST.");
    s.row += 1;
    const rows = (a.catalog || []).map((r) => ({ ...r, expectedProfit: Number((r.valueMrp - r.valueCost).toFixed(2)) }));
    block(
      s,
      "Stock Valuation",
      [
        { header: "Product", key: "name", type: "text", width: 30 },
        { header: "SKU", key: "sku", type: "text", width: 12 },
        { header: "Category", key: "category", type: "text", width: 16 },
        { header: "On Hand", key: "qtyDisplay", type: "text", width: 22 },
        { header: "Value at Cost", key: "valueCost", type: "money", total: "sum" },
        { header: "Value at Selling", key: "valueMrp", type: "money", total: "sum" },
        { header: "Expected Profit", key: "expectedProfit", type: "money", formula: (r) => `${r.valueMrp}-${r.valueCost}`, total: "sum" },
        { header: "Status", key: "status", type: "text", width: 13 },
      ],
      rows,
      { filter: true, negative: ["expectedProfit"], status: [{ key: "status", text: "Out of stock", fill: DANGER_FILL, font: DANGER }, { key: "status", text: "Low stock", fill: WARNING_FILL }], empty: "No products yet." }
    );
    block(
      s,
      "Expiring Batches (next 90 days)",
      [
        { header: "Product", key: "name", type: "text", width: 30 },
        { header: "SKU", key: "code", type: "text", width: 12 },
        { header: "Batch", key: "batchNo", type: "text", width: 14 },
        { header: "Expiry", key: "expiryDate", type: "date", width: 13 },
        { header: "Days Left", key: "daysLeft", type: "int", width: 10 },
        { header: "Qty Left", key: "qtyRemaining", type: "int", width: 10 },
        { header: "Value at Cost", key: "valueCost", type: "money", total: "sum" },
        { header: "Status", key: "status", type: "text", width: 15 },
      ],
      a.inventory.expiring,
      { status: [{ key: "status", text: "Expired", fill: DANGER_FILL, font: DANGER }, { key: "status", text: "30 days", fill: WARNING_FILL }], empty: "No batches expire in the next 90 days." }
    );
  }

  if (has("parties")) {
    const s = makeSheet(wb, EXCEL_SHEETS.parties, ctx);
    note(s, "Revenue is for the report period; outstanding balances are as of now.");
    s.row += 1;
    block(
      s,
      "Customers",
      [
        { header: "Customer", key: "name", type: "text", width: 26 },
        { header: "Phone", key: "phone", type: "text", width: 14 },
        { header: "Bills", key: "bills", type: "int", total: "sum" },
        { header: "Revenue", key: "revenue", type: "money", total: "sum" },
        { header: "Receivable Now", key: "outstanding", type: "money", total: "sum" },
      ],
      a.customers,
      { filter: true, dataBar: "outstanding", empty: "No named-customer sales or receivables." }
    );
    block(
      s,
      "Suppliers",
      [
        { header: "Supplier", key: "name", type: "text", width: 26 },
        { header: "GSTIN", key: "gstNumber", type: "text", width: 18 },
        { header: "Invoices", key: "invoices", type: "int", total: "sum" },
        { header: "Purchases", key: "purchases", type: "money", total: "sum" },
        { header: "Payable Now", key: "outstanding", type: "money", total: "sum" },
      ],
      a.suppliers,
      { dataBar: "outstanding", empty: "No supplier purchases or payables." }
    );
  }

  if (has("gst")) {
    const s = makeSheet(wb, EXCEL_SHEETS.gst, ctx);
    note(s, "CGST and SGST are an equal split of GST (intra-state supply). Check against your GST returns before filing.");
    s.row += 1;
    const slabCols = [
      { header: "GST Rate", key: "rate", type: "int", width: 10 },
      { header: "Taxable Value", key: "taxable", type: "money", total: "sum" },
      { header: "CGST", key: "cgst", type: "money", formula: (r) => `ROUND(${r.gst}/2,2)`, total: "sum" },
      { header: "SGST", key: "sgst", type: "money", formula: (r) => `${r.gst}-${r.cgst}`, total: "sum" },
      { header: "Total GST", key: "gst", type: "money", total: "sum" },
    ];
    const out = block(s, "Output GST (on sales)", slabCols, a.gst.output, { empty: "No taxable sales in this period." });
    const inp = block(s, "Input GST (on purchases)", slabCols, a.gst.input, { empty: "No purchases in this period." });
    block(
      s,
      "Net GST by Rate",
      [
        { header: "GST Rate", key: "rate", type: "int", width: 10 },
        { header: "Output GST", key: "output", type: "money", total: "sum" },
        { header: "Input GST", key: "input", type: "money", total: "sum" },
        { header: "Net Payable", key: "net", type: "money", formula: (r) => `${r.output}-${r.input}`, total: "sum" },
      ],
      a.gst.byRate,
      { negative: ["net"] }
    );
    if (out && inp) note(s, `Net GST payable for the period: output ${a.gst.outputTotal.toFixed(2)} − input ${a.gst.inputTotal.toFixed(2)} = ${a.gst.netPayable.toFixed(2)}.`);
  }

  if (has("pnl")) {
    const s = makeSheet(wb, EXCEL_SHEETS.pnl, ctx);
    const { ws } = s;
    const pl = a.pnl;
    ws.getCell(`A${s.row}`).value = "Profit & Loss Statement";
    ws.getCell(`A${s.row}`).font = { bold: true, size: 12, color: { argb: ARGB(BRAND) } };
    s.row += 1;
    const lines = [
      { id: "rev", label: "Revenue (net of GST & discounts)", v: pl.revenue },
      { id: "cogs", label: "Less: Cost of goods sold", v: pl.cogs },
      { id: "gp", label: "Gross Profit", f: "B{rev}-B{cogs}", v: pl.grossProfit, bold: true },
      { id: "exp", label: `Less: Expenses${pl.expenseSharePct !== null && pl.expenseSharePct !== 100 ? ` (${pl.expenseSharePct}% share for the filters)` : ""}`, v: pl.expenses },
      { id: "wo", label: "Less: Expired stock write-off", v: pl.expiredWriteOff },
      { id: "np", label: "Net Profit", f: "B{gp}-B{exp}-B{wo}", v: pl.profit, bold: true },
      { id: "int", label: "Add back: Interest", v: pl.interest },
      { id: "tax", label: "Add back: Taxes", v: pl.taxes },
      { id: "dep", label: "Add back: Depreciation", v: pl.depreciation },
      { id: "amo", label: "Add back: Amortization", v: pl.amortization },
      { id: "ebitda", label: "EBITDA", f: "B{np}+B{int}+B{tax}+B{dep}+B{amo}", v: pl.ebitda, bold: true },
      { id: "gm", label: "Gross Margin", f: 'IF(B{rev}=0,"",B{gp}/B{rev})', v: frac(pl.grossMarginPct), pct: true },
      { id: "nm", label: "Net Margin", f: 'IF(B{rev}=0,"",B{np}/B{rev})', v: frac(pl.netMarginPct), pct: true },
      { id: "em", label: "EBITDA Margin", f: 'IF(B{rev}=0,"",B{ebitda}/B{rev})', v: frac(pl.ebitdaMarginPct), pct: true },
      { id: "roi", label: "ROI (net profit ÷ cost of goods sold)", f: 'IF(B{cogs}=0,"",B{np}/B{cogs})', v: frac(pl.roiPct), pct: true },
      { id: "oi", label: "Opening Inventory (cost)", v: pl.openingInventory },
      { id: "ci", label: "Closing Inventory (cost)", v: pl.closingInventory },
      { id: "turn", label: "Inventory Turnover (×)", f: 'IF((B{oi}+B{ci})=0,"",B{cogs}/((B{oi}+B{ci})/2))', v: pl.inventoryTurnover, num: true },
    ];
    const rowOf = Object.fromEntries(lines.map((l, i) => [l.id, s.row + i]));
    lines.forEach((l) => {
      const n = rowOf[l.id];
      ws.getCell(`A${n}`).value = l.label;
      const cell = ws.getCell(`B${n}`);
      cell.value = l.f ? { formula: l.f.replace(/\{(\w+)\}/g, (_, id) => rowOf[id]), result: l.v ?? undefined } : l.v;
      cell.numFmt = l.pct ? FMT.pct : l.num ? "0.00" : FMT.money;
      if (l.bold) {
        ws.getCell(`A${n}`).font = { bold: true };
        cell.font = { bold: true };
        cell.border = { top: { style: "thin", color: { argb: ARGB(BRAND) } } };
      }
    });
    ws.getColumn(1).width = 48;
    ws.getColumn(2).width = 18;
    ws.addConditionalFormatting({
      ref: `B${rowOf.rev}:B${rowOf.em}`,
      rules: [{ type: "cellIs", operator: "lessThan", formulae: [0], style: { font: { color: { argb: ARGB(DANGER) }, bold: true } } }],
    });
    s.row = rowOf.turn + 2;

    block(
      s,
      "Cash Flow by Mode (shop-wide)",
      [
        { header: "Mode", key: "mode", type: "text" },
        { header: "Inflow", key: "inflow", type: "money", total: "sum" },
        { header: "Outflow", key: "outflow", type: "money", total: "sum" },
        { header: "Net", key: "net", type: "money", formula: (r) => `${r.inflow}-${r.outflow}`, total: "sum" },
      ],
      a.cashFlow.byMode,
      { negative: ["net"], empty: "No money moved in this period." }
    );
    block(
      s,
      "Cash Flow Detail",
      [
        { header: "Line", key: "label", type: "text" },
        { header: "Amount", key: "amount", type: "money" },
        { header: "Direction", key: "direction", type: "text", width: 10 },
      ],
      [
        ...a.cashFlow.lines,
        { label: "New credit given to customers (not cash)", amount: a.cashFlow.newReceivables, direction: "-" },
        { label: "New credit taken from suppliers (not cash)", amount: a.cashFlow.newPayables, direction: "-" },
        { label: "Total receivables now", amount: a.receivables.total, direction: "-" },
        { label: "Total payables now", amount: a.payables.total, direction: "-" },
      ]
    );
  }

  if (has("transactions")) {
    const s = makeSheet(wb, EXCEL_SHEETS.transactions, ctx);
    const list = transactions || [];
    const tr = block(
      s,
      null,
      [
        { header: "Date", key: "date", type: "date", width: 13 },
        { header: "Type", key: "type", type: "text", width: 17 },
        { header: "Reference", key: "ref", type: "text", width: 16 },
        { header: "Party / Notes", key: "party", type: "text", width: 26 },
        { header: "Mode", key: "mode", type: "text", width: 13 },
        { header: "Taxable", key: "taxable", type: "money" },
        { header: "GST", key: "gst", type: "money" },
        { header: "Amount", key: "amount", type: "money" },
        { header: "In / Out", key: "direction", type: "text", width: 9 },
        { header: "Status", key: "status", type: "text", width: 10 },
      ],
      list,
      { filter: true, status: [{ key: "status", text: "Void", fill: "#EEF1F4", font: MUTED }, { key: "status", text: "Due", fill: WARNING_FILL }], empty: "No transactions in this period." }
    );
    s.ws.views = [{ state: "frozen", ySplit: 6, showGridLines: false }];
    if (tr) {
      // Totals that respect the sheet's filter: SUBTOTAL ignores hidden rows.
      const { first, last, letter } = tr;
      const dir = `${letter.direction}${first}:${letter.direction}${last}`;
      const amt = `${letter.amount}${first}:${letter.amount}${last}`;
      const st = `${letter.status}${first}:${letter.status}${last}`;
      const n = tr.last + 2;
      const put = (r, label, formula) => {
        s.ws.getCell(`G${r}`).value = label;
        s.ws.getCell(`G${r}`).font = { bold: true };
        s.ws.getCell(`H${r}`).value = { formula };
        s.ws.getCell(`H${r}`).numFmt = FMT.money;
        s.ws.getCell(`H${r}`).font = { bold: true };
      };
      put(n, "Money in", `SUMIFS(${amt},${dir},"in",${st},"<>Void")`);
      put(n + 1, "Money out", `SUMIFS(${amt},${dir},"out")`);
      put(n + 2, "Net", `H${n}-H${n + 1}`);
      put(n + 3, "Visible rows total", `SUBTOTAL(9,${amt})`);
    }
  }

  if (!wb.worksheets.length) {
    const s = makeSheet(wb, "Report", ctx);
    note(s, "No report sections were selected.");
  }

  const buffer = await wb.xlsx.writeBuffer();
  return addChartsToWorkbook(Buffer.from(buffer), charts);
}
