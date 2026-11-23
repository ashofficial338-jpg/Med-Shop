import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { KINDS, pendingInvoices, loadInvoice, invoicePdf, invoiceXlsx } from "../utils/invoiceArchive.js";

// Used by tools/invoice-saver on the shop PC (signed in as an Admin) to save
// a PDF + Excel copy of every sale and purchase. See utils/invoiceArchive.js.
const router = Router();
router.use(requireAuth, requireRole("admin"));

router.param("kind", (req, res, next, kind) => {
  if (!KINDS[kind]) return res.status(404).json({ message: "No records found." });
  next();
});

// Not-yet-saved invoices, oldest first, each with its archive number.
router.get("/:kind/pending", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
  res.json(await pendingInvoices(req.params.kind, limit));
});

async function findNumbered(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ message: "No records found." });
    return null;
  }
  const invoice = await loadInvoice(req.params.kind, req.params.id);
  if (!invoice || !invoice.archiveNo) {
    res.status(404).json({ message: "No records found." });
    return null;
  }
  return invoice;
}

router.get("/:kind/:id/file.:format(pdf|xlsx)", async (req, res) => {
  const invoice = await findNumbered(req, res);
  if (!invoice) return;
  const pdf = req.params.format === "pdf";
  const body = pdf ? await invoicePdf(req.params.kind, invoice) : await invoiceXlsx(req.params.kind, invoice);
  res.setHeader("Content-Type", pdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename=${invoice.archiveNo}.${req.params.format}`);
  res.setHeader("Cache-Control", "no-store");
  res.send(body);
});

// The saver calls this once both files are on disk.
router.post("/:kind/:id/saved", async (req, res) => {
  const invoice = await findNumbered(req, res);
  if (!invoice) return;
  await KINDS[req.params.kind].model.updateOne({ _id: invoice._id }, { $set: { archivedAt: new Date() } });
  res.json({ archiveNo: invoice.archiveNo });
});

export default router;
