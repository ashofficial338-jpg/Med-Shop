import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";

const INK = "#133331";
const MUTED = "#5B7A77";
const RULE = "#c3c2b7";
const HEADER_FILL = "#e8efee";
const STRIPE_FILL = "#f6f8f8";

// Reports are for an Indian shop, but the server runs in UTC on the host.
const TIME_ZONE = "Asia/Kolkata";

export function todayStamp() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TIME_ZONE }); // YYYY-MM-DD
}

// "2026-09-26 22:25" in shop time, for timestamp columns.
export function formatDateTime(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function generatedAtLabel() {
  return new Date().toLocaleString("en-IN", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// "From 01 Sep 2026 to 26 Sep 2026" / "Up to ..." / "All dates", for subtitles.
export function periodLabel(from, to) {
  const fmt = (d) =>
    new Date(d).toLocaleDateString("en-IN", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });
  if (from && to) return `From ${fmt(from)} to ${fmt(to)}`;
  if (from) return `From ${fmt(from)}`;
  if (to) return `Up to ${fmt(to)}`;
  return "All dates";
}

// Report names can contain vendor/customer names, so the header carries an
// ASCII-safe fallback plus the exact UTF-8 name (RFC 6266), and every file
// gets the export date: ReportName_2026-09-26.pdf.
function setDownloadHeaders(res, contentType, filename) {
  const dot = filename.lastIndexOf(".");
  const dated = `${filename.slice(0, dot)}_${todayStamp()}${filename.slice(dot)}`;
  const ascii = dated.replace(/[^\w.-]+/g, "_");
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(dated)}`);
}

// Generic multi-sheet Excel writer - sheets: [{ name, columns: [{header,key,width}], rows }].
// Uses ExcelJS's streaming writer, so rows are flushed to the response as
// they're written instead of the whole workbook being built in memory first.
export async function streamExcelReport(res, filename, sheets) {
  setDownloadHeaders(res, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename);

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true });
  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = sheet.columns;

    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: "FF133331" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EFEE" } };
    header.commit();
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };

    for (const row of sheet.rows) ws.addRow(row).commit();
    ws.commit();
  }
  await workbook.commit();
}

// Generic single-table PDF: title, subtitle (report period / filters),
// optional summary lines, then a table whose rows grow to fit wrapped text
// and whose header repeats on every page. Each page gets a
// "Generated on ... · Page X of Y" footer. Columns may set `flex` (default 1)
// to take a larger share of the width; `showCount: false` hides the record
// count for key/value summaries.
export function streamPdfReport(res, filename, { title, subtitle, columns, rows, summaryLines, showCount = true }) {
  setDownloadHeaders(res, "application/pdf", filename);

  const doc = new PDFDocument({
    size: "A4",
    margin: 36,
    layout: columns.length > 6 ? "landscape" : "portrait",
    bufferPages: true, // needed to write "Page X of Y" once the total is known
  });
  doc.pipe(res);

  const startX = doc.page.margins.left;
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const footerSpace = 24;
  const bottomLimit = doc.page.height - doc.page.margins.bottom - footerSpace;
  const pad = 4;

  const totalFlex = columns.reduce((sum, c) => sum + (c.flex || 1), 0);
  const widths = columns.map((c) => (usableWidth * (c.flex || 1)) / totalFlex);
  const xs = widths.map((_, i) => startX + widths.slice(0, i).reduce((a, b) => a + b, 0));

  doc.font("Helvetica-Bold").fontSize(16).fillColor(INK).text(title);
  if (subtitle) doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(subtitle);
  if (showCount) {
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(`${rows.length} record${rows.length === 1 ? "" : "s"}`);
  }
  doc.moveDown(0.6);

  if (summaryLines?.length) {
    doc.font("Helvetica").fontSize(10).fillColor(INK);
    summaryLines.forEach((line) => doc.text(line));
    doc.moveDown(0.6);
  }

  function rowHeight(cells, font) {
    doc.font(font).fontSize(9);
    return Math.max(...cells.map((text, i) => doc.heightOfString(text, { width: widths[i] - pad * 2 }))) + pad * 2;
  }

  function drawRow(cells, { font, fill }) {
    const height = rowHeight(cells, font);
    const y = doc.y;
    if (fill) doc.rect(startX, y, usableWidth, height).fill(fill);
    doc.font(font).fontSize(9).fillColor(INK);
    cells.forEach((text, i) => {
      doc.text(text, xs[i] + pad, y + pad, { width: widths[i] - pad * 2, align: columns[i].align || "left" });
    });
    doc.x = startX;
    doc.y = y + height;
  }

  function drawHeader() {
    drawRow(columns.map((c) => c.header), { font: "Helvetica-Bold", fill: HEADER_FILL });
    doc.moveTo(startX, doc.y).lineTo(startX + usableWidth, doc.y).strokeColor(RULE).lineWidth(0.75).stroke();
  }

  if (rows.length === 0) {
    doc.font("Helvetica").fontSize(10).fillColor(MUTED).text("No records found for the selected filters.");
  } else {
    drawHeader();
    rows.forEach((row, index) => {
      const cells = columns.map((c) => String(row[c.key] ?? ""));
      if (doc.y + rowHeight(cells, "Helvetica") > bottomLimit) {
        doc.addPage();
        drawHeader();
      }
      drawRow(cells, { font: "Helvetica", fill: index % 2 ? STRIPE_FILL : null });
    });
  }

  const generated = `Generated on ${generatedAtLabel()}`;
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const y = doc.page.height - doc.page.margins.bottom - 12;
    // Writing below the bottom margin would make pdfkit add a page, so the
    // margin is lifted just for the footer.
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(8).fillColor(MUTED);
    doc.text(generated, startX, y, { width: usableWidth, align: "left", lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, startX, y, { width: usableWidth, align: "right", lineBreak: false });
    doc.page.margins.bottom = savedBottom;
  }

  doc.end();
}
