import mongoose from "mongoose";

// Goods sent back to the supplier from one Purchase Invoice. Confirming it
// takes the stock off the exact batches that invoice brought in; cancelling
// it puts the stock back. Both moves are in the stock ledger (refId = this).
const returnItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", required: true },
    batchNo: { type: String, default: "" },
    qtyPacks: { type: Number, required: true, min: 1 },
    qtyUnits: { type: Number, required: true, min: 1 }, // stock units taken off
    rate: { type: Number, default: 0 }, // net cost per pack on the invoice
    gstPercent: { type: Number, default: 0 },
    lineAmount: { type: Number, required: true },
    lineGst: { type: Number, required: true },
  },
  { _id: false }
);

const purchaseReturnSchema = new mongoose.Schema(
  {
    returnNo: { type: String, required: true, trim: true },
    purchase: { type: mongoose.Schema.Types.ObjectId, ref: "Purchase", required: true },
    purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: "PurchaseOrder", default: null },
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", default: null },
    // The invoice's numbers, kept so the return reads the same forever.
    invoiceNo: { type: String, default: "" },
    piNo: { type: String, default: "" },
    date: { type: Date, required: true },
    items: { type: [returnItemSchema], validate: (v) => Array.isArray(v) && v.length > 0 },
    subtotal: { type: Number, required: true },
    gstAmount: { type: Number, required: true },
    total: { type: Number, required: true },
    reason: { type: String, trim: true, maxlength: 200, default: "" },
    notes: { type: String, trim: true, maxlength: 1000, default: "" },
    status: { type: String, enum: ["Confirmed", "Cancelled"], default: "Confirmed" },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    cancelReason: { type: String, trim: true, default: "" },
    clientRef: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

purchaseReturnSchema.index({ returnNo: 1 }, { unique: true });
purchaseReturnSchema.index({ purchase: 1, status: 1 });
purchaseReturnSchema.index({ vendor: 1, date: -1 });
purchaseReturnSchema.index({ date: -1 });
purchaseReturnSchema.index({ clientRef: 1 }, { unique: true, partialFilterExpression: { clientRef: { $type: "string" } } });

export default mongoose.model("PurchaseReturn", purchaseReturnSchema);
