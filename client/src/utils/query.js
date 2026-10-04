// "/bills" + { from: "2026-10-01", status: "" } -> "/bills?from=2026-10-01".
// Empty values are dropped so links only carry the filters actually set.
export function withQuery(path, params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
  ).toString();
  return qs ? `${path}?${qs}` : path;
}

// Drops empty values from a params object before it goes to the API.
export function compactParams(params = {}) {
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));
}
