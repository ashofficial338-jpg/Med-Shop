// Permissions an Admin can grant to non-admin users on the Roles & Permissions
// page. Admins implicitly have every permission plus the interactive parts of
// the dashboard (click-through, filters, exports, reports), which are never
// grantable - non-admins only ever get a view-only dashboard.
//
// Keep in sync with client/src/utils/permissions.js.
export const PERMISSIONS = [
  { key: "dashboard.view", label: "View dashboard", description: "Open the accounting dashboard (view only, last 30 days)." },
  { key: "dashboard.profit", label: "Profit & EBITDA", description: "Profit & Loss, EBITDA and product profitability / ROI figures." },
  { key: "dashboard.sales", label: "Sales & GST", description: "Sales count, GST, sales trend, revenue by category and top sellers." },
  { key: "dashboard.cash", label: "Cash position", description: "Today's cash, UPI and credit balances and cash flow." },
  { key: "dashboard.stock", label: "Stock", description: "Stock value, inventory turnover, low stock and expiring batches." },
  { key: "dashboard.receivables", label: "Receivables & payables", description: "Money owed to and by the shop." },
  // Reports & Analytics: full financial figures for any period and filter.
  { key: "reports.view", label: "View reports & analytics", description: "Open Reports & Analytics: P&L, trends, GST, inventory and transaction history, any period." },
  { key: "reports.export", label: "Export reports", description: "Download Reports & Analytics as PDF or Excel. Needs “View reports & analytics”." },
  // Adding new entries can be granted. Editing, modifying or deleting any
  // existing entry is Admin-only and can't be granted (see ADMIN_ONLY_KEYS).
  { key: "products.add", label: "Add products", description: "Add new products (with opening stock) and import new products from Excel." },
  { key: "racks.add", label: "Add racks", description: "Add new racks (A to Z) and choose their number of positions." },
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

// Editing or deleting existing entries: only an Admin, never grantable. A
// user who was granted one of these before keeps nothing from it.
export const ADMIN_ONLY_KEYS = ["products.edit", "products.delete", "stock.edit", "stock.delete", "racks.edit", "racks.delete"];

export function hasPermission(user, key) {
  if (user?.role === "admin") return true;
  if (ADMIN_ONLY_KEYS.includes(key)) return false;
  return (user?.permissions || []).includes(key);
}

// Keeps only known keys, without duplicates.
export function sanitizePermissions(list) {
  return Array.isArray(list) ? [...new Set(list.filter((k) => PERMISSION_KEYS.includes(k)))] : [];
}

// Passes when the user has at least one of `keys` (admins always pass).
export function requireAnyPermission(...keys) {
  return (req, res, next) => {
    if (!keys.some((key) => hasPermission(req.user, key))) {
      return res.status(403).json({ message: "You do not have permission to perform this action." });
    }
    next();
  };
}

export function requirePermission(key) {
  return (req, res, next) => {
    if (!hasPermission(req.user, key)) {
      return res.status(403).json({ message: "You do not have permission to perform this action." });
    }
    next();
  };
}
