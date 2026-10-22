import PDFDocument from "pdfkit";

// Reports & Analytics PDF: brand header, summary cards, vector charts and
// tables with totals, built from a buildAnalytics() result so every figure
// matches the screen and the Excel workbook. pdfkit's built-in Helvetica has
// no ₹ glyph, so amounts print as "Rs." (same as the other PDF reports).

const INK = "#15232B";
const MUTED = "#64717D";
const RULE = "#E3E8ED";
const BRAND = "#0E7C74";
const BRAND_DARK = "#0A5F59";
const HEADER_FILL = "#E6F3F1";
const STRIPE = "#F6F8F9";
const SUCCESS = "#178A55";
const DANGER = "#C43D36";
// Categorical slots 1-3 of the dashboard's chart palette.
const C_REVENUE = "#2A78D6";
const C_EXPENSE = "#EB6834";
const C_PROFIT = "#1BAF7A";

const TIME_ZONE = "Asia/Kolkata";
const inr = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
export const rs = (n) => `${n < 0 ? "-" : ""}Rs. ${inr.format(Math.abs(Number(n || 0)))}`;
const pct = (n) => (n === null || n === undefined ? "-" : `${n}%`);
const num = (n) => int.format(Number(n || 0));
const date = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { timeZone: TIME_ZONE, day: "2-digit", month: "short", year: "numeric" }) : "-");
const sum = (rows, key) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);

function compact(n) {
  const v = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const trim = (x) => (x >= 100 ? Math.round(x).toString() : x.toFixed(1).replace(/\.0$/, ""));
  if (v >= 1e7) return `${sign}${trim(v / 1e7)}Cr`;
  if (v >= 1e5) return `${sign}${trim(v / 1e5)}L`;
  if (v >= 1e3) return `${sign}${trim(v / 1e3)}K`;
  return `${sign}${Math.round(v)}`;
}

// "Nice" axis ticks covering [min, max].
function ticks(min, max, count = 4) {
  if (max === min) max = min + 1;
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

const TRANSACTION_PDF_LIMIT = 1000;

export function streamAnalyticsPdf(res, { shopName, title, subtitle, filterLine, analytics: a, transactions, sections }) {
  const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true, info: { Title: title, Author: shopName } });
  doc.pipe(res);

  const L = doc.page.margins.left;
  const W = doc.page.width - L - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 20;

  const ensure = (h) => {
    if (doc.y + h > bottom()) {
      doc.addPage();
      doc.y = doc.page.margins.top;
    }
  };

  // ── Header: brand mark, shop name, report title, period, generated on ──
  function brandMark(x, y, size) {
    doc.save();
    doc.roundedRect(x, y, size, size, size * 0.24).fill(BRAND);
    const u = size / 6; // the app's cross icon on a 6-unit grid
    doc
      .polygon(
        [x + 2.2 * u, y + 1 * u], [x + 3.8 * u, y + 1 * u], [x + 3.8 * u, y + 2.2 * u], [x + 5 * u, y + 2.2 * u],
        [x + 5 * u, y + 3.8 * u], [x + 3.8 * u, y + 3.8 * u], [x + 3.8 * u, y + 5 * u], [x + 2.2 * u, y + 5 * u],
        [x + 2.2 * u, y + 3.8 * u], [x + 1 * u, y + 3.8 * u], [x + 1 * u, y + 2.2 * u], [x + 2.2 * u, y + 2.2 * u]
      )
      .fill("#FFFFFF");
    doc.restore();
  }

  const generated = new Date().toLocaleString("en-IN", { timeZone: TIME_ZONE, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const top = doc.page.margins.top;
  brandMark(L, top, 38);
  doc.font("Helvetica-Bold").fontSize(16).fillColor(INK).text(shopName, L + 50, top + 2, { width: W - 50 });
  doc.font("Helvetica").fontSize(10).fillColor(MUTED).text("Reports & Analytics", L + 50, top + 22, { width: W - 50 });
  doc.y = top + 54;
  doc.font("Helvetica-Bold").fontSize(20).fillColor(BRAND_DARK).text(title, L, doc.y, { width: W });
  doc.font("Helvetica").fontSize(10).fillColor(INK).text(subtitle, { width: W });
  if (filterLine) doc.fontSize(9).fillColor(MUTED).text(`Filters: ${filterLine}`, { width: W });
  doc.fontSize(9).fillColor(MUTED).text(`Generated on ${generated}`, { width: W });
  doc.moveDown(0.5);
  doc.moveTo(L, doc.y).lineTo(L + W, doc.y).lineWidth(1).strokeColor(BRAND).stroke();
  doc.moveDown(0.8);

  function heading(text, note) {
    ensure(70);
    doc.moveDown(0.4);
    const y = doc.y;
    doc.rect(L, y + 1, 3, 14).fill(BRAND);
    doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text(text, L + 10, y, { width: W - 10 });
    if (note) doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(note, L + 10, doc.y + 1, { width: W - 10 });
    doc.x = L;
    doc.moveDown(0.5);
  }

  function para(text) {
    ensure(20);
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(text, L, doc.y, { width: W });
    doc.moveDown(0.4);
  }

  // ── Summary cards: label, value, change vs previous period ──
  function cards(items, perRow = 4) {
    const gap = 8;
    const cw = (W - gap * (perRow - 1)) / perRow;
    const ch = 54;
    for (let i = 0; i < items.length; i += perRow) {
      ensure(ch + gap);
      const y = doc.y;
      items.slice(i, i + perRow).forEach((card, j) => {
        const x = L + j * (cw + gap);
        doc.roundedRect(x, y, cw, ch, 6).fillAndStroke("#FFFFFF", RULE);
        doc.rect(x, y + 8, 2.5, ch - 16).fill(card.accent || BRAND);
        doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(card.label, x + 9, y + 8, { width: cw - 14, lineBreak: false, ellipsis: true });
        doc.font("Helvetica-Bold").fontSize(12).fillColor(card.tone || INK).text(card.value, x + 9, y + 21, { width: cw - 14, lineBreak: false, ellipsis: true });
        if (card.delta) doc.font("Helvetica").fontSize(7.5).fillColor(card.delta.tone).text(card.delta.text, x + 9, y + 39, { width: cw - 14, lineBreak: false, ellipsis: true });
      });
      doc.y = y + ch + gap;
    }
    doc.x = L;
    doc.moveDown(0.3);
  }

  // Change vs the previous period. For costs, a rise is shown in red.
  function delta(cur, prevVal, { costLike = false, points = false } = {}) {
    if (!a.previous || prevVal === null || prevVal === undefined || cur === null || cur === undefined) return null;
    if (points) {
      const d = Number((cur - prevVal).toFixed(1));
      return { text: `${d >= 0 ? "+" : ""}${d} pts vs previous`, tone: d === 0 ? MUTED : (d > 0) !== costLike ? SUCCESS : DANGER };
    }
    if (prevVal === 0) return { text: cur === 0 ? "No change vs previous" : "New vs previous (was 0)", tone: MUTED };
    const d = Number((((cur - prevVal) / Math.abs(prevVal)) * 100).toFixed(1));
    return { text: `${d >= 0 ? "+" : ""}${d}% vs previous`, tone: d === 0 ? MUTED : (d > 0) !== costLike ? SUCCESS : DANGER };
  }

  function legend(x, y, series) {
    let cx = x;
    doc.font("Helvetica").fontSize(8).fillColor(MUTED);
    series.forEach((s) => {
      doc.circle(cx + 3, y + 4, 3).fill(s.color);
      doc.fillColor(MUTED).text(s.name, cx + 10, y, { lineBreak: false });
      cx += 18 + doc.widthOfString(s.name);
    });
  }

  // Shared plot frame: y-axis gridlines + compact labels; returns a value->y mapper.
  function plotFrame(x, y, w, h, min, max) {
    const t = ticks(Math.min(0, min), Math.max(0, max));
    const lo = t[0];
    const hi = t[t.length - 1];
    const toY = (v) => y + h - ((v - lo) / (hi - lo)) * h;
    doc.font("Helvetica").fontSize(7).fillColor(MUTED);
    t.forEach((v) => {
      const ty = toY(v);
      doc.moveTo(x, ty).lineTo(x + w, ty).lineWidth(0.5).strokeColor(v === 0 ? "#B9C3CB" : RULE).stroke();
      doc.fillColor(MUTED).text(compact(v), x - 40, ty - 3.5, { width: 36, align: "right", lineBreak: false });
    });
    return toY;
  }

  function xLabels(x, slot, labels, y) {
    const every = Math.max(1, Math.ceil(labels.length / 10));
    doc.font("Helvetica").fontSize(6.5).fillColor(MUTED);
    labels.forEach((label, i) => {
      if (i % every) return;
      doc.text(label, x + i * slot - 10, y + 4, { width: slot + 20, align: "center", lineBreak: false });
    });
  }

  function chartTitle(text, h) {
    ensure(h + 34);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(text, L, doc.y);
    doc.moveDown(0.2);
  }

  function groupedBars(text, labels, series, h = 150) {
    chartTitle(text, h);
    legend(L, doc.y, series);
    const x = L + 44;
    const y = doc.y + 16;
    const w = W - 50;
    const all = series.flatMap((s) => s.values);
    const toY = plotFrame(x, y, w, h, Math.min(...all, 0), Math.max(...all, 0));
    const slot = w / Math.max(labels.length, 1);
    const barW = Math.max(1.5, Math.min(14, (slot * 0.75) / series.length));
    labels.forEach((_, i) => {
      series.forEach((s, j) => {
        const v = s.values[i] || 0;
        if (!v) return;
        const bx = x + i * slot + (slot - barW * series.length) / 2 + j * barW;
        const y0 = toY(0);
        const y1 = toY(v);
        doc.rect(bx, Math.min(y0, y1), Math.max(barW - 1, 1), Math.abs(y1 - y0)).fill(s.color);
      });
    });
    xLabels(x, slot, labels, y + h);
    doc.y = y + h + 18;
    doc.x = L;
  }

  function lineChart(text, labels, series, h = 120) {
    chartTitle(text, h);
    legend(L, doc.y, series);
    const x = L + 44;
    const y = doc.y + 16;
    const w = W - 50;
    const all = series.flatMap((s) => s.values);
    const toY = plotFrame(x, y, w, h, Math.min(...all, 0), Math.max(...all, 0));
    const slot = w / Math.max(labels.length, 1);
    series.forEach((s) => {
      const pts = s.values.map((v, i) => [x + i * slot + slot / 2, toY(v || 0)]);
      if (!pts.length) return;
      doc.moveTo(...pts[0]);
      pts.slice(1).forEach((p) => doc.lineTo(...p));
      doc.lineWidth(1.6).strokeColor(s.color).stroke();
      if (pts.length <= 31) pts.forEach((p) => doc.circle(p[0], p[1], 1.8).fill(s.color));
    });
    xLabels(x, slot, labels, y + h);
    doc.y = y + h + 18;
    doc.x = L;
  }

  function hBars(text, rows, color = BRAND) {
    if (!rows.length) return;
    const rowH = 15;
    chartTitle(text, rows.length * rowH);
    const labelW = 130;
    const valueW = 80;
    const x = L + labelW;
    const w = W - labelW - valueW;
    const max = Math.max(...rows.map((r) => r.value), 1);
    rows.forEach((r) => {
      const y = doc.y;
      doc.font("Helvetica").fontSize(8).fillColor(INK).text(r.label, L, y + 2, { width: labelW - 8, lineBreak: false, ellipsis: true });
      const bw = Math.max((Math.max(r.value, 0) / max) * w, r.value > 0 ? 1.5 : 0);
      if (bw) doc.roundedRect(x, y + 2, bw, rowH - 6, 2).fill(color);
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(rs(r.value), x + w + 4, y + 2, { width: valueW - 4, align: "right", lineBreak: false });
      doc.y = y + rowH;
    });
    doc.x = L;
    doc.moveDown(0.6);
  }

  // ── Tables: wrapped cells, header repeated on each page, bold totals row ──
  function table(columns, rows, { totals, empty = "No records found for this period." } = {}) {
    if (!rows.length) {
      para(empty);
      return;
    }
    const pad = 3.5;
    const totalFlex = columns.reduce((s, c) => s + (c.flex || 1), 0);
    const widths = columns.map((c) => (W * (c.flex || 1)) / totalFlex);
    const xs = widths.map((_, i) => L + widths.slice(0, i).reduce((s, v) => s + v, 0));
    const cell = (c, row) => (c.format ? c.format(row[c.key], row) : String(row[c.key] ?? ""));
    const heightOf = (cells, font) => {
      doc.font(font).fontSize(8);
      return Math.max(...cells.map((t, i) => doc.heightOfString(t, { width: widths[i] - pad * 2 }))) + pad * 2;
    };
    const draw = (cells, { font = "Helvetica", fill, color = INK, rule } = {}) => {
      const h = heightOf(cells, font);
      const y = doc.y;
      if (fill) doc.rect(L, y, W, h).fill(fill);
      doc.font(font).fontSize(8);
      cells.forEach((t, i) => {
        const tone = typeof color === "function" ? color(i) : color;
        doc.fillColor(tone).text(t, xs[i] + pad, y + pad, { width: widths[i] - pad * 2, align: columns[i].align || "left" });
      });
      if (rule) doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.8).strokeColor(BRAND).stroke();
      doc.x = L;
      doc.y = y + h;
    };
    const header = () => draw(columns.map((c) => c.header), { font: "Helvetica-Bold", fill: HEADER_FILL, color: BRAND_DARK });

    ensure(40);
    header();
    rows.forEach((row, i) => {
      const cells = columns.map((c) => cell(c, row));
      if (doc.y + heightOf(cells, "Helvetica") > bottom()) {
        doc.addPage();
        doc.y = doc.page.margins.top;
        header();
      }
      const color = (j) => (columns[j].tone ? columns[j].tone(row[columns[j].key], row) || INK : INK);
      draw(cells, { fill: i % 2 ? STRIPE : null, color });
    });
    if (totals) {
      const cells = columns.map((c, i) => (i === 0 ? "Total" : totals[c.key] === undefined ? "" : c.format ? c.format(totals[c.key], totals) : String(totals[c.key])));
      ensure(heightOf(cells, "Helvetica-Bold") + 2);
      draw(cells, { font: "Helvetica-Bold", fill: HEADER_FILL, rule: true });
    }
    doc.moveDown(0.8);
  }

  const money = { align: "right", format: rs };
  const signed = { ...money, tone: (v) => (v < 0 ? DANGER : null) };
  const percent = { align: "right", format: pct, flex: 0.7 };
  const count = { align: "right", format: num, flex: 0.6 };
  const k = a.kpis;
  const p = a.previous || {};
  const has = (key) => sections.includes(key);

  // ── Sections ──
  if (has("summary")) {
    heading("Summary", a.previous ? `Compared with the previous period, ${date(a.previousPeriod.from)} - ${date(a.previousPeriod.to)}.` : null);
    cards([
      { label: "Revenue (excl. GST)", value: rs(k.revenue), accent: C_REVENUE, delta: delta(k.revenue, p.revenue) },
      { label: "Expenses", value: rs(k.expenses), accent: C_EXPENSE, delta: delta(k.expenses, p.expenses, { costLike: true }) },
      { label: "Purchases", value: rs(k.purchases), accent: "#64717D", delta: delta(k.purchases, p.purchases, { costLike: true }) },
      { label: k.profit >= 0 ? "Net Profit" : "Net Loss", value: rs(k.profit), accent: C_PROFIT, tone: k.profit < 0 ? DANGER : SUCCESS, delta: delta(k.profit, p.profit) },
      { label: "Net Profit Margin", value: pct(k.netMarginPct), delta: delta(k.netMarginPct, p.netMarginPct, { points: true }) },
      { label: "Gross Profit", value: rs(k.grossProfit), delta: delta(k.grossProfit, p.grossProfit) },
      { label: "Bills", value: num(k.salesCount), delta: delta(k.salesCount, p.salesCount) },
      { label: "Average Bill Value", value: rs(k.avgBillValue), delta: delta(k.avgBillValue, p.avgBillValue) },
    ]);
    if (!a.hasData) para("No sales, purchases or expenses were recorded in this period.");
    const labels = a.trend.map((t) => t.label);
    groupedBars("Revenue vs Expenses", labels, [
      { name: "Revenue", color: C_REVENUE, values: a.trend.map((t) => t.revenue) },
      { name: "Cost of goods + expenses", color: C_EXPENSE, values: a.trend.map((t) => t.cogs + t.expenses + t.writeOff) },
    ]);
    lineChart("Net Profit Trend", labels, [{ name: "Net profit", color: C_PROFIT, values: a.trend.map((t) => t.profit) }]);
    table(
      [
        { header: "Period", key: "label", flex: 1.3 },
        { header: "Revenue", key: "revenue", ...money },
        { header: "COGS", key: "cogs", ...money },
        { header: "Expenses", key: "expenses", ...money },
        { header: "Net Profit", key: "profit", ...signed },
        { header: "Margin", key: "marginPct", ...percent },
        { header: "Growth", key: "growthPct", ...percent, tone: (v) => (v < 0 ? DANGER : v > 0 ? SUCCESS : null) },
      ],
      a.trend,
      { totals: { revenue: k.revenue, cogs: k.cogs, expenses: a.pnl.expenses, profit: k.profit, marginPct: k.netMarginPct } }
    );
  }

  if (has("sales")) {
    heading("Revenue & Sales", "Revenue is net of GST and discounts.");
    table(
      [
        { header: "Payment Mode", key: "mode", flex: 1.2 },
        { header: "Bills", key: "bills", ...count },
        { header: "Revenue", key: "revenue", ...money },
        { header: "GST", key: "gst", ...money },
        { header: "Billed (incl. GST)", key: "collected", ...money },
        { header: "Share", key: "sharePct", ...percent },
      ],
      a.paymentModes,
      { totals: { revenue: sum(a.paymentModes, "revenue"), gst: sum(a.paymentModes, "gst"), collected: sum(a.paymentModes, "collected") } }
    );
    hBars("Category-wise Sales", a.categories.slice(0, 12).map((c) => ({ label: c.category, value: c.revenue })));
    table(
      [
        { header: "Category", key: "category", flex: 1.6 },
        { header: "Revenue", key: "revenue", ...money },
        { header: "Gross Profit", key: "grossProfit", ...signed },
        { header: "Margin", key: "marginPct", ...percent },
        { header: "Share", key: "sharePct", ...percent },
      ],
      a.categories,
      { totals: { revenue: sum(a.categories, "revenue"), grossProfit: sum(a.categories, "grossProfit") } }
    );
    hBars("Top-selling Products", a.products.slice(0, 10).map((x) => ({ label: x.name, value: x.revenue })), C_REVENUE);
  }

  if (has("expenses")) {
    heading(
      "Expenses",
      a.pnl.expenseSharePct !== null && a.pnl.expenseSharePct !== 100
        ? `With filters on, the filtered sales carry ${a.pnl.expenseSharePct}% of shop expenses (their share of revenue): ${rs(a.pnl.expenses)} of ${rs(a.pnl.totalExpenses)}.`
        : null
    );
    table(
      [
        { header: "Category", key: "category", flex: 1.6 },
        { header: "Entries", key: "count", ...count },
        { header: "Amount", key: "amount", ...money },
        { header: "Share", key: "sharePct", ...percent },
      ],
      a.expenseCategories,
      { totals: { count: sum(a.expenseCategories, "count"), amount: a.pnl.totalExpenses } }
    );
  }

  if (has("purchases")) {
    heading("Purchases");
    table(
      [
        { header: "Supplier", key: "name", flex: 2 },
        { header: "Invoices", key: "invoices", ...count },
        { header: "Purchases", key: "purchases", ...money },
        { header: "Input GST", key: "gst", ...money },
        { header: "Outstanding", key: "outstanding", ...money, tone: (v) => (v > 0 ? DANGER : null) },
      ],
      a.suppliers,
      { totals: { invoices: sum(a.suppliers, "invoices"), purchases: sum(a.suppliers, "purchases"), gst: sum(a.suppliers, "gst"), outstanding: sum(a.suppliers, "outstanding") } }
    );
  }

  if (has("products")) {
    heading("Product Performance", "Qty is in packs (loose sales counted as a fraction of a pack).");
    table(
      [
        { header: "Product", key: "name", flex: 2.2 },
        { header: "Brand", key: "brand", flex: 1.2 },
        { header: "Qty", key: "qtyPacks", ...count },
        { header: "Revenue", key: "revenue", ...money },
        { header: "COGS", key: "cogs", ...money },
        { header: "Gross Profit", key: "grossProfit", ...signed },
        { header: "Margin", key: "marginPct", ...percent },
      ],
      a.products,
      { totals: { qtyPacks: sum(a.products, "qtyPacks"), revenue: sum(a.products, "revenue"), cogs: sum(a.products, "cogs"), grossProfit: sum(a.products, "grossProfit") } }
    );
    hBars("Best-performing Brands", a.brands.slice(0, 10).map((b) => ({ label: b.brand, value: b.revenue })));
    table(
      [
        { header: "Brand", key: "brand", flex: 1.8 },
        { header: "Bills", key: "bills", ...count },
        { header: "Revenue", key: "revenue", ...money },
        { header: "Gross Profit", key: "grossProfit", ...signed },
        { header: "Margin", key: "marginPct", ...percent },
        { header: "Share", key: "sharePct", ...percent },
      ],
      a.brands,
      { totals: { revenue: sum(a.brands, "revenue"), grossProfit: sum(a.brands, "grossProfit") } }
    );
  }

  if (has("inventory")) {
    const inv = a.inventory;
    heading("Inventory & Stock", "Current stock on hand (as of now, not limited to the report period).");
    cards([
      { label: "Stock Value (cost)", value: rs(inv.totals.valueCost) },
      { label: "Stock Value (selling)", value: rs(inv.totals.valueMrp) },
      { label: "Expected Profit", value: rs(inv.totals.expectedProfit), tone: SUCCESS },
      { label: "Products", value: num(inv.totals.skuCount) },
      { label: "Low Stock", value: num(inv.totals.lowStockCount), tone: inv.totals.lowStockCount ? "#B86E0E" : INK },
      { label: "Out of Stock", value: num(inv.totals.outOfStockCount), tone: inv.totals.outOfStockCount ? DANGER : INK },
      { label: "Expiring in 90 Days (cost)", value: rs(inv.totals.expiringValue) },
    ]);
    const stockCols = [
      { header: "Product", key: "name", flex: 2.2 },
      { header: "SKU", key: "productCode", flex: 0.9 },
      { header: "On Hand", key: "qtyDisplay", flex: 1.4 },
      { header: "Alert Below", key: "lowStockThreshold", ...count },
      { header: "Supplier", key: "supplier", flex: 1.3 },
    ];
    doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text("Low Stock", L);
    doc.moveDown(0.2);
    table(stockCols, inv.lowStock, { empty: "No products are running low." });
    doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text("Out of Stock", L);
    doc.moveDown(0.2);
    table(stockCols, inv.outOfStock, { empty: "No products are out of stock." });
    doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text("Expiring Batches (next 90 days)", L);
    doc.moveDown(0.2);
    table(
      [
        { header: "Product", key: "name", flex: 2.2 },
        { header: "Batch", key: "batchNo" },
        { header: "Expiry", key: "expiryDate", format: date },
        { header: "Status", key: "status", tone: (v) => (v === "Expired" ? DANGER : null) },
        { header: "Value (cost)", key: "valueCost", ...money },
      ],
      inv.expiring,
      { totals: { valueCost: inv.totals.expiringValue }, empty: "No batches expire in the next 90 days." }
    );
  }

  if (has("parties")) {
    heading("Customers & Suppliers", "Outstanding balances are as of now.");
    table(
      [
        { header: "Customer", key: "name", flex: 2 },
        { header: "Phone", key: "phone" },
        { header: "Bills", key: "bills", ...count },
        { header: "Revenue", key: "revenue", ...money },
        { header: "Receivable", key: "outstanding", ...money, tone: (v) => (v > 0 ? DANGER : null) },
      ],
      a.customers,
      { totals: { bills: sum(a.customers, "bills"), revenue: sum(a.customers, "revenue"), outstanding: a.receivables.total }, empty: "No named-customer sales or receivables." }
    );
    table(
      [
        { header: "Supplier", key: "name", flex: 2 },
        { header: "GSTIN", key: "gstNumber", flex: 1.3 },
        { header: "Purchases", key: "purchases", ...money },
        { header: "Payable", key: "outstanding", ...money, tone: (v) => (v > 0 ? DANGER : null) },
      ],
      a.suppliers,
      { totals: { purchases: sum(a.suppliers, "purchases"), outstanding: a.payables.total }, empty: "No supplier purchases or payables." }
    );
  }

  if (has("gst")) {
    const gstCols = (label) => [
      { header: `${label} - GST Rate`, key: "rate", format: (v) => `${v}%` },
      { header: "Taxable Value", key: "taxable", ...money },
      { header: "CGST", key: "cgst", ...money },
      { header: "SGST", key: "sgst", ...money },
      { header: "Total GST", key: "gst", ...money },
    ];
    heading("GST & Tax", "CGST/SGST shown as an equal split (intra-state supply). Verify against your GST returns before filing.");
    cards([
      { label: "Output GST (sales)", value: rs(a.gst.outputTotal) },
      { label: "Input GST (purchases)", value: rs(a.gst.inputTotal) },
      { label: "Net GST Payable", value: rs(a.gst.netPayable), tone: a.gst.netPayable < 0 ? SUCCESS : INK },
    ], 3);
    const totalsOf = (rows) => ({ taxable: sum(rows, "taxable"), cgst: sum(rows, "cgst"), sgst: sum(rows, "sgst"), gst: sum(rows, "gst") });
    table(gstCols("Output"), a.gst.output, { totals: totalsOf(a.gst.output), empty: "No taxable sales in this period." });
    table(gstCols("Input"), a.gst.input, { totals: totalsOf(a.gst.input), empty: "No purchases in this period." });
  }

  if (has("pnl")) {
    const pl = a.pnl;
    heading("Profit & Loss");
    table(
      [
        { header: "Line", key: "label", flex: 2.5 },
        { header: "Amount", key: "amount", ...signed },
      ],
      [
        { label: "Revenue (net of GST & discounts)", amount: pl.revenue },
        { label: "Less: Cost of goods sold", amount: -pl.cogs },
        { label: "Gross Profit", amount: pl.grossProfit },
        { label: `Less: Expenses${pl.expenseSharePct !== null && pl.expenseSharePct !== 100 ? ` (${pl.expenseSharePct}% share)` : ""}`, amount: -pl.expenses },
        { label: "Less: Expired stock write-off", amount: -pl.expiredWriteOff },
        { label: pl.profit >= 0 ? "Net Profit" : "Net Loss", amount: pl.profit },
        { label: "Add back: Interest, Taxes, Depreciation, Amortization", amount: pl.interest + pl.taxes + pl.depreciation + pl.amortization },
        { label: "EBITDA", amount: pl.ebitda },
      ]
    );
    para(`Gross margin ${pct(pl.grossMarginPct)} · Net margin ${pct(pl.netMarginPct)} · EBITDA margin ${pct(pl.ebitdaMarginPct)} · ROI ${pct(pl.roiPct)} · Inventory turnover ${pl.inventoryTurnover === null ? "-" : `${pl.inventoryTurnover}x`}`);

    heading("Cash Flow", "Shop-wide money in and out during the period. Credit sales and purchases are not cash until paid.");
    table(
      [
        { header: "Mode", key: "mode", flex: 1.4 },
        { header: "Inflow", key: "inflow", ...money },
        { header: "Outflow", key: "outflow", ...money },
        { header: "Net", key: "net", ...signed },
      ],
      a.cashFlow.byMode,
      { totals: { inflow: a.cashFlow.inflow, outflow: a.cashFlow.outflow, net: a.cashFlow.net }, empty: "No money moved in this period." }
    );
    para(`New credit given to customers: ${rs(a.cashFlow.newReceivables)} · New credit taken from suppliers: ${rs(a.cashFlow.newPayables)} · Total receivables now: ${rs(a.receivables.total)} · Total payables now: ${rs(a.payables.total)}`);
  }

  if (has("transactions") && transactions) {
    const shown = transactions.slice(0, TRANSACTION_PDF_LIMIT);
    heading(
      "Transaction History",
      transactions.length > shown.length ? `Showing the latest ${shown.length} of ${transactions.length} transactions - the Excel export has them all.` : `${transactions.length} transactions.`
    );
    table(
      [
        { header: "Date", key: "date", format: date, flex: 0.9 },
        { header: "Type", key: "type", flex: 1 },
        { header: "Reference", key: "ref", flex: 1 },
        { header: "Party", key: "party", flex: 1.4 },
        { header: "Mode", key: "mode", flex: 0.7 },
        { header: "Amount", key: "amount", ...money, tone: (v, r) => (r.direction === "out" ? DANGER : null) },
        { header: "Status", key: "status", flex: 0.6 },
      ],
      shown
    );
  }

  // Footer on every page: shop · report, generated time, page X of Y.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const y = doc.page.height - doc.page.margins.bottom + 6;
    const saved = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.moveTo(L, y - 4).lineTo(L + W, y - 4).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED);
    doc.text(`${shopName} · ${title} · Generated ${generated}`, L, y, { width: W - 80, lineBreak: false, ellipsis: true });
    doc.text(`Page ${i + 1} of ${range.count}`, L, y, { width: W, align: "right", lineBreak: false });
    doc.page.margins.bottom = saved;
  }

  doc.end();
}
