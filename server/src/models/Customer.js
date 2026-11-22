import mongoose from "mongoose";

const customerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      maxlength: 100,
      default: "",
    },
    // Optional. Unique only when present (partial index below), so any
    // number of customers can be saved without a phone.
    phone: {
      type: String,
      trim: true,
      match: /^\d{10}$/,
      set: (v) => (v === null || v === undefined || String(v).trim() === "" ? undefined : v),
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
    address: {
      type: String,
      trim: true,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  // Indexes are managed by utils/optionalIndexes.js (the phone index had to
  // change from unique to partial-unique on existing databases).
  { timestamps: true, autoIndex: false }
);

customerSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: "string" } } });

export default mongoose.model("Customer", customerSchema);
