// Mirrors server/src/utils/permissions.js. Admins have every permission plus
// the interactive dashboard (click-through, filters, exports, reports);
// everyone else gets only what an Admin grants on Roles & Permissions.
export const PERMISSIONS = [
  { key: "dashboard.view", label: "View dashboard", description: "Open the accounting dashboard (view only, last 30 days)." },
  { key: "dashboard.profit", label: "Profit & EBITDA", description: "Profit & Loss, EBITDA and product profitability / ROI figures." },
  { key: "dashboard.sales", label: "Sales & GST", description: "Sales count, GST, sales trend, revenue by category and top sellers." },
  { key: "dashboard.cash", label: "Cash position", description: "Today's cash, UPI and credit balances and cash flow." },
  { key: "dashboard.stock", label: "Stock", description: "Stock value, inventory turnover, low stock and expiring batches." },
  { key: "dashboard.receivables", label: "Receivables & payables", description: "Money owed to and by the shop." },
];

export const isAdmin = (user) => user?.role === "admin";

export function can(user, key) {
  return isAdmin(user) || (user?.permissions || []).includes(key);
}
