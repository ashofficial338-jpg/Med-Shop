import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import { useUnicodeFonts } from "./pdfFonts.js";
import { SHOP, numberToWordsIndian } from "./saleHelpers.js";

// One A4 layout for the three purchase documents - Purchase Order, Purchase
// Invoice and Purchase Return. The app shows this same PDF as the preview, so
// what is printed or downloaded is exactly what was on screen.

const LOGO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "logo.png");
const INK = "#133331";
const MUTED = "#5B7A77";
const RULE = "#c3c2b7";
const BRAND = "#0F4C81";
const HEAD_FILL = "#e8efee";
const STRIPE = "#f6f8f8";

const inr = (v) => Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : "");
const r2 = (n) => Number(Number(n || 0).toFixed(2));

/**
 * doc: {
 *   title: "PURCHASE ORDER", number, date, status,
 *   meta: [[label, value], ...]            // right-hand reference box
 *   supplier: { name, contactPerson, address, phone, email, gstNumber },
 *   columns: "order" | "invoice" | "return",
 *   items: [{ name, code, hsn, batchNo, expiry, qty, unit, rate, discountPercent, taxable, gstPercent, gst, amount }],
 *   totals: { gross, discount, taxable, gst, total },
 *   notes, footerNote, watermark
 * }
 */
export function streamPurchaseDocPdf(res, filename, d, { download = false } = {}) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${filename.replace(/[^\w.-]+/g, "_")}"`);
  res.setHeader("Cache-Control", "no-store");
  const doc = useUnicodeFonts(new PDFDocument({ size: "A4", margin: 36, bufferPages: true, info: { Title: `${d.title} ${d.number}` } }));
  doc.pipe(res);
  render(doc, d);
  doc.end();
}

function render(doc, d) {
  const L = doc.page.margins.left;
  const W = doc.page.width - L - doc.page.margins.right;
  const R = L + W;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 28;

  // ---- Header: logo + shop on the left, document title on the right.
  const top = doc.page.margins.top;
  let textX = L;
  if (fs.existsSync(LOGO)) {
    doc.image(LOGO, L, top, { width: 46, height: 46 });
    textX = L + 56;
  }
  doc.font("Helvetica-Bold").fontSize(17).fillColor(BRAND).text(SHOP.name, textX, top, { width: W * 0.55 });
  doc.font("Helvetica").fontSize(8.5).fillColor(MUTED);
  const shopLines = [SHOP.addressLine1, SHOP.addressLine2, SHOP.phone && `Phone: ${SHOP.phone}`, SHOP.gstin && `GSTIN: ${SHOP.gstin}`, SHOP.dlNo && `D.L. No: ${SHOP.dlNo}`].filter(Boolean);
  for (const line of shopLines.length ? shopLines : ["Pharmacy & Healthcare"]) doc.text(line, textX, doc.y, { width: W * 0.55 });
  const headerLeftBottom = Math.max(doc.y, top + 48);

  doc.font("Helvetica-Bold").fontSize(16).fillColor(INK).text(d.title, L, top, { width: W, align: "right" });
  doc.font("Helvetica-Bold").fontSize(10).fillColor(BRAND).text(d.number, L, doc.y + 2, { width: W, align: "right" });
  doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(`Date: ${dmy(d.date)}`, L, doc.y + 1, { width: W, align: "right" });
  if (d.status) {
    const label = d.status.toUpperCase();
    doc.font("Helvetica-Bold").fontSize(8);
    const w = doc.widthOfString(label) + 12;
    const y = doc.y + 3;
    const cancelled = /cancel/i.test(d.status);
    doc.roundedRect(R - w, y, w, 14, 7).fill(cancelled ? "#fde8e8" : "#e6f4ee");
    doc.fillColor(cancelled ? "#b42318" : "#16794c").text(label, R - w, y + 3.5, { width: w, align: "center" });
    doc.y = y + 16;
  }
  let y = Math.max(headerLeftBottom, doc.y) + 8;
  doc.moveTo(L, y).lineTo(R, y).lineWidth(1.5).strokeColor(BRAND).stroke();
  y += 10;

  // ---- Supplier (left) and references (right).
  const boxW = (W - 12) / 2;
  const s = d.supplier || {};
  const supplierLines = [s.contactPerson && `Attn: ${s.contactPerson}`, s.address, s.phone && `Phone: ${s.phone}`, s.email, s.gstNumber && `GSTIN: ${s.gstNumber}`].filter(Boolean);
  const boxTop = y;
  doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED).text(d.supplierLabel || "SUPPLIER", L + 8, y + 7);
  doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(s.name || "No supplier", L + 8, doc.y + 2, { width: boxW - 16 });
  doc.font("Helvetica").fontSize(8.5).fillColor(INK);
  for (const line of supplierLines) doc.text(line, L + 8, doc.y + 1, { width: boxW - 16 });
  const leftEnd = doc.y + 8;

  const mx = L + boxW + 12;
  doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED).text("DETAILS", mx + 8, y + 7);
  let my = doc.y + 3;
  for (const [label, value] of d.meta || []) {
    if (!value) continue;
    doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(label, mx + 8, my, { width: 90 });
    doc.font("Helvetica-Bold").fillColor(INK).text(String(value), mx + 100, my, { width: boxW - 108 });
    my = Math.max(doc.y, my + 11) + 2;
  }
  const boxBottom = Math.max(leftEnd, my + 6);
  doc.lineWidth(0.7).strokeColor(RULE);
  doc.roundedRect(L, boxTop, boxW, boxBottom - boxTop, 4).stroke();
  doc.roundedRect(mx, boxTop, boxW, boxBottom - boxTop, 4).stroke();
  y = boxBottom + 12;

  // ---- Items table.
  const cols = columnsFor(d.columns);
  const totalFlex = cols.reduce((a, c) => a + c.flex, 0);
  const widths = cols.map((c) => (W * c.flex) / totalFlex);
  const xs = widths.map((_, i) => L + widths.slice(0, i).reduce((a, b) => a + b, 0));
  const pad = 3.5;

  const header = () => {
    doc.font("Helvetica-Bold").fontSize(7.8);
    const h = Math.max(...cols.map((c, i) => doc.heightOfString(c.header, { width: widths[i] - pad * 2 }))) + pad * 2;
    doc.rect(L, y, W, h).fill(HEAD_FILL);
    doc.fillColor(INK);
    cols.forEach((c, i) => doc.text(c.header, xs[i] + pad, y + pad, { width: widths[i] - pad * 2, align: c.align || "left" }));
    y += h;
  };
  header();
  d.items.forEach((item, idx) => {
    const cells = cols.map((c) => c.value(item, idx));
    doc.font("Helvetica").fontSize(8.2);
    const h = Math.max(...cells.map((v, i) => doc.heightOfString(v, { width: widths[i] - pad * 2 }))) + pad * 2;
    if (y + h > bottom()) {
      doc.addPage();
      y = doc.page.margins.top;
      header();
    }
    if (idx % 2 === 1) doc.rect(L, y, W, h).fill(STRIPE);
    doc.font("Helvetica").fontSize(8.2).fillColor(INK);
    cells.forEach((v, i) => doc.text(v, xs[i] + pad, y + pad, { width: widths[i] - pad * 2, align: cols[i].align || "left" }));
    y += h;
    doc.moveTo(L, y).lineTo(R, y).lineWidth(0.4).strokeColor(RULE).stroke();
  });

  // ---- Totals (right) and amount in words + notes (left).
  const t = d.totals;
  const rows = [
    t.discount > 0 && ["Gross Amount", inr(t.gross)],
    t.discount > 0 && ["Discount", `- ${inr(t.discount)}`],
    ["Taxable Amount", inr(t.taxable)],
    ["CGST", inr(r2(t.gst / 2))],
    ["SGST", inr(r2(t.gst - r2(t.gst / 2)))],
  ].filter(Boolean);
  const blockH = rows.length * 14 + 30;
  if (y + blockH + 70 > bottom()) {
    doc.addPage();
    y = doc.page.margins.top;
  }
  y += 10;
  const tw = 210;
  const tx = R - tw;
  let ty = y;
  doc.font("Helvetica").fontSize(9);
  for (const [label, value] of rows) {
    doc.fillColor(MUTED).text(label, tx, ty, { width: 110 });
    doc.fillColor(INK).text(`Rs. ${value}`, tx + 100, ty, { width: tw - 100, align: "right" });
    ty += 14;
  }
  doc.rect(tx, ty + 2, tw, 22).fill(BRAND);
  doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#ffffff").text(d.totalLabel || "Grand Total", tx + 8, ty + 8, { width: 110 });
  doc.text(`Rs. ${inr(t.total)}`, tx + 100, ty + 8, { width: tw - 108, align: "right" });
  ty += 30;

  const lw = W - tw - 16;
  doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED).text("AMOUNT IN WORDS", L, y);
  doc.font("Helvetica").fontSize(8.8).fillColor(INK).text(`Rupees ${numberToWordsIndian(t.total) || "Zero"} Only`, L, doc.y + 2, { width: lw });
  if (d.notes) {
    doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED).text(d.notesLabel || "NOTES", L, doc.y + 8);
    doc.font("Helvetica").fontSize(8.5).fillColor(INK).text(d.notes, L, doc.y + 2, { width: lw });
  }
  y = Math.max(ty, doc.y) + 34;

  // ---- Signatures.
  if (y + 40 > bottom()) {
    doc.addPage();
    y = doc.page.margins.top + 30;
  }
  doc.moveTo(L, y).lineTo(L + 150, y).moveTo(R - 150, y).lineTo(R, y).lineWidth(0.6).strokeColor(INK).stroke();
  doc.font("Helvetica").fontSize(8.5).fillColor(MUTED);
  doc.text(d.leftSignature || "Prepared by", L, y + 4, { width: 150 });
  doc.text(`For ${SHOP.name}`, R - 150, y + 4, { width: 150, align: "right" });
  doc.text("Authorised Signatory", R - 150, doc.y + 1, { width: 150, align: "right" });

  // ---- Footer on every page.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const fy = doc.page.height - doc.page.margins.bottom - 12;
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED);
    doc.text(d.footerNote || "This is a computer-generated document.", L, fy, { width: W * 0.7, lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, L, fy, { width: W, align: "right", lineBreak: false });
  }
}

function columnsFor(kind) {
  const n = (v, dp = 2) => (v === null || v === undefined || v === "" ? "" : inr(Number(v).toFixed(dp)));
  const item = (it) => [it.name, it.code && `Code: ${it.code}`, (it.batchNo || it.expiry) && [it.batchNo && `Batch: ${it.batchNo}`, it.expiry && `Exp: ${it.expiry}`].filter(Boolean).join("  ")].filter(Boolean).join("\n");
  const base = [
    { header: "#", flex: 0.35, value: (_, i) => String(i + 1) },
    { header: "Item Description", flex: 3.2, value: item },
    { header: "HSN", flex: 0.8, value: (it) => it.hsn || "" },
    { header: kind === "return" ? "Return Qty" : kind === "invoice" ? "Recd Qty" : "Qty", flex: 0.8, align: "right", value: (it) => `${it.qty}${it.unit ? ` ${it.unit}` : ""}` },
    { header: "Rate", flex: 0.95, align: "right", value: (it) => n(it.rate) },
  ];
  const disc = { header: "Disc %", flex: 0.65, align: "right", value: (it) => (it.discountPercent ? `${it.discountPercent}` : "-") };
  const rest = [
    { header: "Taxable", flex: 1.05, align: "right", value: (it) => n(it.taxable) },
    { header: "GST %", flex: 0.6, align: "right", value: (it) => `${it.gstPercent || 0}` },
    { header: "GST Amt", flex: 0.95, align: "right", value: (it) => n(it.gst) },
    { header: "Amount", flex: 1.1, align: "right", value: (it) => n(it.amount) },
  ];
  return kind === "return" ? [...base, ...rest] : [...base, disc, ...rest];
}

export const pdfDay = dmy;
