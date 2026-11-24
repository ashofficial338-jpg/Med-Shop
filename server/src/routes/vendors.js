import { Router } from "express";
import { body, validationResult } from "express-validator";
import Vendor from "../models/Vendor.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { buildSupplierLedger, vendorOutstandingMap, recordSupplierPayment, deleteSupplierPayment } from "../utils/ledgerHelpers.js";
import Purchase from "../models/Purchase.js";
import SupplierPayment from "../models/SupplierPayment.js";
import Product from "../models/Product.js";
import { buildVendorReport } from "../utils/vendorReportHelpers.js";
import { streamExcelReport, streamPdfReport } from "../utils/reportExport.js";
import { runInTransaction } from "../utils/transaction.js";

const router = Router();
router.use(requireAuth, requireRole("admin"));

router.get("/", async (req, res) => {
  const { q } = req.query;
  const filter = { isActive: true };
  if (q) {
    // Escaped, so typing "(", "+" or "*" searches for it instead of erroring.
    const re = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ name: re }, { phone: re }];
  }
  const vendors = await Vendor.find(filter).sort({ name: 1 });
  const outstandingMap = await vendorOutstandingMap();
  res.json(vendors.map((v) => ({ ...v.toObject(), outstandingPayable: outstandingMap.get(String(v._id)) || 0 })));
});

// Directory export with the same search filter as the list.
router.get("/export", async (req, res) => {
  const { q, format } = req.query;
  const filter = { isActive: true };
  if (q && q.trim()) {
    const re = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ name: re }, { phone: re }];
  }
  const [records, outstandingMap] = await Promise.all([Vendor.find(filter).sort({ name: 1 }).lean(), vendorOutstandingMap()]);
  const rows = records.map((r) => ({ ...r, outstandingPayable: outstandingMap.get(String(r._id)) || 0 }));
  const total = rows.reduce((sum, r) => sum + r.outstandingPayable, 0);
  const subtitle = `${q && q.trim() ? `Search: "${q.trim()}"` : "All active vendors"} · Total payable: Rs. ${total.toFixed(2)}`;

  if (format === "pdf") {
    return streamPdfReport(res, "GuganMedicals_Vendors_Report.pdf", {
      title: "Gugan Medicals - Vendors & Payables",
      subtitle,
      columns: [
        { header: "Name", key: "name", flex: 1.6 },
        { header: "Phone", key: "phone" },
        { header: "GSTIN", key: "gstNumber", flex: 1.3 },
        { header: "Payable", key: "payableDisplay", align: "right" },
      ],
      rows: rows.map((r) => ({ ...r, payableDisplay: `Rs. ${r.outstandingPayable.toFixed(2)}` })),
    });
  }

  return streamExcelReport(res, "GuganMedicals_Vendors_Report.xlsx", [
    {
      name: "Vendors",
      columns: [
        { header: "Name", key: "name", width: 24 },
        { header: "Phone", key: "phone", width: 14 },
        { header: "Email", key: "email", width: 26 },
        { header: "GSTIN", key: "gstNumber", width: 18 },
        { header: "Outstanding Payable", key: "outstandingPayable", width: 18 },
      ],
      rows,
    },
  ]);
});

router.get("/:id", async (req, res) => {
  const vendor = await Vendor.findById(req.params.id);
  if (!vendor) return res.status(404).json({ message: "No records found." });
  const { outstandingBalance } = await buildSupplierLedger(vendor._id);
  res.json({ ...vendor.toObject(), outstandingPayable: outstandingBalance });
});

router.get("/:id/ledger", async (req, res) => {
  const vendor = await Vendor.findById(req.params.id);
  if (!vendor) return res.status(404).json({ message: "No records found." });

  const ledger = await buildSupplierLedger(vendor._id);
  res.json({ vendor, ...ledger });
});

router.get("/:id/ledger/export", async (req, res) => {
  const vendor = await Vendor.findById(req.params.id);
  if (!vendor) return res.status(404).json({ message: "No records found." });

  const { entries, outstandingBalance } = await buildSupplierLedger(vendor._id);
  const rows = entries.map((e) => ({
    date: new Date(e.date).toISOString().slice(0, 10),
    type: e.type,
    ref: e.ref,
    debit: e.debit || 0,
    credit: e.credit || 0,
    balance: e.balance,
  }));

  if (req.query.format === "pdf") {
    return streamPdfReport(res, `GuganMedicals_Ledger_${vendor.name}.pdf`, {
      title: `${vendor.name} - Vendor Ledger`,
      subtitle: `${vendor.phone} · Outstanding Payable: Rs. ${outstandingBalance.toFixed(2)}`,
      columns: [
        { header: "Date", key: "date" },
        { header: "Type", key: "type" },
        { header: "Ref", key: "ref" },
        { header: "Debit", key: "debit", align: "right" },
        { header: "Credit", key: "credit", align: "right" },
        { header: "Balance", key: "balance", align: "right" },
      ],
      rows,
    });
  }

  return streamExcelReport(res, `GuganMedicals_Ledger_${vendor.name}.xlsx`, [
    {
      name: "Ledger",
      columns: [
        { header: "Date", key: "date", width: 14 },
        { header: "Type", key: "type", width: 18 },
        { header: "Ref", key: "ref", width: 16 },
        { header: "Debit", key: "debit", width: 12 },
        { header: "Credit", key: "credit", width: 12 },
        { header: "Balance", key: "balance", width: 12 },
      ],
      rows,
    },
  ]);
});

router.post("/:id/payments", async (req, res) => {
  const vendor = await Vendor.findById(req.params.id);
  if (!vendor) return res.status(404).json({ message: "No records found." });

  const { amount, mode, date, note, purchaseId } = req.body;
  const amountNum = Number(amount);
  if (!(amountNum > 0)) return res.status(400).json({ message: "Please enter a valid number." });

  const result = await runInTransaction(() =>
    recordSupplierPayment({
      vendorId: vendor._id,
      amount: amountNum,
      mode: mode || "Cash",
      date,
      note,
      purchaseId: purchaseId || null,
      recordedBy: req.user._id,
    })
  );
  if (result.error) return res.status(400).json({ message: result.error });

  const ledger = await buildSupplierLedger(vendor._id);
  res.status(201).json({ vendor, ...ledger });
});

// Deletes a recorded payment; the invoices it paid off owe that amount again.
router.delete("/:id/payments/:paymentId", async (req, res) => {
  const vendor = await Vendor.findById(req.params.id).catch(() => null);
  if (!vendor) return res.status(404).json({ message: "No records found." });
  const result = await runInTransaction(() => deleteSupplierPayment(vendor._id, req.params.paymentId));
  if (result.error) return res.status(404).json({ message: result.error });
  const ledger = await buildSupplierLedger(vendor._id);
  res.json({ vendor, ...ledger });
});

// Deletes a supplier outright - only one with no purchases or payments on
// record, since those would lose who they were with (mark the supplier
// inactive instead, or delete their purchases first). Products that named
// this supplier simply stop naming one.
router.delete("/:id", async (req, res) => {
  const vendor = await Vendor.findById(req.params.id).catch(() => null);
  if (!vendor) return res.status(404).json({ message: "No records found." });
  const [purchases, payments] = await Promise.all([
    Purchase.countDocuments({ vendor: vendor._id }),
    SupplierPayment.countDocuments({ vendor: vendor._id }),
  ]);
  if (purchases || payments) {
    const what = [purchases && `${purchases} purchase${purchases === 1 ? "" : "s"}`, payments && `${payments} payment${payments === 1 ? "" : "s"}`]
      .filter(Boolean)
      .join(" and ");
    return res.status(400).json({ message: `${vendor.name} has ${what} on record. Delete those first, or mark the supplier inactive instead.` });
  }
  await Product.updateMany({ vendor: vendor._id }, { $set: { vendor: null } });
  await Vendor.deleteOne({ _id: vendor._id });
  res.json({ message: `${vendor.name} deleted.` });
});

router.get("/:id/report", async (req, res) => {
  const vendor = await Vendor.findById(req.params.id);
  if (!vendor) return res.status(404).json({ message: "No records found." });

  const period = req.query.period === "quarter" ? "quarter" : "month";
  const report = await buildVendorReport(vendor._id, period);
  res.json({ vendor, period, report });
});

router.get("/:id/report/export", async (req, res) => {
  const vendor = await Vendor.findById(req.params.id);
  if (!vendor) return res.status(404).json({ message: "No records found." });

  const period = req.query.period === "quarter" ? "quarter" : "month";
  const report = await buildVendorReport(vendor._id, period);

  if (req.query.format === "pdf") {
    return streamPdfReport(res, `GuganMedicals_VendorReport_${vendor.name}.pdf`, {
      title: `${vendor.name} - Purchase Report (${period}-wise)`,
      subtitle: `${vendor.phone} · ${vendor.gstNumber}`,
      columns: [
        { header: "Period", key: "period" },
        { header: "Invoices", key: "invoiceCount", align: "right" },
        { header: "Purchases", key: "totalPurchases", align: "right" },
        { header: "Paid", key: "totalPaid", align: "right" },
        { header: "Outstanding", key: "outstanding", align: "right" },
      ],
      rows: report,
    });
  }

  return streamExcelReport(res, `GuganMedicals_VendorReport_${vendor.name}.xlsx`, [
    {
      name: "Vendor Report",
      columns: [
        { header: "Period", key: "period", width: 14 },
        { header: "Invoices", key: "invoiceCount", width: 12 },
        { header: "Purchases", key: "totalPurchases", width: 14 },
        { header: "Paid", key: "totalPaid", width: 14 },
        { header: "Outstanding", key: "outstanding", width: 14 },
      ],
      rows: report,
    },
  ]);
});

router.patch("/:id/rating", async (req, res) => {
  const vendor = await Vendor.findById(req.params.id);
  if (!vendor) return res.status(404).json({ message: "No records found." });

  const { quality, reliability, costEfficiency } = req.body;
  for (const [key, value] of Object.entries({ quality, reliability, costEfficiency })) {
    if (value === undefined) continue;
    const num = Number(value);
    if (!(num >= 1 && num <= 5)) return res.status(400).json({ message: "Please enter a valid number." });
    vendor.ratings[key] = num;
  }
  vendor.ratings.ratedAt = new Date();
  await vendor.save();
  res.json(vendor);
});

// Every vendor field is optional; values that are given must be well-formed.
const vendorValidation = [
  body("name").optional({ values: "falsy" }).trim().isLength({ max: 150 }).withMessage("Name can be up to 150 characters."),
  body("phone").optional({ values: "falsy" }).trim().matches(/^\d{10}$/).withMessage("Enter a valid 10-digit phone number, or leave it blank."),
  body("gstNumber").optional({ values: "falsy" }).trim().isLength({ min: 15, max: 15 }).withMessage("Enter a valid 15-character GSTIN, or leave it blank."),
  body("email").optional({ values: "falsy" }).isEmail().withMessage("Please enter a valid email address."),
];

// A vendor saved with no name still needs something to show in lists.
async function withVendorName(body) {
  const out = { ...body };
  if (out.name !== undefined && !String(out.name || "").trim()) out.name = `Supplier ${(await Vendor.countDocuments()) + 1}`;
  return out;
}

router.post("/", vendorValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg });
  }

  try {
    const vendor = await Vendor.create(await withVendorName({ name: "", ...req.body }));
    res.status(201).json(vendor);
  } catch (e) {
    res.status(500).json({ message: "Something went wrong. Please try again." });
  }
});

router.patch("/:id", vendorValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg });
  }

  const vendor = await Vendor.findById(req.params.id);
  if (!vendor) return res.status(404).json({ message: "No records found." });

  Object.assign(vendor, await withVendorName(req.body));
  await vendor.save();
  res.json(vendor);
});

router.patch("/:id/active", async (req, res) => {
  const vendor = await Vendor.findById(req.params.id);
  if (!vendor) return res.status(404).json({ message: "No records found." });

  // Deactivating hides the vendor everywhere, so don't let an unpaid
  // supplier balance disappear with it.
  if (!req.body.isActive) {
    const { outstandingBalance } = await buildSupplierLedger(vendor._id);
    if (outstandingBalance > 0) {
      return res.status(400).json({
        message: `You still owe this vendor ₹${outstandingBalance.toFixed(2)}. Settle the balance before deactivating.`,
      });
    }
  }

  vendor.isActive = Boolean(req.body.isActive);
  await vendor.save();
  res.json(vendor);
});

export default router;
