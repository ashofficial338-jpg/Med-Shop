// Inclusive whole-day range for yyyy-mm-dd query params: `to` covers that
// entire day (new Date("2026-10-04") alone is midnight, which would drop
// everything recorded later that day). Same day boundaries as the dashboard.
export function dayRange(from, to) {
  if (!from && !to) return null;
  const range = {};
  if (from) {
    const start = new Date(from);
    start.setHours(0, 0, 0, 0);
    range.$gte = start;
  }
  if (to) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    range.$lte = end;
  }
  return range;
}
