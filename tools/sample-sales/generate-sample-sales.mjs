// Generates 20 SAMPLE sales invoices (SALES-001 .. SALES-020) as PDF + Excel
// for testing the invoice folders - nothing else.
//
//   node tools/sample-sales/generate-sample-sales.mjs
//
// - Files only: nothing is sent to the server or written to the database, so
//   stock, sales, customer ledgers, day book and the real SALES-xxx counter
//   are untouched.
// - Every file is stamped "SAMPLE DATA - NOT A REAL INVOICE", and bill
//   numbers are SAMPLE-0001 .. so they can't be confused with real GM- bills.
// - Uses the same PDF/Excel layout and the same Year/Month/DD-MM-YYYY
//   folders and never-overwrite rule as tools/invoice-saver.
// - Dates are all before 23-11-2026 (when real invoice saving started), so a
//   real invoice never lands in the same folder under the same name.
// - The data is fixed (no randomness): re-running gives the same invoices
//   and skips files that already exist.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs/promises";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const { invoicePdf, invoiceXlsx } = await import(pathToFileURL(path.join(root, "server/src/utils/invoiceArchive.js")).href);
const { datedFolder, writeNew } = await import(pathToFileURL(path.join(root, "tools/invoice-saver/saver.mjs")).href);

const SALES_DIR = process.env.SALES_DIR || String.raw`C:\Users\ASHWIN\OneDrive\Desktop\Med Shop\reports\sales`;

// Fictional customers (Chennai area).
const CUSTOMERS = [
  { name: "Ramesh Kumar", phone: "9840123456", address: "12, Gandhi Street, T. Nagar, Chennai 600017" },
  { name: "Priya Sundaram", phone: "9884234567", address: "45, 2nd Main Road, Velachery, Chennai 600042" },
  { name: "Mohammed Rafiq", phone: "9790345678", address: "8/3, Anna Salai, Mount Road, Chennai 600002" },
  { name: "Lakshmi Narayanan", phone: "9444456789", address: "21, Lake View Road, West Mambalam, Chennai 600033" },
  { name: "Arun Prakash", phone: "8939567890", address: "102, Velachery Main Road, Pallikaranai, Chennai 600100" },
  { name: "Meena Rajendran", phone: "9566678901", address: "7, Kamarajar Salai, Tambaram, Chennai 600045" },
  { name: "Suresh Babu", phone: "9003789012", address: "33, Nehru Nagar, Adyar, Chennai 600020" },
  { name: "Kavitha Selvam", phone: "7299890123", address: "5, Temple Street, Mylapore, Chennai 600004" },
  { name: "Joseph Antony", phone: "9962901234", address: "18, Church Road, Perambur, Chennai 600011" },
  { name: "Divya Krishnan", phone: "8148012345", address: "64, Rajaji Nagar, Villivakkam, Chennai 600049" },
];

// name, HSN, GST %, pack rate (pre-GST, as real bills store it), unit
const MEDICINES = [
  ["Paracetamol 650mg (Dolo 650)", "30049099", 12, 30.5, "Strip"],
  ["Amoxicillin 500mg Capsule", "30041010", 12, 89.0, "Strip"],
  ["Azithromycin 500mg Tablet", "30042019", 12, 118.75, "Strip"],
  ["Cetirizine 10mg Tablet", "30049099", 12, 18.4, "Strip"],
  ["Pantoprazole 40mg Tablet", "30049099", 12, 105.0, "Strip"],
  ["Metformin 500mg Tablet", "30049099", 12, 22.5, "Strip"],
  ["Atorvastatin 10mg Tablet", "30049099", 12, 96.6, "Strip"],
  ["Amlodipine 5mg Tablet", "30049099", 12, 31.2, "Strip"],
  ["ORS Electrolyte Powder 21g", "30049099", 5, 21.0, "Sachet"],
  ["Vitamin C 500mg Chewable", "21069099", 18, 48.0, "Strip"],
  ["Cough Syrup 100ml (Benadryl)", "30049011", 12, 118.0, "Bottle"],
  ["Calcium + Vitamin D3 Tablet", "30045090", 12, 112.5, "Strip"],
  ["Ibuprofen 400mg Tablet", "30049099", 12, 15.8, "Strip"],
  ["Omeprazole 20mg Capsule", "30049099", 12, 54.0, "Strip"],
  ["Betadine Ointment 20g", "30049099", 12, 135.0, "Tube"],
  ["Insulin Glargine 100IU/ml Pen", "30043110", 5, 685.0, "Pen"],
];

// Invoice date/time (IST) per invoice - spread over Sep-Nov 2026, with some
// days having more than one invoice.
const DATES = [
  "2026-09-03T10:15", "2026-09-03T17:40", "2026-09-12T11:05", "2026-09-21T19:20",
  "2026-09-29T09:50", "2026-10-02T12:30", "2026-10-02T18:10", "2026-10-09T10:45",
  "2026-10-15T16:25", "2026-10-15T20:05", "2026-10-22T11:35", "2026-10-28T13:15",
  "2026-11-01T09:30", "2026-11-04T18:55", "2026-11-04T20:40", "2026-11-10T12:00",
  "2026-11-14T15:45", "2026-11-18T10:20", "2026-11-20T17:35", "2026-11-22T19:10",
];
const MODES = ["Cash", "UPI", "Card", "Cash", "UPI", "Credit"];
const DISCOUNT_PERCENT = [0, 5, 0, 10, 2, 0, 5, 0, 3, 0];

const r2 = (n) => Number(n.toFixed(2));

export function buildSampleSale(n) {
  const i = n - 1;
  const customer = CUSTOMERS[i % CUSTOMERS.length];
  const createdAt = new Date(`${DATES[i]}:00+05:30`);
  const lineCount = 2 + (i % 4); // 2-5 medicines per invoice
  const items = [];
  for (let k = 0; k < lineCount; k++) {
    // Distinct medicines within an invoice; the shift every 16 invoices
    // keeps SALES-017+ from repeating SALES-001+.
    const [name, hsnCode, gstPercent, rate, unitLabel] = MEDICINES[(i * 3 + k * 5 + Math.floor(i / MEDICINES.length)) % MEDICINES.length];
    const qty = 1 + ((i + k * 2 + Math.floor(i / 7)) % 4);
    // Same maths as POST /api/sales: amount = qty x rate, GST on top.
    const amount = r2(qty * rate);
    const gstAmount = r2((amount * gstPercent) / 100);
    const expiryDate = new Date(Date.UTC(2027 + ((i + k) % 3), (i * 2 + k * 5) % 12, 1));
    const batchNo = `SB${String(26000 + n * 10 + k)}${String.fromCharCode(65 + ((i + k) % 26))}`;
    items.push({
      name,
      hsnCode,
      unitType: "pack",
      unitLabel,
      qty,
      rate,
      gstPercent,
      amount,
      gstAmount,
      batchBreakdown: [{ batchNo, expiryDate, qty }],
    });
  }
  const subtotal = r2(items.reduce((s, it) => s + it.amount, 0));
  const gstAmount = r2(items.reduce((s, it) => s + it.gstAmount, 0));
  const discount = r2(((subtotal + gstAmount) * DISCOUNT_PERCENT[i % DISCOUNT_PERCENT.length]) / 100);
  const total = r2(subtotal + gstAmount - discount);
  const paymentMode = MODES[i % MODES.length];
  return {
    sampleData: true,
    archiveNo: `SALES-${String(n).padStart(3, "0")}`,
    billNo: `SAMPLE-${String(n).padStart(4, "0")}`,
    createdAt,
    customer,
    createdBy: { username: "sample" },
    items,
    subtotal,
    gstAmount,
    discount,
    total,
    // Credit bills: half paid at billing, rest due.
    amountPaid: paymentMode === "Credit" ? r2(total / 2) : total,
    paymentMode,
    paymentStatus: "completed",
  };
}

async function main() {
  console.log(`Saving 20 SAMPLE sales invoices to ${SALES_DIR}\n`);
  let written = 0;
  let skipped = 0;
  for (let n = 1; n <= 20; n++) {
    const sale = buildSampleSale(n);
    const dir = datedFolder(SALES_DIR, sale.createdAt);
    await fs.mkdir(dir, { recursive: true });
    const out = [];
    for (const [ext, make] of [["pdf", invoicePdf], ["xlsx", invoiceXlsx]]) {
      const file = path.join(dir, `${sale.archiveNo}.${ext}`);
      if (await writeNew(file, await make("sales", sale))) {
        written++;
        out.push(ext);
      } else {
        skipped++;
        out.push(`${ext} (exists, kept)`);
      }
    }
    console.log(
      `${sale.archiveNo}  ${sale.billNo}  ${sale.customer.name.padEnd(18)} ${String(sale.items.length)} items  ` +
        `sub ${sale.subtotal.toFixed(2).padStart(8)}  disc ${sale.discount.toFixed(2).padStart(6)}  GST ${sale.gstAmount.toFixed(2).padStart(7)}  ` +
        `total ${sale.total.toFixed(2).padStart(8)}  ${path.relative(SALES_DIR, dir)}  [${out.join(", ")}]`
    );
  }
  console.log(`\nDone: ${written} file(s) written, ${skipped} already existed and were left as they were.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
