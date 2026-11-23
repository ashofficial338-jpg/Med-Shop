import jwt from "jsonwebtoken";

// Pinned so a token can't pick its own algorithm.
const ALGORITHM = "HS256";

export function signToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role },
    process.env.JWT_SECRET,
    { algorithm: ALGORITHM, expiresIn: process.env.JWT_EXPIRES_IN || "12h" }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET, { algorithms: [ALGORITHM] });
}
