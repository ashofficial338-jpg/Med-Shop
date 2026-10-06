import mongoose from "mongoose";

// A physical rack, lettered A-Z, with a fixed number of positions on it.
// Positions are named <letter>-<3-digit number>: Rack A with 20 positions
// has A-001 ... A-020. Product.rack stores one of those position codes.
const rackSchema = new mongoose.Schema(
  {
    letter: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      match: /^[A-Z]$/,
    },
    positions: {
      type: Number,
      required: true,
      min: 1,
      max: 999,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Rack", rackSchema);
