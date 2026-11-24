import mongoose from "mongoose";

// Who cleared the transaction records, when, and what went. Never cleared itself.
const maintenanceLogSchema = new mongoose.Schema(
  {
    action: { type: String, default: "clear-transactions" },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    options: { type: Object, default: {} },
    counts: { type: Object, default: {} },
  },
  { timestamps: true, minimize: false }
);

export default mongoose.model("MaintenanceLog", maintenanceLogSchema);
