import mongoose from "mongoose";

// A Purchase Order: what was ordered from a supplier. It never moves stock -
// stock comes in only when a Purchase Invoice (a Purchase) is saved against
// it. How much of each line has arrived is worked out from those invoices
// (utils/purchaseOrders.js), which also keeps `status` up to date.
const poItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    qty: { type: Number, required: true, min: 1 }, // packs
    rate: { type: Number, default: 0, min: 0 }, // per pack, before discount
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    gstPercent: { type: Number, default: 0, min: 0 },
    lineAmount: { type: Number, required: true }, // after discount, before GST
    lineGst: { type: Number, required: true },
    lineTotal: { type: Number, required: true },
  },
  { _id: false }
);

export const PO_STATUSES = ["Draft", "Pending", "Partially Received", "Completed", "Cancelled"];

const purchaseOrderSchema = new mongoose.Schema(
  {
    poNo: { type: String, required: true, trim: true },
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true },
    date: { type: Date, required: true },
    expectedDate: { type: Date, default: null },
    items: { type: [poItemSchema], validate: (v) => Array.isArray(v) && v.length > 0 },
    grossAmount: { type: Number, required: true }, // before discount
    discountAmount: { type: Number, default: 0 },
    subtotal: { type: Number, required: true }, // after discount, before GST
    gstAmount: { type: Number, required: true },
    total: { type: Number, required: true },
    notes: { type: String, trim: true, maxlength: 1000, default: "" },
    status: { type: String, enum: PO_STATUSES, default: "Draft" },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    cancelReason: { type: String, trim: true, default: "" },
    clientRef: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    editedAt: { type: Date, default: null },
    editedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

purchaseOrderSchema.index({ poNo: 1 }, { unique: true });
purchaseOrderSchema.index({ vendor: 1, date: -1 });
purchaseOrderSchema.index({ status: 1, date: -1 });
purchaseOrderSchema.index({ date: -1 });
purchaseOrderSchema.index({ clientRef: 1 }, { unique: true, partialFilterExpression: { clientRef: { $type: "string" } } });

export default mongoose.model("PurchaseOrder", purchaseOrderSchema);
