// Multi-location stock: a batch's quantity on hand can sit on several rack
// positions at once (Batch.locations = [{ rack, qty }], rack "" = No Rack).
// Invariant: the locations always add up to Batch.qtyRemaining, which stays
// the single source of truth for the batch's stock. Pure helpers only - no
// model imports, so the Batch model itself can use them.

// Pick order within a batch: its primary rack first, then the rest as stored.
export function pickOrder(locations, primary) {
  const list = [...locations];
  list.sort((a, b) => (a.rack === primary ? -1 : 0) - (b.rack === primary ? -1 : 0));
  return list;
}

// The batch's locations made to agree with qtyRemaining, without saving.
// Old batches (before locations existed) read as all stock on batch.rack.
// Extra stock lands on the primary rack; missing stock is taken from the
// primary rack first - the same order a sale picks in.
export function effectiveLocations(batch) {
  const primary = batch.rack || "";
  const merged = new Map();
  for (const l of batch.locations || []) {
    const rack = l.rack || "";
    if (l.qty > 0) merged.set(rack, (merged.get(rack) || 0) + l.qty);
  }
  let locs = [...merged.entries()].map(([rack, qty]) => ({ rack, qty }));
  const target = Math.max(batch.qtyRemaining || 0, 0);
  const sum = locs.reduce((s, l) => s + l.qty, 0);
  if (sum < target) {
    const home = locs.find((l) => l.rack === primary);
    if (home) home.qty += target - sum;
    else locs.push({ rack: primary, qty: target - sum });
  } else if (sum > target) {
    let extra = sum - target;
    for (const l of pickOrder(locs, primary)) {
      const take = Math.min(l.qty, extra);
      l.qty -= take;
      extra -= take;
      if (extra <= 0) break;
    }
  }
  locs = locs.filter((l) => l.qty > 0);
  return pickOrder(locs, primary);
}

// True when the stored locations already match (no write needed).
export function locationsInSync(batch) {
  const eff = effectiveLocations(batch);
  const stored = (batch.locations || []).filter((l) => l.qty > 0);
  if (eff.length !== stored.length) return false;
  return eff.every((e) => stored.some((s) => (s.rack || "") === e.rack && s.qty === e.qty));
}
