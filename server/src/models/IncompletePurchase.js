import mongoose from "mongoose";

// An uploaded Extra Purchase row without enough to identify an item and a
// quantity. Kept exactly as entered - it changes no stock - until someone
// completes it (it then becomes a purchase line) or discards it.
const incompletePurchaseSchema = new mongoose.Schema(
  {
    refNo: { type: String, required: true, trim: true }, // INC-000001
    importBatch: { type: mongoose.Schema.Types.ObjectId, ref: "ExtraImport", default: null },
    row: { type: Number, default: 0 },
    purchaseDate: { type: String, default: "" }, // YYYY-MM-DD, or blank
    supplierName: { type: String, trim: true, default: "" },
    invoiceNo: { type: String, trim: true, default: "" },
    itemCode: { type: String, trim: true, default: "" },
    itemName: { type: String, trim: true, default: "" },
    category: { type: String, trim: true, default: "" },
    qty: { type: Number, default: null },
    unit: { type: String, trim: true, default: "" },
    rate: { type: Number, default: null },
    discount: { type: Number, default: null },
    gst: { type: Number, default: null },
    totalAmount: { type: Number, default: null },
    remarks: { type: String, trim: true, default: "" },
    missing: { type: String, default: "" }, // what stops it, e.g. "item and quantity"
    status: { type: String, enum: ["Open", "Completed", "Discarded"], default: "Open" },
    purchase: { type: mongoose.Schema.Types.ObjectId, ref: "Purchase", default: null },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    closedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

incompletePurchaseSchema.index({ refNo: 1 }, { unique: true });
incompletePurchaseSchema.index({ status: 1, createdAt: -1 });
incompletePurchaseSchema.index({ importBatch: 1 });

export default mongoose.model("IncompletePurchase", incompletePurchaseSchema);
