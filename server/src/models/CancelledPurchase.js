import mongoose from "mongoose";

// A Purchase Invoice that was cancelled (or deleted). Its stock and payments
// were reversed and it left every report and balance; this copy keeps it in
// the transaction history. The stock ledger still holds both the original
// stock-in and its reversal (refId = purchaseId).
const cancelledPurchaseSchema = new mongoose.Schema(
  {
    purchaseId: { type: mongoose.Schema.Types.ObjectId, required: true },
    piNo: { type: String, default: "" },
    invoiceNo: { type: String, default: "" },
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", default: null },
    purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: "PurchaseOrder", default: null },
    date: { type: Date },
    total: { type: Number, default: 0 },
    reason: { type: String, trim: true, default: "" },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

cancelledPurchaseSchema.index({ createdAt: -1 });
cancelledPurchaseSchema.index({ purchaseOrder: 1 });

export default mongoose.model("CancelledPurchase", cancelledPurchaseSchema);
