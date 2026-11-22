import mongoose from "mongoose";
import { DOSAGE_FORMS, RELEASE_TYPES } from "../utils/composition.js";

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
    },
    // Manufacturer / marketing brand (e.g. "Cipla", "Sun Pharma"). Optional -
    // used for brand-wise sales reports; blank reads as "Unbranded".
    brand: {
      type: String,
      trim: true,
      maxlength: 80,
      default: "",
    },
    productCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    image: {
      type: String,
      default: "",
    },
    // Medicine identity. `name` is the brand name (e.g. "Dolo 650"); each
    // brand is its own product with its own stock and batches. Brands that
    // share composition + strength + dosage form + release type form one
    // Composition Group (see utils/composition.js) - for search and reports
    // only, never for stock: same composition doesn't mean interchangeable.
    genericName: { type: String, trim: true, maxlength: 150, default: "" },
    // Active ingredient(s), e.g. "Paracetamol" or "Amoxicillin + Clavulanic Acid".
    composition: { type: String, trim: true, maxlength: 300, default: "" },
    dosageForm: { type: String, enum: DOSAGE_FORMS, default: "" },
    releaseType: { type: String, enum: RELEASE_TYPES, default: "" },
    manufacturer: { type: String, trim: true, maxlength: 120, default: "" },
    barcode: { type: String, trim: true, maxlength: 64, default: "" },
    strengthValue: {
      type: Number,
      min: 0,
    },
    strengthUnit: {
      type: String,
      enum: ["mg", "mcg", "ml", "g", ""],
      default: "",
    },
    soldAs: {
      type: String,
      enum: ["pack-only", "pack-and-loose"],
      default: "pack-only",
      required: true,
    },
    packUnit: {
      type: String,
      enum: ["Strip", "Bottle", "Box", "Tube", "Vial", "Jar", "Piece"],
      default: "Strip",
    },
    unitsPerPack: {
      type: Number,
      min: 1,
      required: function () {
        return this.soldAs === "pack-and-loose";
      },
    },
    looseUnitName: {
      type: String,
      enum: ["Tablet", "Capsule", "ml", "Piece", ""],
      default: "",
      required: function () {
        return this.soldAs === "pack-and-loose";
      },
    },
    qty: {
      type: Number,
      default: 0,
      min: 0,
    },
    packRate: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Always server-computed as packRate / unitsPerPack (rounded to 2dp) - see
    // productHelpers.computeLooseRate. Never accepted as manual input: stock
    // always arrives in packs, so there's no independent "loose cost" to key in.
    looseRate: {
      type: Number,
      min: 0,
      required: function () {
        return this.soldAs === "pack-and-loose";
      },
    },
    gstPercent: {
      type: Number,
      enum: [0, 5, 12, 18, 28],
      default: 0,
    },
    hsnCode: {
      type: String,
      trim: true,
      default: "",
    },
    // Batch/lot number, expiry date, and cost price now live on Batch (a
    // product can have several lots on the shelf at once, each with its own
    // expiry and cost) - see server/src/models/Batch.js.
    lowStockThreshold: {
      type: Number,
      default: 10,
      min: 0,
    },
    // Physical shelf/rack the product is stored on (e.g. "D", "A3"), so staff
    // can look up where to pick it from. Blank means not yet assigned.
    rack: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 20,
      default: "",
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

productSchema.index({ name: "text", productCode: "text" });
productSchema.index({ rack: 1 });
productSchema.index({ brand: 1 });
productSchema.index({ barcode: 1 });
productSchema.index({ composition: 1 });

export default mongoose.model("Product", productSchema);
