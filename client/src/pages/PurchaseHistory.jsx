import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Layout from "../components/Layout";
import { listPurchases, exportPurchases } from "../api/purchases";
import { listVendors } from "../api/vendors";
import { listCategories } from "../api/products";
import ReportDownloadButtons from "../components/ReportDownloadButtons";
import { compactParams } from "../utils/query";

// Filters live in the URL so dashboard links open this list pre-filtered.
const FILTER_KEYS = ["vendor", "from", "to", "category"];

export default function PurchaseHistory() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [purchases, setPurchases] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, searchParams.get(k) || ""]));
  const params = compactParams(filters);
  const paramsKey = JSON.stringify(params);

  const setFilter = (key, value) => setSearchParams(compactParams({ ...filters, [key]: value }), { replace: true });

  useEffect(() => {
    setLoading(true);
    listPurchases(JSON.parse(paramsKey)).then((data) => {
      setPurchases(data);
      setLoading(false);
    });
  }, [paramsKey]);

  useEffect(() => {
    listVendors().then(setVendors);
    listCategories().then(setCategories).catch(() => {});
  }, []);

  const selectCls =
    "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none";
  const total = purchases.reduce((sum, p) => sum + p.total, 0);

  return (
    <Layout>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-text">Purchase History</h1>
        <ReportDownloadButtons onExport={(format) => exportPurchases(format, params)} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <select aria-label="Vendor" value={filters.vendor} onChange={(e) => setFilter("vendor", e.target.value)} className={selectCls}>
          <option value="">All Vendors</option>
          {vendors.map((v) => (
            <option key={v._id} value={v._id}>{v.name}</option>
          ))}
        </select>
        <select aria-label="Category" value={filters.category} onChange={(e) => setFilter("category", e.target.value)} className={selectCls}>
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c._id} value={c._id}>{c.name}</option>
          ))}
        </select>
        <input type="date" aria-label="From" value={filters.from} onChange={(e) => setFilter("from", e.target.value)} className={selectCls} />
        <input type="date" aria-label="To" value={filters.to} onChange={(e) => setFilter("to", e.target.value)} className={selectCls} />
        {Object.keys(params).length > 0 && (
          <button onClick={() => setSearchParams({}, { replace: true })} className="rounded-lg px-3 py-2 text-sm font-semibold text-primary hover:bg-surface">
            Clear filters
          </button>
        )}
      </div>

      {!loading && purchases.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          {purchases.length} purchase{purchases.length === 1 ? "" : "s"} · ₹{total.toFixed(2)} total
        </p>
      )}

      <div className="mt-4 space-y-2">
        {loading && <p className="text-sm text-muted">Loading…</p>}
        {!loading && purchases.length === 0 && <p className="text-sm text-muted">No records found.</p>}

        {purchases.map((p) => (
          <div key={p._id} className="rounded-xl bg-surface p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium text-text">{p.vendor?.name} — {p.invoiceNo}</p>
                <p className="text-xs text-muted">{new Date(p.date).toLocaleDateString()}</p>
              </div>
              <p className="font-mono text-sm font-semibold text-text">₹{p.total.toFixed(2)}</p>
            </div>
            <ul className="mt-2 space-y-0.5 text-xs text-muted">
              {p.items.map((item, i) => (
                <li key={i}>
                  {item.product?.name} ({item.product?.productCode}) — {item.qtyPacks} × ₹{item.costPrice}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Layout>
  );
}
