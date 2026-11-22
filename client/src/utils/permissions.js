// Mirrors server/src/utils/permissions.js. Admins have every permission plus
// the interactive dashboard (click-through, filters, exports, reports);
// everyone else gets only what an Admin grants on Roles & Permissions.
export const PERMISSIONS = [
  { key: "dashboard.view", label: "View dashboard", description: "Open the accounting dashboard (view only, last 30 days).", group: "dashboard" },
  { key: "dashboard.profit", label: "Profit & EBITDA", description: "Profit & Loss, EBITDA and product profitability / ROI figures.", group: "dashboard" },
  { key: "dashboard.sales", label: "Sales & GST", description: "Sales count, GST, sales trend, revenue by category and top sellers.", group: "dashboard" },
  { key: "dashboard.cash", label: "Cash position", description: "Today's cash, UPI and credit balances and cash flow.", group: "dashboard" },
  { key: "dashboard.stock", label: "Stock", description: "Stock value, inventory turnover, low stock and expiring batches.", group: "dashboard" },
  { key: "dashboard.receivables", label: "Receivables & payables", description: "Money owed to and by the shop.", group: "dashboard" },
  // Reports & Analytics: full financial figures for any period and filter.
  { key: "reports.view", label: "View reports & analytics", description: "Open Reports & Analytics: P&L, trends, GST, inventory and transaction history, any period.", group: "reports" },
  { key: "reports.export", label: "Export reports", description: "Download Reports & Analytics as PDF or Excel. Needs “View reports & analytics”.", group: "reports" },
  // Adding new entries can be granted. Editing, modifying or deleting any
  // existing entry is Admin-only and can't be granted (see ADMIN_ONLY_KEYS).
  { key: "products.add", label: "Add products", description: "Add new products (with opening stock) and import new products from Excel.", group: "products" },
  { key: "racks.add", label: "Add racks", description: "Add new racks (A to Z) and choose their number of positions.", group: "racks" },
];

export const DASHBOARD_PERMISSIONS = PERMISSIONS.filter((p) => p.group === "dashboard");
export const REPORT_PERMISSIONS = PERMISSIONS.filter((p) => p.group === "reports");
export const PRODUCT_PERMISSIONS =PERMISSIONS.filter((p) => p.group === "products");
export const RACK_PERMISSIONS = PERMISSIONS.filter((p) => p.group === "racks");

export const isAdmin = (user) => user?.role === "admin";

// Editing or deleting existing entries is only ever for an Admin - other
// users are view-only, whatever they were granted before.
export const ADMIN_ONLY_KEYS = ["products.edit", "products.delete", "stock.edit", "stock.delete", "racks.edit", "racks.delete"];

export function can(user, key) {
  if (isAdmin(user)) return true;
  if (ADMIN_ONLY_KEYS.includes(key)) return false;
  return (user?.permissions || []).includes(key);
}
