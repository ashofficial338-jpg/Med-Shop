import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import Sale from "../models/Sale.js";
import Purchase from "../models/Purchase.js";
import { nextSequence } from "../models/Counter.js";
import { buildBillText, SHOP } from "./saleHelpers.js";

// Invoice archive: every sale and purchase gets a PDF and an Excel copy that
// tools/invoice-saver (running on the shop PC) saves to
//   reports/sales/<Year>/<Month>/<DD-MM-YYYY>/SALES-001.pdf|.xlsx
//   reports/purchase/<Year>/<Month>/<DD-MM-YYYY>/PUR-001.pdf|.xlsx
// The backend runs in the cloud and can't write to that PC, so it only
// numbers the invoices and builds the files; the saver writes them.
//
// archiveNo is separate from the bill number (GM-000123) and the supplier's
// invoice number, which stay exactly as they are. It's given out in the order
// invoices were created, by one server-side counter per kind, so numbering is
// continuous and never reused, whichever PC does the saving.

export const KINDS = {
  sales: { model: Sale, prefix: "SALES", counter: "archiveSalesNo" },
  purchase: { model: Purchase, prefix: "PUR", counter: "archivePurchaseNo" },
};

const formatArchiveNo = (prefix, seq) => `${prefix}-${String(seq).padStart(3, "0")}`;

// Only one numbering pass at a time in this process, so two saver polls
// arriving together can't both number the same invoices (which would leave a
// gap in the sequence when one of them loses the race).
let numbering = Promise.resolve();

// Numbers up to `limit` not-yet-saved invoices of this kind (oldest first)
// and returns the not-yet-saved list, oldest first.
export function pendingInvoices(kind, limit) {
  const run = numbering.then(() => numberAndList(kind, limit));
  numbering = run.catch(() => {});
  return run;
}

async function numberAndList(kind, limit) {
  const { model, prefix, counter } = KINDS[kind];
  const pending = await model
    .find({ archivedAt: null }, "archiveNo createdAt")
    .sort({ createdAt: 1, _id: 1 })
    .limit(limit);
  for (const doc of pending) {
    if (doc.archiveNo) continue;
    const archiveNo = formatArchiveNo(prefix, await nextSequence(counter));
    await model.updateOne({ _id: doc._id, archiveNo: { $exists: false } }, { $set: { archiveNo } });
    doc.archiveNo = archiveNo;
  }
  return pending.map((d) => ({ id: String(d._id), archiveNo: d.archiveNo, createdAt: d.createdAt }));
}

export function loadInvoice(kind, id) {
  if (kind === "sales") {
    return Sale.findById(id).populate("customer", "name phone").populate("createdBy", "username");
  }
  return Purchase.findById(id).populate("vendor", "name").populate("items.product", "name productCode packUnit");
}

function pdfToBuffer(write) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 30 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    write(doc);
    doc.end();
  });
}

const money = (n) => Number(n || 0).toFixed(2);
const day = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) : "");
const purchaseSupplier = (p) => p.vendor?.name || p.supplierName || "Direct purchase";
const productName = (item) => item.product?.name || "(deleted product)";

// ---- PDF ----

export function invoicePdf(kind, invoice) {
  return pdfToBuffer((doc) => {
    doc.font("Courier-Bold").fontSize(10).fillColor("#133331");
    if (kind === "sales") {
      doc.text(`Invoice No: ${invoice.archiveNo}`, { lineGap: 2 });
      doc.font("Courier").fontSize(8);
      doc.text(buildBillText(invoice), { lineGap: 1 });
      return;
    }
    doc.text(`${SHOP.name} - Purchase Invoice`, { align: "center" });
    doc.moveDown(0.5);
    doc.font("Courier").fontSize(9);
    const rows = [
      ["Invoice No", invoice.archiveNo],
      ["Supplier", purchaseSupplier(invoice)],
      ["Supplier Inv No", invoice.invoiceNo],
      ["Bill Date", day(invoice.date)],
      ["Entered On", day(invoice.createdAt)],
      ["Payment Mode", invoice.paymentMode],
    ];
    for (const [k, v] of rows) doc.text(`${k.padEnd(16)}: ${v ?? ""}`);
    doc.moveDown(0.5);
    const line = "-".repeat(98);
    const row = (cells) =>
      [cells[0].padEnd(34).slice(0, 34), cells[1].padEnd(12).slice(0, 12), cells[2].padEnd(11), cells[3].padStart(6), cells[4].padStart(10), cells[5].padStart(10), cells[6].padStart(12)].join(" ");
    doc.fontSize(8).text(line);
    doc.text(row(["Product", "Batch", "Expiry", "Qty", "Rate", "GST", "Amount"]));
    doc.text(line);
    for (const it of invoice.items) {
      doc.text(
        row([
          productName(it),
          it.batchNo || "-",
          it.expiryDate ? day(it.expiryDate) : "-",
          String(it.qtyPacks),
          money(it.costPrice),
          money(it.lineGst),
          money(it.lineAmount + it.lineGst),
        ])
      );
    }
    doc.text(line);
    const totals = [
      ["Subtotal", invoice.subtotal],
      ["GST", invoice.gstAmount],
      ...(invoice.tdsAmount ? [["TDS", invoice.tdsAmount]] : []),
      ["TOTAL", invoice.total],
      ["Paid", invoice.amountPaid ?? invoice.total],
      ["Balance Due", invoice.total - (invoice.amountPaid ?? invoice.total)],
    ];
    for (const [k, v] of totals) doc.text(`${k}: ${money(v)}`.padStart(98));
  });
}

// ---- Excel ----

export async function invoiceXlsx(kind, invoice) {
  const wb = new ExcelJS.Workbook();
  wb.creator = SHOP.name;
  const ws = wb.addWorksheet(invoice.archiveNo);
  const header = (rows) => {
    ws.addRow([`${SHOP.name} - ${kind === "sales" ? "Sales" : "Purchase"} Invoice`]).font = { bold: true, size: 14 };
    for (const [k, v] of rows) {
      const r = ws.addRow([k, v ?? ""]);
      r.getCell(1).font = { bold: true };
    }
    ws.addRow([]);
  };
  const table = (cols, items) => {
    const head = ws.addRow(cols.map((c) => c.header));
    head.font = { bold: true };
    head.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F1EF" } }));
    for (const it of items) ws.addRow(cols.map((c) => c.value(it)));
    ws.addRow([]);
    cols.forEach((c, i) => (ws.getColumn(i + 1).width = c.width));
  };
  const totals = (rows) => {
    for (const [k, v] of rows) {
      const r = ws.addRow(["", "", "", "", "", k, Number(Number(v || 0).toFixed(2))]);
      r.getCell(6).font = { bold: true };
      r.getCell(7).numFmt = "0.00";
    }
  };

  if (kind === "sales") {
    const paid = invoice.amountPaid ?? invoice.total;
    header([
      ["Invoice No", invoice.archiveNo],
      ["Bill No", invoice.billNo],
      ["Date", day(invoice.createdAt)],
      ["Customer", invoice.customer?.name || "Walk-in"],
      ["Phone", invoice.customer?.phone || ""],
      ["Payment Mode", invoice.paymentMode],
      ["Status", invoice.paymentStatus === "void" ? `VOID${invoice.voidReason ? ` - ${invoice.voidReason}` : ""}` : "Completed"],
      ["Billed By", invoice.createdBy?.username || ""],
    ]);
    table(
      [
        { header: "Item", width: 34, value: (i) => i.name },
        { header: "HSN", width: 12, value: (i) => i.hsnCode || "" },
        { header: "Qty", width: 8, value: (i) => i.qty },
        { header: "Unit", width: 10, value: (i) => i.unitLabel },
        { header: "Rate", width: 12, value: (i) => i.rate },
        { header: "GST %", width: 12, value: (i) => i.gstPercent },
        { header: "Amount", width: 14, value: (i) => Number((i.amount + i.gstAmount).toFixed(2)) },
      ],
      invoice.items
    );
    totals([
      ["Subtotal", invoice.subtotal],
      ["GST", invoice.gstAmount],
      ["Discount", invoice.discount],
      ["Total", invoice.total],
      ["Paid", paid],
      ["Balance Due", invoice.total - paid],
    ]);
  } else {
    const paid = invoice.amountPaid ?? invoice.total;
    header([
      ["Invoice No", invoice.archiveNo],
      ["Supplier", purchaseSupplier(invoice)],
      ["Supplier Inv No", invoice.invoiceNo],
      ["Bill Date", day(invoice.date)],
      ["Entered On", day(invoice.createdAt)],
      ["Payment Mode", invoice.paymentMode],
    ]);
    table(
      [
        { header: "Product", width: 34, value: productName },
        { header: "Batch", width: 12, value: (i) => i.batchNo || "" },
        { header: "Expiry", width: 12, value: (i) => (i.expiryDate ? day(i.expiryDate) : "") },
        { header: "Qty (packs)", width: 12, value: (i) => i.qtyPacks },
        { header: "Rate", width: 12, value: (i) => i.costPrice },
        { header: "GST", width: 12, value: (i) => i.lineGst },
        { header: "Amount", width: 14, value: (i) => Number((i.lineAmount + i.lineGst).toFixed(2)) },
      ],
      invoice.items
    );
    totals([
      ["Subtotal", invoice.subtotal],
      ["GST", invoice.gstAmount],
      ...(invoice.tdsAmount ? [["TDS", invoice.tdsAmount]] : []),
      ["Total", invoice.total],
      ["Paid", paid],
      ["Balance Due", invoice.total - paid],
    ]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
