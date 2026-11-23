import mongoose from "mongoose";

// Sales Entry: a Tally-style sales voucher typed in on the Sales Entry
// screen. It does NOT touch stock (POS billing does that) - items can be
// picked from the product list to fill in name/HSN/rate/GST, or typed freely.
//
// Its invoice number (archiveNo, e.g. SALES-001) comes from the same counter
// the Invoice Saver uses for POS bills, so one SALES-xxx series covers both
// and two files in reports\sales can never share a name. It's given out when
// the entry is saved and never changes, even when the entry is edited.
// All amounts are worked out on the server - see utils/salesEntryCalc.js.

const itemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null }, // only when picked from the product list
    name: { type: String, required: true, trim: true, maxlength: 200 },
    hsnCode: { type: String, trim: true, default: "", maxlength: 20 },
    qty: { type: Number, required: true, min: 0 },
    unit: { type: String, trim: true, default: "Nos", maxlength: 30 },
    rate: { type: Number, required: true, min: 0 },
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    gstPercent: { type: Number, required: true, enum: [0, 5, 12, 18, 28] },
    amount: { type: Number, required: true }, // qty x rate
    discountAmount: { type: Number, required: true },
    taxableAmount: { type: Number, required: true }, // amount - discount
    cgst: { type: Number, required: true },
    sgst: { type: Number, required: true },
    igst: { type: Number, required: true },
    total: { type: Number, required: true }, // taxable + tax
  },
  { _id: false }
);

const salesEntrySchema = new mongoose.Schema(
  {
    // SALES-001, SALES-002, ... (named archiveNo so the Invoice Saver can save
    // it exactly like a POS bill - see utils/invoiceArchive.js).
    archiveNo: { type: String, required: true },
    invoiceDate: { type: Date, required: true },
    customer: {
      name: { type: String, trim: true, default: "", maxlength: 120 },
      address: { type: String, trim: true, default: "", maxlength: 300 },
      gstin: { type: String, trim: true, uppercase: true, default: "", maxlength: 15 },
      mobile: { type: String, trim: true, default: "", maxlength: 10 },
    },
    // Inter-state supply: IGST instead of CGST + SGST.
    interState: { type: Boolean, default: false },
    items: {
      type: [itemSchema],
      validate: (v) => Array.isArray(v) && v.length > 0,
    },
    subtotal: { type: Number, required: true }, // sum of qty x rate
    discountTotal: { type: Number, required: true },
    taxableTotal: { type: Number, required: true },
    cgstTotal: { type: Number, required: true },
    sgstTotal: { type: Number, required: true },
    igstTotal: { type: Number, required: true },
    roundOff: { type: Number, required: true },
    grandTotal: { type: Number, required: true },
    amountInWords: { type: String, default: "" },
    paymentMode: { type: String, enum: ["Cash", "UPI", "Card", "Bank Transfer", "Credit"], default: "Cash" },
    notes: { type: String, trim: true, default: "", maxlength: 500 },
    // Paid now (all of it, except on a credit sale).
    amountReceived: { type: Number, default: 0 },
    // The POS bill this entry made (stock, ledger, payments, reports) and the
    // customer it's on. Entries saved before sales were linked have none.
    sale: { type: mongoose.Schema.Types.ObjectId, ref: "Sale", default: null },
    customerRef: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    editedAt: { type: Date, default: null },
    editedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Invoice Saver bookkeeping - same meaning as on Sale (see models/Sale.js).
    archivedAt: { type: Date, default: null },
    archiveVersion: { type: Number, default: 0 },
    archiveCopies: { type: Number, default: 0 },
    archiveChange: { type: String, enum: ["edited", "void"], default: "edited" },
  },
  { timestamps: true }
);

salesEntrySchema.index({ archiveNo: 1 }, { unique: true });
salesEntrySchema.index({ invoiceDate: -1, createdAt: -1 });
salesEntrySchema.index({ archivedAt: 1, createdAt: 1 });
salesEntrySchema.index({ "customer.name": 1 });

export default mongoose.model("SalesEntry", salesEntrySchema);
