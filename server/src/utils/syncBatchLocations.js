import Batch from "../models/Batch.js";
import { locationsInSync, effectiveLocations } from "./locations.js";

// Idempotent startup pass: gives every batch recorded before multi-location
// stock its locations (all of it on its own rack), so rack reports, audits
// and transfers see real data straight away. Only touches batches that are
// out of sync; safe to run on every boot.
export async function syncBatchLocations() {
  let fixed = 0;
  const cursor = Batch.find({ $or: [{ qtyRemaining: { $gt: 0 } }, { "locations.0": { $exists: true } }] }).cursor();
  for await (const batch of cursor) {
    if (locationsInSync(batch)) continue;
    await Batch.updateOne({ _id: batch._id }, { $set: { locations: effectiveLocations(batch) } });
    fixed += 1;
  }
  if (fixed) console.log(`Rack locations synced for ${fixed} batch${fixed === 1 ? "" : "es"}.`);
}
