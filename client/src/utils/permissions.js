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
  // Products. Everyone can view products; these unlock changing them.
  { key: "products.add", label: "Add products", description: "Add new products (with opening stock) and import them from Excel.", group: "products" },
  { key: "products.edit", label: "Edit products", description: "Edit product details and move products to another rack position.", group: "products" },
  { key: "products.delete", label: "Delete products", description: "Delete products that have no stock left.", group: "products" },
  // Stock entries (a product's batches): edit their details or delete them.
  { key: "stock.edit", label: "Edit stock", description: "Change a batch's number, expiry, quantity on hand or rack position.", group: "stock" },
  { key: "stock.delete", label: "Delete stock", description: "Delete a batch, writing off whatever quantity is left in it.", group: "stock" },
  // Rack management (Rack Finder -> Manage Racks). Everyone can view racks.
  { key: "racks.add", label: "Add racks", description: "Add new racks (A to Z) and choose their number of positions.", group: "racks" },
  { key: "racks.edit", label: "Edit racks", description: "Change how many positions a rack has.", group: "racks" },
  { key: "racks.delete", label: "Delete racks", description: "Delete racks. Products on a deleted rack move to No Rack.", group: "racks" },
];

export const DASHBOARD_PERMISSIONS = PERMISSIONS.filter((p) => p.group === "dashboard");
export const PRODUCT_PERMISSIONS = PERMISSIONS.filter((p) => p.group === "products");
export const STOCK_PERMISSIONS = PERMISSIONS.filter((p) => p.group === "stock");
export const RACK_PERMISSIONS = PERMISSIONS.filter((p) => p.group === "racks");

export const isAdmin = (user) => user?.role === "admin";

export function can(user, key) {
  return isAdmin(user) || (user?.permissions || []).includes(key);
}
