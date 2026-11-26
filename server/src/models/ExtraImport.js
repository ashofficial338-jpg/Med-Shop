import mongoose from "mongoose";

// One Extra Purchase Excel upload: what was in it, what became of each row,
// and the original file (so it can be downloaded again).
const extraImportSchema = new mongoose.Schema(
  {
    refNo: { type: String, required: true, trim: true }, // IMP-000001
    fileName: { type: String, trim: true, default: "" },
    fileType: { type: String, default: "" },
    fileSize: { type: Number, default: 0 },
    file: { type: Buffer, select: false },
    totalRows: { type: Number, default: 0 },
    importedRows: { type: Number, default: 0 }, // saved on a purchase, stock updated
    incompleteRows: { type: Number, default: 0 }, // kept to complete later, no stock change
    failedRows: { type: Number, default: 0 },
    purchases: [{ type: mongoose.Schema.Types.ObjectId, ref: "Purchase" }],
    totalValue: { type: Number, default: 0 },
    failures: [{ _id: false, row: Number, reason: String }],
    paymentMode: { type: String, default: "" },
    status: { type: String, enum: ["Processing", "Done"], default: "Processing" },
    clientRef: { type: String },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

extraImportSchema.index({ refNo: 1 }, { unique: true });
extraImportSchema.index({ createdAt: -1 });
extraImportSchema.index({ clientRef: 1 }, { unique: true, partialFilterExpression: { clientRef: { $type: "string" } } });

export default mongoose.model("ExtraImport", extraImportSchema);
