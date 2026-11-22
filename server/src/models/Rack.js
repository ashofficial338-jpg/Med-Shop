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
    // Optional friendly name, e.g. "Antibiotics wall".
    name: { type: String, trim: true, maxlength: 60, default: "" },
    // Physical layout. Positions are numbered shelf by shelf, row by row,
    // bin by bin, so position n always maps to one Shelf / Row / Bin (see
    // utils/rack.js describePosition). positions = shelves x rows x bins.
    // Older racks read as 1 shelf x 1 row x <positions> bins.
    shelves: { type: Number, min: 1, max: 99, default: 1 },
    rowsPerShelf: { type: Number, min: 1, max: 99, default: 1 },
    binsPerRow: { type: Number, min: 1, max: 999, default: null },
    // How many packs one bin holds - for capacity tracking. 0 = not tracked.
    binCapacity: { type: Number, min: 0, max: 100000, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model("Rack", rackSchema);
