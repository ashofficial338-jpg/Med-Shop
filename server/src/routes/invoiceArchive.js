import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { KINDS, pendingInvoices, loadInvoice, invoicePdf, invoiceXlsx, archiveFileName, atVersion } from "../utils/invoiceArchive.js";

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

// The version the saver is working on (from /pending). Optional, so a saver
// from before edited copies existed keeps working.
function requestedVersion(req) {
  const v = req.query.version;
  return v === undefined || v === "" ? null : Number(v);
}

router.get("/:kind/:id/file.:format(pdf|xlsx)", async (req, res) => {
  const invoice = await findNumbered(req, res);
  if (!invoice) return;
  const version = requestedVersion(req);
  // Edited again since the saver listed it: it'll be listed again with the
  // new version, so don't hand out a copy under an outdated name.
  if (version !== null && version !== (invoice.archiveVersion || 0)) {
    return res.status(409).json({ message: "This invoice changed - it will be saved again." });
  }
  const pdf = req.params.format === "pdf";
  const body = pdf ? await invoicePdf(req.params.kind, invoice) : await invoiceXlsx(req.params.kind, invoice);
  res.setHeader("Content-Type", pdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${archiveFileName(invoice)}.${req.params.format}"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(body);
});

// The saver calls this once both files are on disk. A copy now exists under
// the current name, so the count always goes up (the next copy gets the next
// name). The invoice only leaves the list if it wasn't edited meanwhile -
// otherwise it stays on, and the edit is saved as the next copy.
router.post("/:kind/:id/saved", async (req, res) => {
  const invoice = await findNumbered(req, res);
  if (!invoice) return;
  const { model } = KINDS[req.params.kind];
  const version = requestedVersion(req) ?? (invoice.archiveVersion || 0);
  const done = await model.updateOne(
    { _id: invoice._id, ...atVersion(version) },
    { $set: { archivedAt: new Date() }, $inc: { archiveCopies: 1 } }
  );
  if (!done.matchedCount) await model.updateOne({ _id: invoice._id }, { $inc: { archiveCopies: 1 } });
  res.json({ archiveNo: invoice.archiveNo, upToDate: Boolean(done.matchedCount) });
});

export default router;
