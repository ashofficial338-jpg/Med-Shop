import mongoose from "mongoose";
import { effectiveLocations, locationsInSync } from "../utils/locations.js";

// One row per physical lot/delivery of a product. Replaces the old single
// batchNo/expiryDate/costPrice fields that used to live directly on Product
// (which got silently overwritten every time a new purchase came in for the
// same product - losing the older, still-on-shelf batch's expiry entirely).
// qtyReceived is the immutable original amount; qtyRemaining is what's still
// on hand from this specific lot and is what sales/adjustments/clearance deduct.
const batchSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    batchNo: {
      type: String,
      required: true,
      trim: true,
      maxlength: 30,
    },
    expiryDate: {
      type: Date,
      required: true,
    },
    costPrice: {
      type: Number,
      required: true,
      min: 0, // per Pack Unit, for this lot specifically
    },
    qtyReceived: {
      type: Number,
      required: true,
      min: 0,
    },
    qtyRemaining: {
      type: Number,
      required: true,
      min: 0,
    },
    // Rack this lot was shelved on when it came in.
    rack: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 20,
      default: "",
    },
    // Where this batch's stock physically is, possibly split across several
    // rack positions (same brand + batch on more than one shelf). Always adds
    // up to qtyRemaining - kept true by the pre-save hook below and by the
    // atomic sale/transfer updates in batchHelpers.js. `rack` above is the
    // primary location (where it was first shelved / is picked from first).
    locations: {
      type: [
        {
          rack: { type: String, trim: true, uppercase: true, maxlength: 20, default: "" },
          qty: { type: Number, min: 0, required: true },
          _id: false,
        },
      ],
      default: [],
    },
    receivedAt: {
      type: Date,
      required: true,
    },
    purchase: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Purchase",
      default: null,
    },
    // Set when someone deletes this stock entry (its remaining qty is written
    // off). Kept rather than removed: past sales and purchases reference it.
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Any save that changed qtyRemaining without saying where (manual adjust,
// batch edit, write-off...) is squared up here: extra stock goes onto the
// primary rack, removed stock comes off the primary rack first.
batchSchema.pre("save", function () {
  if (!locationsInSync(this)) this.locations = effectiveLocations(this);
});

batchSchema.index({ product: 1, batchNo: 1 }, { unique: true });
batchSchema.index({ "locations.rack": 1 });
batchSchema.index({ product: 1, qtyRemaining: 1, expiryDate: 1 });

export default mongoose.model("Batch", batchSchema);
