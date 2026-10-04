import mongoose from "mongoose";

// Interest, Taxes, Depreciation and Amortization are the items EBITDA adds
// back to Net Profit (see dashboard.js). Depreciation/Amortization are
// book entries, not money paid out, so they're always "Non-cash".
export const EBITDA_ADDBACKS = ["Interest", "Taxes", "Depreciation", "Amortization"];
export const NON_CASH_CATEGORIES = ["Depreciation", "Amortization"];
export const EXPENSE_CATEGORIES = ["Rent", "Salary", "Utilities", "Other", ...EBITDA_ADDBACKS];
export const EXPENSE_PAYMENT_MODES = ["Cash", "UPI", "Card", "Other", "Non-cash"];

const expenseSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      enum: EXPENSE_CATEGORIES,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0.01,
    },
    // Which cash bucket this expense drew from - the Day Book (dayBookHelpers.js)
    // uses this to attribute outflows to Cash/UPI; Card/Other sit outside those
    // tracked buckets, same as on Sale/CustomerPayment/SupplierPayment.
    // "Non-cash" (depreciation/amortization) never touches a cash bucket.
    paymentMode: {
      type: String,
      enum: EXPENSE_PAYMENT_MODES,
      default: "Cash",
    },
    date: {
      type: Date,
      required: true,
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Expense", expenseSchema);
