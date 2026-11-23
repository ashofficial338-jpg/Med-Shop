import mongoose from "mongoose";
import User from "../models/User.js";
import { verifyToken } from "../utils/token.js";

// Every 401 carries a `code` so the client can tell the user why their
// session ended: NO_TOKEN (not signed in), TOKEN_EXPIRED (JWT_EXPIRES_IN
// passed), TOKEN_INVALID (bad signature - e.g. JWT_SECRET was changed - or a
// malformed token) and SESSION_REVOKED (account deleted or deactivated).
function unauthorized(res, code, message) {
  return res.status(401).json({ code, message });
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const token = match ? match[1] : null;

  if (!token) {
    return unauthorized(res, "NO_TOKEN", "Not authenticated. Please sign in.");
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return unauthorized(res, "TOKEN_EXPIRED", "Your session has expired. Please sign in again.");
    }
    return unauthorized(res, "TOKEN_INVALID", "Session is no longer valid. Please sign in again.");
  }
  if (!mongoose.isValidObjectId(payload.sub)) {
    return unauthorized(res, "TOKEN_INVALID", "Session is no longer valid. Please sign in again.");
  }

  // Database errors are not auth failures: they go to the error handler (500)
  // so a database hiccup never signs anyone out.
  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) {
    return unauthorized(res, "SESSION_REVOKED", "Session is no longer valid. Please sign in again.");
  }

  req.user = user;
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "You do not have permission to perform this action." });
    }
    next();
  };
}
