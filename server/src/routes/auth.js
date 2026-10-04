import { Router } from "express";
import bcrypt from "bcryptjs";
import { body, validationResult } from "express-validator";
import User from "../models/User.js";
import { signToken } from "../utils/token.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.post(
  "/login",
  [
    // `email` holds what the user typed: an email address or a username.
    body("email").isString().trim().isLength({ min: 1, max: 50 }),
    body("password").notEmpty().withMessage("Password is required."),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: "Incorrect email/username or password." });
    }

    const { password } = req.body;
    const identifier = req.body.email.trim();
    let user;
    if (identifier.includes("@")) {
      user = await User.findOne({ email: identifier.toLowerCase() });
    } else {
      // Usernames aren't unique, so only sign in by username when exactly one
      // account has it (case-insensitive, matched literally - not as a regex).
      const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const matches = await User.find({ username: new RegExp(`^${escaped}$`, "i") }).limit(2);
      if (matches.length > 1) {
        return res.status(401).json({ message: "More than one account uses this username. Please sign in with your email." });
      }
      user = matches[0];
    }

    if (!user) {
      return res.status(401).json({ message: "Incorrect email/username or password." });
    }

    if (!user.isActive) {
      return res
        .status(403)
        .json({ message: "Your account has been deactivated. Contact your administrator." });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ message: "Incorrect email/username or password." });
    }

    const token = signToken(user);
    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        role: user.role,
        permissions: user.permissions || [],
      },
    });
  }
);

router.get("/me", requireAuth, (req, res) => {
  const { _id, email, username, role, permissions } = req.user;
  res.json({ id: _id, email, username, role, permissions: permissions || [] });
});

export default router;
