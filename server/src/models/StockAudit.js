import mongoose from "mongoose";

// A physical stock count of one rack, shelf or position, compared with what
// the system holds there. Kept even when not applied, as the audit trail.
const stockAuditSchema = new mongoose.Schema(
  {
    scope: { type: String, required: true, trim: true, uppercase: true }, // "A", "A-S2" or "A-014"
    lines: [
      {
        product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
        productName: { type: String, default: "" },
        batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", required: true },
        batchNo: { type: String, default: "" },
        rack: { type: String, default: "" },
        systemQty: { type: Number, required: true },
        physicalQty: { type: Number, required: true },
        difference: { type: Number, required: true }, // physical - system, in internal units
        _id: false,
      },
    ],
    // Applied audits corrected stock to the physical counts.
    applied: { type: Boolean, default: false },
    note: { type: String, trim: true, maxlength: 300, default: "" },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

stockAuditSchema.index({ scope: 1, createdAt: -1 });

export default mongoose.model("StockAudit", stockAuditSchema);
