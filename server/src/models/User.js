import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    // Optional. Unique only when present (partial index below). A user with
    // no email signs in with their username, which must then be unique.
    email: {
      type: String,
      lowercase: true,
      trim: true,
      maxlength: 50,
      set: (v) => (v === null || v === undefined || String(v).trim() === "" ? undefined : v),
    },
    username: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },
    role: {
      type: String,
      enum: ["admin", "staff"],
      default: "staff",
      required: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Granted by an Admin on the Roles & Permissions page (keys from
    // utils/permissions.js). Only used for non-admins - admins have all.
    permissions: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true, autoIndex: false }
);

userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: "string" } } });

export default mongoose.model("User", userSchema);
