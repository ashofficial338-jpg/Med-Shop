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
  // Products. Everyone can view products; these unlock changing them.
  { key: "products.add", label: "Add products", description: "Add new products (with opening stock) and import them from Excel." },
  { key: "products.edit", label: "Edit products", description: "Edit product details and move products to another rack position." },
  { key: "products.delete", label: "Delete products", description: "Delete products that have no stock left." },
  // Stock entries (a product's batches): edit their details or delete them.
  { key: "stock.edit", label: "Edit stock", description: "Change a batch's number, expiry, quantity on hand or rack position." },
  { key: "stock.delete", label: "Delete stock", description: "Delete a batch, writing off whatever quantity is left in it." },
  // Rack management (Rack Finder -> Manage Racks). Everyone can view racks.
  { key: "racks.add", label: "Add racks", description: "Add new racks (A to Z) and choose their number of positions." },
  { key: "racks.edit", label: "Edit racks", description: "Change how many positions a rack has." },
  { key: "racks.delete", label: "Delete racks", description: "Delete racks. Products on a deleted rack move to No Rack." },
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

export function hasPermission(user, key) {
  return user?.role === "admin" || (user?.permissions || []).includes(key);
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
