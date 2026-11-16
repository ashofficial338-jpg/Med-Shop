import { AsyncLocalStorage } from "node:async_hooks";

// Report builders call each other (the consolidated report builds analytics
// three times, each of which builds summaries) and so kept re-reading the same
// things - stock on hand, outstanding balances, the period's sales. Inside
// withReadCache, identical reads are done once and shared.
//
// The cache lives only for the one call it wraps, so nothing is ever stale:
// the next request reads everything fresh. Outside withReadCache, `cached`
// just runs the loader. Cached values are shared between callers, so treat
// them as read-only.
const scope = new AsyncLocalStorage();

export function withReadCache(fn) {
  return scope.getStore() ? fn() : scope.run(new Map(), fn);
}

export function cached(key, load) {
  const cache = scope.getStore();
  if (!cache) return load();
  // Promise.resolve turns a Mongoose query into a real promise, so it runs
  // once however many callers await it (a query re-runs - and errors - if
  // awaited twice).
  if (!cache.has(key)) cache.set(key, Promise.resolve(load()));
  return cache.get(key);
}
