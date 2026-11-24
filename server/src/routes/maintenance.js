import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import MaintenanceLog from "../models/MaintenanceLog.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { publish } from "../utils/liveEvents.js";
import { transactional, rethrowIfRetryable } from "../utils/transaction.js";
import { buildBackup, clearTransactions, recordsFingerprint, transactionCounts } from "../utils/transactionReset.js";

// Clear All Transaction Records (Admin only): see utils/transactionReset.js.
// Three locks, all enforced here: a backup taken by this Admin that still
// matches the records, the word CLEAR typed out, and the Admin's password.
const router = Router();
router.use(requireAuth, requireRole("admin"));

const CONFIRM_WORD = "CLEAR";

router.get("/transactions", async (req, res) => {
  const [counts, last] = await Promise.all([
    transactionCounts(),
    MaintenanceLog.findOne({ action: "clear-transactions" }).sort({ createdAt: -1 }).populate("performedBy", "username"),
  ]);
  res.json({ ...counts, lastCleared: last ? { at: last.createdAt, by: last.performedBy?.username || "" } : null });
});

// The backup file's text, and the token that proves it was taken.
router.post("/transactions/backup", async (req, res) => {
  const records = await recordsFingerprint();
  const backup = await buildBackup();
  if ((await recordsFingerprint()) !== records) {
    return res.status(409).json({ message: "Records changed while the backup was being made. Please try again." });
  }
  const token = jwt.sign({ purpose: "clear-transactions", uid: String(req.user._id), records }, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn: "30m" });
  res.json({ token, file: mongoose.mongo.BSON.EJSON.stringify(backup, { relaxed: false }) });
});

const clear = transactional(async (req, res) => {
  const { confirm, password, backupToken } = req.body;
  if (confirm !== CONFIRM_WORD) return res.status(400).json({ message: `Type ${CONFIRM_WORD} to confirm.` });
  // 400, not 401: a wrong password here must not end the session.
  if (!password || !(await bcrypt.compare(String(password), req.user.passwordHash))) return res.status(400).json({ message: "Your password is incorrect." });

  let proof = null;
  try {
    proof = jwt.verify(String(backupToken || ""), process.env.JWT_SECRET, { algorithms: ["HS256"] });
  } catch {
    /* missing, expired or altered */
  }
  if (proof?.purpose !== "clear-transactions" || proof.uid !== String(req.user._id)) {
    return res.status(400).json({ message: "Download a backup first (it is valid for 30 minutes).", needsBackup: true });
  }
  if ((await recordsFingerprint()) !== proof.records) {
    return res.status(409).json({ message: "Records have changed since your backup. Download a fresh backup, then clear.", needsBackup: true });
  }

  try {
    const options = {
      keepStock: req.body.keepStock === true,
      deleteCustomers: req.body.deleteCustomers === true,
      deleteVendors: req.body.deleteVendors === true,
      restartNumbers: req.body.restartNumbers === true,
    };
    const counts = await clearTransactions({ ...options, userId: req.user._id });
    await MaintenanceLog.create({ performedBy: req.user._id, options, counts });
    res.json({ message: "All transaction records have been cleared.", counts });
  } catch (e) {
    rethrowIfRetryable(e);
    console.error(e);
    res.status(500).json({ message: "Something went wrong. Nothing was cleared - please try again." });
  }
});

router.post("/transactions/clear", (req, res) => {
  // Every open screen, on every device, reloads to the cleared figures.
  res.on("finish", () => {
    if (res.statusCode < 400) publish({ topics: null, resource: "maintenance", id: null, by: String(req.user._id) });
  });
  return clear(req, res);
});

export default router;
