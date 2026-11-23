import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { SHOP } from "./saleHelpers.js";

// PDF + Excel tax invoice for a Sales Entry. Used by the Sales Entry screen
// (download / print) and by the Invoice Saver (reports\sales\...). `label`
// is the invoice number printed on it: "SALES-001", or "SALES-001 (edited 1)"
// for a saver copy made after an edit.

const money = (n) => Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric" }) : "");
const qtyText = (q) => String(Number(q || 0));

const INK = "#1F2A37";
const MUTED = "#5B6675";
const LINE = "#C9D1DB";
const HEAD_BG = "#E6F1EF";

// GST rate-wise totals (the summary every GST invoice carries).
function rateSummary(entry) {
  const map = new Map();
  for (const it of entry.items) {
    const row = map.get(it.gstPercent) || { rate: it.gstPercent, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    row.taxable += it.taxableAmount;
    row.cgst += it.cgst;
    row.sgst += it.sgst;
    row.igst += it.igst;
    map.set(it.gstPercent, row);
  }
  return [...map.values()].sort((a, b) => a.rate - b.rate);
}

function shopLines() {
  return [SHOP.addressLine1, SHOP.addressLine2, [SHOP.phone && `Ph: ${SHOP.phone}`, SHOP.gstin && `GSTIN: ${SHOP.gstin}`, SHOP.dlNo && `DL No: ${SHOP.dlNo}`].filter(Boolean).join("   ")].filter(Boolean);
}

export function salesEntryPdf(entry, label = entry.archiveNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 30, info: { Title: `Tax Invoice ${label}` } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      drawPdf(doc, entry, label);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function drawPdf(doc, entry, label) {
  const L = 30;
  const W = doc.page.width - 60;
  const bottom = doc.page.height - 30;
  const inter = entry.interState;

  // ---- Header ----
  doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(9).text("TAX INVOICE", L, 30, { width: W, align: "center", characterSpacing: 2 });
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(18).text(SHOP.name, L, 44, { width: W, align: "center" });
  doc.font("Helvetica").fontSize(8.5).fillColor(MUTED);
  for (const line of shopLines()) doc.text(line, { width: W, align: "center" });
  let y = doc.y + 8;
  doc.moveTo(L, y).lineTo(L + W, y).lineWidth(1).strokeColor(INK).stroke();
  y += 8;

  // ---- Bill to / invoice details ----
  const half = W / 2;
  const c = entry.customer || {};
  const top = y;
  doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(8).text("BILL TO", L, y);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(10.5).text(c.name || "Cash Customer", L, doc.y + 2, { width: half - 12 });
  doc.font("Helvetica").fontSize(8.5);
  if (c.address) doc.text(c.address, { width: half - 12 });
  if (c.mobile) doc.text(`Mobile: ${c.mobile}`, { width: half - 12 });
  doc.text(`GSTIN: ${c.gstin || "Unregistered"}`, { width: half - 12 });
  const leftEnd = doc.y;

  const details = [
    ["Invoice No", label],
    ["Invoice Date", day(entry.invoiceDate)],
    ["Payment Mode", entry.paymentMode],
    ["Supply", inter ? "Inter-state (IGST)" : "Intra-state (CGST + SGST)"],
  ];
  let ry = top;
  for (const [k, v] of details) {
    doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text(k, L + half + 10, ry, { width: 80 });
    doc.fillColor(INK).font("Helvetica-Bold").text(String(v ?? ""), L + half + 90, ry, { width: half - 90 });
    ry = doc.y + 3;
  }
  y = Math.max(leftEnd, ry) + 10;

  // ---- Items table ----
  const cols = [
    { key: "sn", head: "#", w: 18, align: "center" },
    { key: "name", head: "Item", w: inter ? 150 : 112, align: "left" },
    { key: "hsn", head: "HSN", w: 42, align: "left" },
    { key: "qty", head: "Qty", w: 32, align: "right" },
    { key: "unit", head: "Unit", w: 32, align: "left" },
    { key: "rate", head: "Rate", w: 50, align: "right" },
    { key: "disc", head: "Disc%", w: 30, align: "right" },
    { key: "taxable", head: "Taxable", w: 56, align: "right" },
    { key: "gst", head: "GST%", w: 29, align: "right" },
    ...(inter
      ? [{ key: "igst", head: "IGST", w: 52, align: "right" }]
      : [
          { key: "cgst", head: "CGST", w: 45, align: "right" },
          { key: "sgst", head: "SGST", w: 45, align: "right" },
        ]),
  ];
  const used = cols.reduce((s, col) => s + col.w, 0);
  cols.push({ key: "total", head: "Amount", w: W - used, align: "right" });
  const pad = 3;

  const drawRow = (cells, { head = false, bold = false } = {}) => {
    doc.font(head || bold ? "Helvetica-Bold" : "Helvetica").fontSize(8);
    const h = Math.max(...cols.map((col) => doc.heightOfString(String(cells[col.key] ?? ""), { width: col.w - pad * 2 }))) + pad * 2;
    if (y + h > bottom - 40) {
      doc.addPage();
      y = 30;
      if (!head) drawRow(Object.fromEntries(cols.map((col) => [col.key, col.head])), { head: true });
    }
    if (head) doc.rect(L, y, W, h).fill(HEAD_BG);
    let x = L;
    doc.fillColor(INK).font(head || bold ? "Helvetica-Bold" : "Helvetica").fontSize(8);
    for (const col of cols) {
      doc.text(String(cells[col.key] ?? ""), x + pad, y + pad, { width: col.w - pad * 2, align: col.align });
      x += col.w;
    }
    y += h;
    doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.5).strokeColor(LINE).stroke();
  };

  doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.5).strokeColor(LINE).stroke();
  drawRow(Object.fromEntries(cols.map((col) => [col.key, col.head])), { head: true });
  entry.items.forEach((it, i) =>
    drawRow({
      sn: i + 1,
      name: it.name,
      hsn: it.hsnCode,
      qty: qtyText(it.qty),
      unit: it.unit,
      rate: money(it.rate),
      disc: it.discountPercent ? String(it.discountPercent) : "-",
      taxable: money(it.taxableAmount),
      gst: String(it.gstPercent),
      cgst: money(it.cgst),
      sgst: money(it.sgst),
      igst: money(it.igst),
      total: money(it.total),
    })
  );
  drawRow(
    {
      name: "Total",
      taxable: money(entry.taxableTotal),
      cgst: money(entry.cgstTotal),
      sgst: money(entry.sgstTotal),
      igst: money(entry.igstTotal),
      total: money(entry.taxableTotal + entry.cgstTotal + entry.sgstTotal + entry.igstTotal),
    },
    { bold: true }
  );

  // ---- GST summary (left) + totals (right) ----
  const summary = rateSummary(entry);
  const blockH = Math.max(14 * (summary.length + 2) + 30, 14 * 8 + 10);
  if (y + blockH + 90 > bottom) {
    doc.addPage();
    y = 30;
  }
  y += 10;
  const blockTop = y;

  const sCols = inter ? [["GST %", 40], ["Taxable", 70], ["IGST", 70]] : [["GST %", 40], ["Taxable", 64], ["CGST", 56], ["SGST", 56]];
  doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(8).text("GST SUMMARY", L, y);
  y = doc.y + 3;
  const sRow = (cells, bold) => {
    let x = L;
    doc.fillColor(INK).font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8);
    cells.forEach((cell, i) => {
      doc.text(cell, x, y, { width: sCols[i][1] - 4, align: i === 0 ? "left" : "right" });
      x += sCols[i][1];
    });
    y += 12;
  };
  sRow(sCols.map((s) => s[0]), true);
  for (const r of summary) sRow(inter ? [`${r.rate}%`, money(r.taxable), money(r.igst)] : [`${r.rate}%`, money(r.taxable), money(r.cgst), money(r.sgst)]);

  const totals = [
    ["Sub Total (Qty x Rate)", entry.subtotal],
    ["Less: Discount", entry.discountTotal],
    ["Taxable Amount", entry.taxableTotal],
    ...(inter
      ? [["IGST", entry.igstTotal]]
      : [
          ["CGST", entry.cgstTotal],
          ["SGST", entry.sgstTotal],
        ]),
    ["Round Off", entry.roundOff],
  ];
  const tx = L + W - 220;
  let ty = blockTop;
  for (const [k, v] of totals) {
    doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(k, tx, ty, { width: 130 });
    doc.fillColor(INK).text(money(v), tx + 130, ty, { width: 90, align: "right" });
    ty += 14;
  }
  doc.rect(tx - 6, ty, 226, 22).fill(HEAD_BG);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(11).text("GRAND TOTAL", tx, ty + 6, { width: 120 });
  doc.text(`Rs. ${money(entry.grandTotal)}`, tx + 100, ty + 6, { width: 120, align: "right" });
  ty += 30;

  y = Math.max(y, ty) + 6;
  doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(8).text("AMOUNT IN WORDS", L, y);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(9.5).text(entry.amountInWords, L, doc.y + 2, { width: W });
  y = doc.y + 6;
  if (entry.notes) {
    doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text(`Notes: ${entry.notes}`, L, y, { width: W });
    y = doc.y + 6;
  }
  if (entry.editedAt) {
    doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(8).text(`Edited on ${day(entry.editedAt)}`, L, y);
    y = doc.y + 4;
  }

  // ---- Signature ----
  y = Math.max(y + 24, doc.y + 24);
  if (y + 40 > bottom) {
    doc.addPage();
    y = 60;
  }
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(9).text(`For ${SHOP.name}`, L + W - 200, y, { width: 200, align: "right" });
  doc.font("Helvetica").fontSize(8).fillColor(MUTED).text("Authorised Signatory", L + W - 200, y + 32, { width: 200, align: "right" });
  doc.text("This is a computer generated invoice.", L, y + 32, { width: 250 });
}

export async function salesEntryXlsx(entry, label = entry.archiveNo) {
  const inter = entry.interState;
  const wb = new ExcelJS.Workbook();
  wb.creator = SHOP.name;
  const ws = wb.addWorksheet(label.replace(/[\\/?*[\]:]/g, "").slice(0, 31) || "Invoice");
  const c = entry.customer || {};

  ws.addRow([`${SHOP.name} - Tax Invoice`]).font = { bold: true, size: 14 };
  for (const line of shopLines()) ws.addRow([line]);
  ws.addRow([]);
  const info = [
    ["Invoice No", label],
    ["Invoice Date", day(entry.invoiceDate)],
    ["Customer Name", c.name || "Cash Customer"],
    ["Customer Address", c.address || ""],
    ["Customer GSTIN", c.gstin || "Unregistered"],
    ["Mobile", c.mobile || ""],
    ["Payment Mode", entry.paymentMode],
    ["Supply", inter ? "Inter-state (IGST)" : "Intra-state (CGST + SGST)"],
  ];
  for (const [k, v] of info) {
    const r = ws.addRow([k, v]);
    r.getCell(1).font = { bold: true };
  }
  ws.addRow([]);

  const cols = [
    ["#", 5, (it, i) => i + 1],
    ["Item", 34, (it) => it.name],
    ["HSN", 11, (it) => it.hsnCode || ""],
    ["Qty", 8, (it) => it.qty],
    ["Unit", 9, (it) => it.unit],
    ["Rate", 11, (it) => it.rate],
    ["Amount", 12, (it) => it.amount],
    ["Disc %", 8, (it) => it.discountPercent],
    ["Discount", 11, (it) => it.discountAmount],
    ["Taxable", 12, (it) => it.taxableAmount],
    ["GST %", 8, (it) => it.gstPercent],
    ["CGST", 11, (it) => it.cgst],
    ["SGST", 11, (it) => it.sgst],
    ["IGST", 11, (it) => it.igst],
    ["Total", 13, (it) => it.total],
  ];
  const head = ws.addRow(cols.map((col) => col[0]));
  head.font = { bold: true };
  head.eachCell((cell) => (cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F1EF" } }));
  entry.items.forEach((it, i) => ws.addRow(cols.map((col) => col[2](it, i))));
  cols.forEach((col, i) => {
    ws.getColumn(i + 1).width = col[1];
    if (i >= 5 && col[0] !== "GST %" && col[0] !== "Disc %") ws.getColumn(i + 1).numFmt = "#,##0.00";
  });
  ws.addRow([]);

  const totals = [
    ["Sub Total", entry.subtotal],
    ["Discount", entry.discountTotal],
    ["Taxable Amount", entry.taxableTotal],
    ["CGST", entry.cgstTotal],
    ["SGST", entry.sgstTotal],
    ["IGST", entry.igstTotal],
    ["Round Off", entry.roundOff],
    ["Grand Total", entry.grandTotal],
  ];
  const last = cols.length;
  for (const [k, v] of totals) {
    const r = ws.addRow([...Array(last - 2).fill(""), k, v]);
    r.getCell(last - 1).font = { bold: true };
    r.getCell(last).numFmt = "#,##0.00";
    if (k === "Grand Total") r.font = { bold: true, size: 12 };
  }
  ws.addRow([]);
  const words = ws.addRow(["Amount in words", entry.amountInWords]);
  words.getCell(1).font = { bold: true };
  if (entry.notes) ws.addRow(["Notes", entry.notes]).getCell(1).font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
