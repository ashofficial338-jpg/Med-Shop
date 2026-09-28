const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function money(n) {
  return `₹${inr.format(Math.round(Number(n || 0)))}`;
}

export function money2(n) {
  return `₹${inr2.format(Number(n || 0))}`;
}

// Indian-style compact figures for axes: ₹950, ₹12.4K, ₹3.2L, ₹1.1Cr
export function moneyCompact(n) {
  const v = Math.abs(Number(n || 0));
  const sign = n < 0 ? "-" : "";
  if (v >= 1e7) return `${sign}₹${trim(v / 1e7)}Cr`;
  if (v >= 1e5) return `${sign}₹${trim(v / 1e5)}L`;
  if (v >= 1e3) return `${sign}₹${trim(v / 1e3)}K`;
  return `${sign}₹${Math.round(v)}`;
}

function trim(x) {
  return x >= 100 ? Math.round(x).toString() : x.toFixed(1).replace(/\.0$/, "");
}

export function count(n) {
  return inr.format(Number(n || 0));
}

export function shortDate(iso) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export function fullDate(iso) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function daysUntil(iso) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return Math.round((new Date(iso).setHours(0, 0, 0, 0) - start) / 86400000);
}
