// Today's date as "YYYY-MM-DD" in the user's own time zone, for date inputs.
// (toISOString() is UTC: in India it gives yesterday's date until 5:30 AM.)
export function todayLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
