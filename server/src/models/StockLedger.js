import mongoose from "mongoose";

const stockLedgerSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      default: null,
    },
    type: {
      type: String,
      enum: ["purchase", "sale", "manual-add", "manual-reduce", "void-reversal", "stock-clearance", "rack-transfer", "stock-audit", "sale-edit", "purchase-edit"],
      required: true,
    },
    qtyChange: {
      type: Number,
      required: true,
    },
    reason: {
      type: String,
      trim: true,
      default: "",
    },
    refId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    // Rack position the stock moved in/out of ("" = No Rack; unset on
    // entries recorded before rack tracking). A transfer also sets toRack
    // and qtyMoved (its qtyChange is 0 - total stock doesn't change).
    rack: { type: String, default: undefined },
    toRack: { type: String, default: undefined },
    qtyMoved: { type: Number, default: undefined },
    costImpact: {
      type: Number,
      default: 0, // ₹ value of the loss, populated for stock-clearance so P&L can show it as its own line
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

stockLedgerSchema.index({ rack: 1, createdAt: -1 });
stockLedgerSchema.index({ toRack: 1, createdAt: -1 });

export default mongoose.model("StockLedger", stockLedgerSchema);
