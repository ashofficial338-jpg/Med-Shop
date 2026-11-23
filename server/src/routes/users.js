import { Router } from "express";
import bcrypt from "bcryptjs";
import { body, validationResult } from "express-validator";
import User from "../models/User.js";
import Sale from "../models/Sale.js";
import Purchase from "../models/Purchase.js";
import Expense from "../models/Expense.js";
import StockLedger from "../models/StockLedger.js";
import CustomerPayment from "../models/CustomerPayment.js";
import SupplierPayment from "../models/SupplierPayment.js";
import DayBookAdjustment from "../models/DayBookAdjustment.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { PERMISSIONS, sanitizePermissions } from "../utils/permissions.js";

const router = Router();
router.use(requireAuth, requireRole("admin"));

// The grantable permissions, for the Roles & Permissions page.
router.get("/permissions", (req, res) => {
  res.json(PERMISSIONS);
});

const publicUser = (user) => ({
  id: user._id,
  email: user.email,
  username: user.username,
  role: user.role,
  isActive: user.isActive,
  permissions: user.permissions || [],
});

router.get("/", async (req, res) => {
  // Escaped, so typing "(", "+" or "*" searches for it instead of erroring.
  const q = String(req.query.q || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const filter = q
    ? {
        $or: [
          { email: new RegExp(q, "i") },
          { username: new RegExp(q, "i") },
        ],
      }
    : {};
  const users = await User.find(filter).select("-passwordHash").sort({ createdAt: -1 });
  res.json(users);
});

// Whether another account already signs in with this username.
async function usernameTaken(username, excludeId = null) {
  const name = String(username || "").trim();
  if (!name) return false;
  const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  return Boolean(await User.exists({ username: re, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }));
}

router.post(
  "/",
  [
    // Email and role are optional. Username + password are what the person
    // signs in with, so they stay required.
    body("email").optional({ values: "falsy" }).isEmail().withMessage("Please enter a valid email address, or leave it blank."),
    body("username").trim().isLength({ min: 1, max: 50 }).withMessage("Enter a username - it's needed to sign in."),
    body("role").optional({ values: "falsy" }).isIn(["admin", "staff"]).withMessage("Please choose Admin or Staff."),
    body("password")
      .isLength({ min: 6, max: 15 })
      .withMessage("Password must be between 6 and 15 characters."),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: errors.array()[0].msg });
    }

    const { username, password, isActive = true, permissions } = req.body;
    const role = req.body.role || "staff";
    const email = String(req.body.email || "").toLowerCase().trim();

    if (email && (await User.exists({ email }))) {
      return res.status(409).json({ message: "This email is already in use." });
    }
    // Without an email, sign-in is by username alone, so it must be unique.
    if (!email && (await usernameTaken(username))) {
      return res.status(409).json({ message: "That username is already used. Pick another, or add an email address." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      email: email || undefined,
      username,
      role,
      passwordHash,
      isActive,
      permissions: sanitizePermissions(permissions),
    });

    res.status(201).json(publicUser(user));
  }
);

router.patch(
  "/:id",
  [
    body("username").optional().trim().isLength({ min: 1, max: 50 }).withMessage("Username is needed to sign in."),
    body("email").optional({ values: "falsy" }).isEmail().withMessage("Please enter a valid email address, or leave it blank."),
    body("role").optional().isIn(["admin", "staff"]),
    body("isActive").optional().isBoolean(),
    body("permissions").optional().isArray(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: errors.array()[0].msg });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "No records found." });
    }

    if (req.body.isActive === false && user.role === "admin") {
      const activeAdmins = await User.countDocuments({ role: "admin", isActive: true });
      if (activeAdmins <= 1) {
        return res.status(400).json({ message: "You cannot deactivate the only Admin account." });
      }
    }
    // Same safeguard for a role change: the shop must always keep an active Admin.
    if (req.body.role === "staff" && user.role === "admin" && user.isActive) {
      const activeAdmins = await User.countDocuments({ role: "admin", isActive: true });
      if (activeAdmins <= 1) {
        return res.status(400).json({ message: "You cannot remove the Admin role from the only Admin account." });
      }
    }

    if (req.body.email !== undefined) {
      const email = String(req.body.email || "").toLowerCase().trim();
      if (email && email !== user.email && (await User.exists({ email, _id: { $ne: user._id } }))) {
        return res.status(409).json({ message: "This email is already in use." });
      }
      const nextUsername = req.body.username !== undefined ? req.body.username : user.username;
      if (!email && (await usernameTaken(nextUsername, user._id))) {
        return res.status(409).json({ message: "Another account uses this username, so this one needs an email to sign in." });
      }
      user.email = email || undefined;
    }
    if (req.body.username !== undefined) user.username = req.body.username;
    if (req.body.role !== undefined) user.role = req.body.role;
    if (req.body.isActive !== undefined) user.isActive = req.body.isActive;
    if (req.body.permissions !== undefined) user.permissions = sanitizePermissions(req.body.permissions);
    await user.save();

    res.json(publicUser(user));
  }
);

// Records that keep a reference to the user who made them. A user with any of
// these can't be deleted (their bills etc. would lose their author) - they're
// deactivated instead, which blocks login but keeps the history intact.
const HISTORY = [
  [Sale, ["createdBy", "voidedBy"], ["bill", "bills"]],
  [Purchase, ["createdBy"], ["purchase", "purchases"]],
  [Expense, ["createdBy"], ["expense", "expenses"]],
  [StockLedger, ["performedBy"], ["stock movement", "stock movements"]],
  [CustomerPayment, ["recordedBy"], ["customer payment", "customer payments"]],
  [SupplierPayment, ["recordedBy"], ["supplier payment", "supplier payments"]],
  [DayBookAdjustment, ["setBy"], ["day book entry", "day book entries"]],
];

async function historyFor(userId) {
  const found = [];
  for (const [Model, fields, [one, many]] of HISTORY) {
    const n = await Model.countDocuments({ $or: fields.map((f) => ({ [f]: userId })) });
    if (n) found.push(`${n} ${n === 1 ? one : many}`);
  }
  return found;
}

// Admin-only (router-level requireRole): permanently remove a user.
router.delete("/:id", async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    return res.status(404).json({ message: "No records found." });
  }
  if (String(user._id) === String(req.user._id)) {
    return res.status(400).json({ message: "You cannot delete your own account." });
  }
  if (user.role === "admin" && user.isActive) {
    const activeAdmins = await User.countDocuments({ role: "admin", isActive: true });
    if (activeAdmins <= 1) {
      return res.status(400).json({ message: "You cannot delete the only Admin account." });
    }
  }

  const history = await historyFor(user._id);
  if (history.length) {
    return res.status(409).json({
      message: `${user.username} has recorded ${history.join(", ")}, so they can't be deleted. Deactivate them instead - that blocks login and keeps the records.`,
    });
  }

  await user.deleteOne();
  res.json({ message: "User deleted." });
});

router.post(
  "/:id/reset-password",
  [
    body("newPassword")
      .isLength({ min: 6, max: 15 })
      .withMessage("Password must be between 6 and 15 characters."),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: errors.array()[0].msg });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "No records found." });
    }

    user.passwordHash = await bcrypt.hash(req.body.newPassword, 10);
    await user.save();

    res.json({ message: "Password reset." });
  }
);

export default router;
