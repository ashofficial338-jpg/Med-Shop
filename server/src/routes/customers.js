import { Router } from "express";
import Customer from "../models/Customer.js";
import Sale from "../models/Sale.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { buildCustomerLedger, customerOutstandingMap, recordCustomerPayment, deleteCustomerPayment } from "../utils/ledgerHelpers.js";
import { shopDay, streamExcelReport, streamPdfReport } from "../utils/reportExport.js";
import { runInTransaction } from "../utils/transaction.js";
import { cleanPhone, findCustomer } from "../utils/parties.js";
import { nextSequence } from "../models/Counter.js";
import { partySummary, partyTotals } from "../utils/managementReports.js";

const router = Router();
router.use(requireAuth);

// Both roles can search/create - this is what the Billing/Checkout phone-search
// dropdown uses. Only Admin gets the full unfiltered directory + purchase history.
router.get("/", async (req, res) => {
  const { q } = req.query;
  const filter = { isActive: true };

  if (req.user.role === "staff" && !q) {
    return res.json([]); // staff can only search, not browse the full directory
  }
  // Admin's "browse all" load sends a single space as an empty-but-defined
  // query (see Customers.jsx) - a literal-space regex would then only match
  // customers whose name/phone happens to contain a space, silently hiding
  // every single-word-named customer from the directory. Only filter once
  // there's real search text.
  if (q && q.trim()) {
    // Escaped, so typing "(", "+" or "*" searches for it instead of erroring.
    const re = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ name: re }, { phone: re }];
  }
  // A search shows the closest 20; the Admin directory shows everyone.
  const browsing = req.user.role === "admin" && !q?.trim();
  const customers = await Customer.find(filter).sort({ name: 1 }).limit(browsing ? 2000 : 20);

  if (req.user.role !== "admin") return res.json(customers);
  const [outstandingMap, totals] = await Promise.all([customerOutstandingMap(), partyTotals("customer", customers.map((c) => c._id))]);
  res.json(
    customers.map((c) => {
      const t = totals.get(String(c._id));
      return { ...c.toObject(), outstandingBalance: outstandingMap.get(String(c._id)) || 0, billCount: t?.count || 0, totalSales: t?.total || 0, lastSale: t?.last || null };
    })
  );
});

router.post("/", async (req, res) => {
  // Name and phone are optional; a phone that is given must be 10 digits
  // (it's how a returning customer is found).
  const { email, address } = req.body;
  const phone = String(req.body.phone || "").trim();
  const name = String(req.body.name || "").trim() || (phone ? `Customer ${phone}` : `Customer ${(await Customer.countDocuments()) + 1}`);
  if (phone && !/^\d{10}$/.test(phone)) {
    return res.status(400).json({ message: "Enter a valid 10-digit phone number, or leave it blank." });
  }

  try {
    const out = await runInTransaction(async () => {
      // One at a time, so the same customer can't be added twice at once.
      await nextSequence("lock:customer");
      const existing = await findCustomer({ name: req.body.name, phone });
      if (existing?.isActive) {
        return { status: 409, body: { message: existing.phone && existing.phone === phone ? "A customer with this phone number already exists." : `${existing.name} is already in the Customer List. ${phone ? "Edit that customer to add the phone number." : "Add a phone number if this is someone else."}` } };
      }
      // Phone is unique, so re-adding a deleted customer restores that record
      // (keeping their bill history) instead of failing on the unique index.
      if (existing && req.user.role !== "admin") {
        return { status: 409, body: { message: "A removed customer has this name or phone number. Ask an Admin to restore them." } };
      }
      if (existing) {
        Object.assign(existing, { name, email: email ?? existing.email, address: address ?? existing.address, isActive: true, ...(phone ? { phone } : {}) });
        await existing.save();
        return { status: 201, body: existing };
      }
      const customer = new Customer({ name, phone: phone || undefined, email, address });
      await customer.save();
      return { status: 201, body: customer };
    });
    res.status(out.status).json(out.body);
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ message: "A customer with this phone number already exists." });
    console.error(e);
    res.status(500).json({ message: "Something went wrong. Please try again." });
  }
});

// Admin-only directory export with the same search and "Show" filter as the
// Customer Management page (client pages/Customers.jsx).
const SHOW = { due: "They owe you", top: "Top 10 by sales", new: "No bills yet" };
router.get("/export", requireRole("admin"), async (req, res) => {
  const { format } = req.query;
  const q = String(req.query.q || "").trim();
  const show = Object.hasOwn(SHOW, String(req.query.show)) ? req.query.show : "all";
  const filter = { isActive: true };
  if (q) {
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ name: re }, { phone: re }, { email: re }, { address: re }];
  }
  const [records, outstandingMap] = await Promise.all([Customer.find(filter).sort({ name: 1 }).lean(), customerOutstandingMap()]);
  const everyone = show === "top" ? await Customer.find({ isActive: true }, "_id").sort({ name: 1 }).lean() : records;
  const totals = show === "top" || show === "new" ? await partyTotals("customer", everyone.map((r) => r._id)) : null;
  // The ten best of all customers, whatever is searched for among them.
  const top =
    show === "top"
      ? new Set(everyone.map((r) => [String(r._id), totals.get(String(r._id))?.total || 0]).filter(([, t]) => t > 0).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id]) => id))
      : null;
  const rows = records
    .map((r) => ({ ...r, outstandingBalance: outstandingMap.get(String(r._id)) || 0 }))
    .filter((r) => (show === "due" ? r.outstandingBalance > 0 : show === "top" ? top.has(String(r._id)) : show === "new" ? !totals.get(String(r._id))?.count : true));
  const total = rows.reduce((sum, r) => sum + r.outstandingBalance, 0);
  const subtitle = `${[SHOW[show], q && `Search: "${q}"`].filter(Boolean).join(" · ") || "All active customers"} · Total outstanding: Rs. ${total.toFixed(2)}`;

  if (format === "pdf") {
    return streamPdfReport(res, "GuganMedicals_Customers_Report.pdf", {
      title: "Gugan Medicals - Customers & Outstanding Balances",
      subtitle,
      columns: [
        { header: "Name", key: "name", flex: 1.6 },
        { header: "Phone", key: "phone" },
        { header: "Email", key: "email", flex: 1.4 },
        { header: "Outstanding", key: "outstandingDisplay", align: "right" },
      ],
      rows: rows.map((r) => ({ ...r, outstandingDisplay: `Rs. ${r.outstandingBalance.toFixed(2)}` })),
    });
  }

  return streamExcelReport(res, "GuganMedicals_Customers_Report.xlsx", [
    {
      name: "Customers",
      columns: [
        { header: "Name", key: "name", width: 24 },
        { header: "Phone", key: "phone", width: 14 },
        { header: "Email", key: "email", width: 26 },
        { header: "Address", key: "address", width: 30 },
        { header: "Outstanding Balance", key: "outstandingBalance", width: 18 },
      ],
      rows,
    },
  ]);
});

router.get("/:id", requireRole("admin"), async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) return res.status(404).json({ message: "No records found." });

  const bills = await Sale.find({ customer: customer._id }).sort({ createdAt: -1 });
  const { outstandingBalance } = await buildCustomerLedger(customer._id);
  res.json({ customer, bills, outstandingBalance });
});

// One customer in full: totals, every bill, what they buy, month by month.
router.get("/:id/summary", requireRole("admin"), async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) return res.status(404).json({ message: "No records found." });
  const [summary, outstanding] = await Promise.all([partySummary("customer", customer._id), customerOutstandingMap()]);
  res.json({ party: customer, outstanding: outstanding.get(String(customer._id)) || 0, ...summary });
});

router.get("/:id/ledger", requireRole("admin"), async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) return res.status(404).json({ message: "No records found." });

  const ledger = await buildCustomerLedger(customer._id);
  res.json({ customer, ...ledger });
});

router.get("/:id/ledger/export", requireRole("admin"), async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) return res.status(404).json({ message: "No records found." });

  const { entries, outstandingBalance } = await buildCustomerLedger(customer._id);
  const rows = entries.map((e) => ({
    date: shopDay(e.date),
    type: e.type,
    ref: e.ref,
    debit: e.debit || 0,
    credit: e.credit || 0,
    balance: e.balance,
  }));

  if (req.query.format === "pdf") {
    return streamPdfReport(res, `GuganMedicals_Ledger_${customer.name}.pdf`, {
      title: `${customer.name} - Customer Ledger`,
      subtitle: [customer.phone, `Outstanding: Rs. ${outstandingBalance.toFixed(2)}`].filter(Boolean).join(" · "),
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

  return streamExcelReport(res, `GuganMedicals_Ledger_${customer.name}.xlsx`, [
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

router.post("/:id/payments", requireRole("admin"), async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) return res.status(404).json({ message: "No records found." });

  const { amount, mode, date, note, saleId } = req.body;
  const amountNum = Number(amount);
  if (!(amountNum > 0)) return res.status(400).json({ message: "Please enter a valid number." });

  const result = await runInTransaction(() =>
    recordCustomerPayment({
      customerId: customer._id,
      amount: amountNum,
      mode: mode || "Cash",
      date,
      note,
      saleId: saleId || null,
      recordedBy: req.user._id,
    })
  );
  if (result.error) return res.status(400).json({ message: result.error });

  const ledger = await buildCustomerLedger(customer._id);
  res.status(201).json({ customer, ...ledger });
});

// Deletes a recorded payment (Admin); the bills it paid off owe that amount again.
router.delete("/:id/payments/:paymentId", requireRole("admin"), async (req, res) => {
  const customer = await Customer.findById(req.params.id).catch(() => null);
  if (!customer) return res.status(404).json({ message: "No records found." });
  const result = await runInTransaction(() => deleteCustomerPayment(customer._id, req.params.paymentId));
  if (result.error) return res.status(404).json({ message: result.error });
  const ledger = await buildCustomerLedger(customer._id);
  res.json({ customer, ...ledger });
});

router.patch("/:id", requireRole("admin"), async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) return res.status(404).json({ message: "No records found." });

  const { email, address } = req.body;
  const name = req.body.name === undefined ? undefined : String(req.body.name).trim();
  if (name === "") return res.status(400).json({ message: "Enter the customer's name." });
  const phone = req.body.phone === undefined ? undefined : cleanPhone(req.body.phone);
  if (phone === "" && String(req.body.phone).trim()) return res.status(400).json({ message: "Enter a valid 10-digit phone number, or leave it blank." });
  if (phone && (await Customer.exists({ phone, _id: { $ne: customer._id } }))) {
    return res.status(409).json({ message: "Another customer already has this phone number." });
  }
  if (name !== undefined) customer.name = name;
  if (phone !== undefined) customer.phone = phone || undefined;
  if (email !== undefined) customer.email = email;
  if (address !== undefined) customer.address = address;
  await customer.save();
  res.json(customer);
});

// Soft delete: their bills and payments stay on record. Blocked while they
// still owe money, so an unpaid credit balance can't disappear from view.
router.delete("/:id", requireRole("admin"), async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer || !customer.isActive) return res.status(404).json({ message: "No records found." });

  const { outstandingBalance } = await buildCustomerLedger(customer._id);
  if (outstandingBalance > 0) {
    return res.status(400).json({
      message: `This customer still owes ₹${outstandingBalance.toFixed(2)}. Settle the balance before deleting.`,
    });
  }

  customer.isActive = false;
  await customer.save();
  res.json({ message: "Customer deleted." });
});

export default router;
