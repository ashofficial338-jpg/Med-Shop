import Batch from "../models/Batch.js";
import { effectiveLocations, locationsInSync } from "./locations.js";

// Creates a new lot, or tops up an existing one if this product already has
// a batch with the same batch number (a genuine re-delivery of the same lot).
// addQty is in the product's internal stock unit (loose units for a
// pack-and-loose product, packs otherwise) - same convention as Product.qty.
export async function upsertBatch({ product, batchNo, expiryDate, costPrice, addQty, receivedAt, purchase, rack }) {
  const cleanBatchNo = String(batchNo).trim();
  let batch = await Batch.findOne({ product: product._id, batchNo: cleanBatchNo });

  if (batch) {
    topUpBatch(batch, { costPrice, addQty, receivedAt, purchase, rack });
    await batch.save();
  } else {
    batch = await Batch.create(newBatch({ product, batchNo: cleanBatchNo, expiryDate, costPrice, addQty, receivedAt, purchase, rack }));
  }
  return batch;
}

// Same lot delivered again (maybe from another supplier, at another price):
// blend the cost by quantity instead of overwriting it, so stock already on
// hand keeps being valued at what it actually cost. Not saved here.
function topUpBatch(batch, { costPrice, addQty, receivedAt, purchase, rack }) {
  const onHand = Math.max(batch.qtyRemaining, 0);
  const blended = onHand + addQty > 0 ? (onHand * batch.costPrice + addQty * Number(costPrice)) / (onHand + addQty) : Number(costPrice);
  batch.qtyReceived += addQty;
  batch.qtyRemaining += addQty;
  batch.costPrice = Number(blended.toFixed(4));
  batch.receivedAt = receivedAt || new Date();
  if (purchase) batch.purchase = purchase;
  if (rack) batch.rack = rack;
  batch.isDeleted = false; // a re-delivery of a deleted lot brings it back
}

const newBatch = ({ product, batchNo, expiryDate, costPrice, addQty, receivedAt, purchase, rack }) => ({
  product: product._id,
  batchNo,
  expiryDate,
  costPrice,
  qtyReceived: addQty,
  qtyRemaining: addQty,
  receivedAt: receivedAt || new Date(),
  purchase: purchase || null,
  rack: rack || "",
});

// upsertBatch for a whole purchase in a few round trips instead of two per
// line. Returns the batch of each entry, in order.
export async function upsertBatches(entries) {
  const key = (product, batchNo) => `${product}|${batchNo}`;
  const known = await Batch.find({ product: { $in: entries.map((e) => e.product._id) }, batchNo: { $in: entries.map((e) => e.batchNo) } });
  const byKey = new Map(known.map((b) => [key(b.product, b.batchNo), b]));
  const added = [];
  const toppedUp = new Set();
  const out = entries.map((e) => {
    const k = key(e.product._id, e.batchNo);
    let batch = byKey.get(k);
    if (batch) {
      topUpBatch(batch, e);
      if (!added.includes(batch)) toppedUp.add(batch);
    } else {
      batch = new Batch(newBatch(e));
      byKey.set(k, batch);
      added.push(batch);
    }
    return batch;
  });
  for (const b of toppedUp) await b.save();
  if (added.length) {
    // insertMany skips the model's save hook, which fills these in.
    for (const b of added) b.locations = effectiveLocations(b);
    await Batch.insertMany(added);
  }
  return out;
}

// Brings a batch's stored locations in line with its qtyRemaining (saving
// only when they differ), so the atomic per-location updates below can rely
// on them.
export async function syncedBatch(batch) {
  if (batch && !locationsInSync(batch)) {
    batch.locations = effectiveLocations(batch);
    await batch.save();
  }
  return batch;
}

export async function syncBatchById(batchId) {
  return syncedBatch(await Batch.findById(batchId));
}

// Atomically takes `qty` from one rack position of a batch (and from the
// batch total). Null when that position no longer holds enough.
function takeFromLocation(batchId, rack, qty, extra = {}) {
  return Batch.findOneAndUpdate(
    { _id: batchId, ...extra, qtyRemaining: { $gte: qty }, locations: { $elemMatch: { rack, qty: { $gte: qty } } } },
    { $inc: { qtyRemaining: -qty, "locations.$.qty": -qty } },
    { new: true }
  );
}

// Atomically puts `qty` back onto one rack position of a batch.
export async function addToLocation(batchId, rack, qty) {
  await syncBatchById(batchId);
  const r = await Batch.updateOne({ _id: batchId, "locations.rack": rack }, { $inc: { qtyRemaining: qty, "locations.$.qty": qty } });
  if (!r.matchedCount) await Batch.updateOne({ _id: batchId }, { $inc: { qtyRemaining: qty }, $push: { locations: { rack, qty } } });
}

// Moves `qty` between two rack positions of one batch in a single atomic
// update - the batch total never changes. Null if `from` lacks the stock.
export async function moveBetweenLocations(batchId, from, to, qty) {
  await syncBatchById(batchId);
  await Batch.updateOne({ _id: batchId, "locations.rack": { $ne: to } }, { $push: { locations: { rack: to, qty: 0 } } });
  return Batch.findOneAndUpdate(
    { _id: batchId, locations: { $elemMatch: { rack: from, qty: { $gte: qty } } } },
    { $inc: { "locations.$[f].qty": -qty, "locations.$[t].qty": qty } },
    { new: true, arrayFilters: [{ "f.rack": from }, { "t.rack": to }] }
  );
}

function breakdownEntry(product, batch, qty, rack) {
  const costPricePerUnit = product.soldAs === "pack-and-loose" ? batch.costPrice / product.unitsPerPack : batch.costPrice;
  return {
    batch: batch._id,
    qty,
    costPricePerUnit: Number(costPricePerUnit.toFixed(4)),
    batchNo: batch.batchNo,
    expiryDate: batch.expiryDate,
    rack,
  };
}

// Takes up to `wanted` from a batch's positions in pick order (primary rack
// first). Returns the breakdown entries for what it got.
async function takeAcrossLocations(product, batch, wanted) {
  const entries = [];
  let remaining = wanted;
  for (const loc of effectiveLocations(batch)) {
    if (remaining <= 0) break;
    const take = Math.min(loc.qty, remaining);
    if (take <= 0) continue;
    const updated = await takeFromLocation(batch._id, loc.rack, take);
    if (!updated) continue; // lost a race on this position
    entries.push(breakdownEntry(product, updated, take, loc.rack));
    remaining -= take;
  }
  return entries;
}

// First-Expiry-First-Out allocation: deducts `neededQty` internal units from
// this product's batches, earliest expiry first, and within a batch from its
// primary rack first - splitting across lots/positions when needed. Every
// decrement is a guarded atomic update (race-safe against a concurrent sale);
// if the total can't be covered, whatever was taken is put back and null is
// returned so the caller can report insufficient stock.
export async function allocateFefo(product, neededQty) {
  const batches = byExpiry(await Batch.find({ product: product._id, qtyRemaining: { $gt: 0 } }));
  let remaining = neededQty;
  const breakdown = [];
  for (const batch of batches) {
    if (remaining <= 0) break;
    await syncedBatch(batch);
    const got = await takeAcrossLocations(product, batch, Math.min(batch.qtyRemaining, remaining));
    breakdown.push(...got);
    remaining -= got.reduce((s, e) => s + e.qty, 0);
  }
  if (remaining > 0) {
    await reverseBreakdown(breakdown);
    return null;
  }
  return breakdown;
}

// Takes `neededQty` from the one lot the cashier picked - and, when `rack` is
// given, from that exact rack position only. Null if that lot/position
// doesn't belong to the product or no longer has enough: stock is never
// pulled from another position, lot or brand.
export async function allocateFromBatch(product, batchId, neededQty, rack) {
  const batch = await syncedBatch(await Batch.findOne({ _id: batchId, product: product._id, isDeleted: { $ne: true } }));
  if (!batch) return null;
  if (rack !== undefined && rack !== null) {
    const updated = await takeFromLocation(batch._id, rack, neededQty, { product: product._id });
    return updated ? [breakdownEntry(product, updated, neededQty, rack)] : null;
  }
  const got = await takeAcrossLocations(product, batch, neededQty);
  if (got.reduce((s, e) => s + e.qty, 0) < neededQty) {
    await reverseBreakdown(got);
    return null;
  }
  return got;
}

// Puts sold/allocated stock back exactly where it came from. Entries from
// before rack tracking (no rack) go back onto the batch's primary rack.
export async function reverseBreakdown(breakdown) {
  for (const entry of breakdown) {
    if (entry.rack !== undefined && entry.rack !== null) {
      await addToLocation(entry.batch, entry.rack, entry.qty);
    } else {
      await Batch.updateOne({ _id: entry.batch }, { $inc: { qtyRemaining: entry.qty } });
      await syncBatchById(entry.batch);
    }
  }
}

// Every product's stock by rack position, across its batches: Map of
// productId -> [{ rack, qty }] (largest first). `batches` are Batch docs.
export function locationsByProduct(batches) {
  const byProduct = new Map();
  for (const b of batches) {
    if (!(b.qtyRemaining > 0)) continue;
    const key = String(b.product?._id || b.product);
    const m = byProduct.get(key) || new Map();
    for (const l of effectiveLocations(b)) m.set(l.rack, (m.get(l.rack) || 0) + l.qty);
    byProduct.set(key, m);
  }
  const out = new Map();
  for (const [k, m] of byProduct) out.set(k, [...m.entries()].map(([rack, qty]) => ({ rack, qty })).sort((a, b) => b.qty - a.qty));
  return out;
}

// Keeps Product.rack (the primary / "pick here" location shown on tiles)
// pointing at a position that actually holds its stock.
export async function refreshProductRack(product) {
  const batches = await Batch.find({ product: product._id, qtyRemaining: { $gt: 0 } });
  const locs = locationsByProduct(batches).get(String(product._id)) || [];
  if (locs.length && !locs.some((l) => l.rack === (product.rack || ""))) {
    product.rack = locs[0].rack;
    await product.save();
  }
  return locs;
}

// The expiry date this product would actually be sold against next (FEFO
// order) - i.e. the batch that's about to run out first. Null if no stock.
export async function earliestActiveBatch(productId) {
  return byExpiry(await Batch.find({ product: productId, qtyRemaining: { $gt: 0 } }))[0] || null;
}

// Earliest expiry first; batches with no expiry entered go last (Mongo's
// ascending sort would put them first).
export function byExpiry(batches) {
  return [...batches].sort((a, b) => {
    if (!a.expiryDate && !b.expiryDate) return 0;
    if (!a.expiryDate) return 1;
    if (!b.expiryDate) return -1;
    return new Date(a.expiryDate) - new Date(b.expiryDate);
  });
}

// A sale recorded before batch tracking existed has no batchBreakdown to
// restore on void. Lands the returned stock back into the product's current
// earliest-expiring batch (so it re-enters the normal FEFO queue), or - if
// every batch has since been fully sold/cleared - reconstructs a placeholder
// lot from the sale line's own cost snapshot, so Product.qty and the sum of
// its batches never silently drift apart.
export async function landLegacyReturn(product, internalQty, item) {
  const existing = await earliestActiveBatch(product._id);
  if (existing) {
    existing.qtyReceived += internalQty;
    existing.qtyRemaining += internalQty;
    await existing.save();
    return existing;
  }

  const costPerInternalUnit = item.internalQtyDeducted > 0 ? item.costAmount / item.internalQtyDeducted : 0;
  const costPrice =
    product.soldAs === "pack-and-loose" ? costPerInternalUnit * product.unitsPerPack : costPerInternalUnit;

  return Batch.create({
    product: product._id,
    batchNo: "LEGACY-RETURN",
    expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    costPrice: Number(costPrice.toFixed(2)),
    qtyReceived: internalQty,
    qtyRemaining: internalQty,
    receivedAt: new Date(),
  });
}

// Weighted average cost per pack of the stock on hand: each lot's cost
// weighted by how much of it remains. Null when nothing is on hand.
export function weightedAvgCost(batches) {
  let qty = 0;
  let value = 0;
  for (const b of batches) {
    if (!(b.qtyRemaining > 0) || b.isDeleted) continue;
    qty += b.qtyRemaining;
    value += b.qtyRemaining * b.costPrice;
  }
  return qty > 0 ? Number((value / qty).toFixed(2)) : null;
}
