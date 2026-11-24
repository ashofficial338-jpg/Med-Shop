import { useEffect, useState } from "react";
import { useLiveRefresh } from "../context/LiveSync";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Layout from "../components/Layout";
import { listPurchases, exportPurchases } from "../api/purchases";
import { listVendors } from "../api/vendors";
import { listCategories } from "../api/products";
import ReportDownloadButtons from "../components/ReportDownloadButtons";
import ExcelUploadModal from "../components/ExcelUploadModal";
import { listUnregisteredSuppliers, deletePurchase } from "../api/purchases";
import { toast } from "react-toastify";
import { compactParams } from "../utils/query";

// Filters live in the URL so dashboard links open this list pre-filtered.
const FILTER_KEYS = ["vendor", "supplierName", "product", "payment", "from", "to", "category"];

export default function PurchaseHistory() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [purchases, setPurchases] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unregistered, setUnregistered] = useState([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [deletingId, setDeletingId] = useState(null);
  const [excelOpen, setExcelOpen] = useState(false);

  const handleDelete = async (p) => {
    if (!window.confirm(`Delete purchase ${p.invoiceNo}? Its stock comes off the shelves again. This cannot be undone.`)) return;
    setDeletingId(p._id);
    try {
      await deletePurchase(p._id);
      toast.success(`Purchase ${p.invoiceNo} deleted.`);
      setReloadKey((k) => k + 1);
    } catch (err) {
      toast.error(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, searchParams.get(k) || ""]));
  const params = compactParams(filters);
  const paramsKey = JSON.stringify(params);

  const setFilter = (key, value) => setSearchParams(compactParams({ ...filters, [key]: value }), { replace: true });
  // One supplier dropdown drives two params: a registered vendor / "unregistered"
  // / "none" go in `vendor`, a single unregistered supplier's name in `supplierName`.
  const supplierValue = filters.supplierName ? `name:${filters.supplierName}` : filters.vendor;
  const setSupplier = (value) =>
    setSearchParams(
      compactParams({ ...filters, vendor: value.startsWith("name:") ? "" : value, supplierName: value.startsWith("name:") ? value.slice(5) : "" }),
      { replace: true }
    );
  useEffect(() => {
    // Only the latest filters' answer is shown (typing fires several).
    let cancelled = false;
    setLoading(true);
    listPurchases(JSON.parse(paramsKey))
      .then((data) => !cancelled && setPurchases(data))
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [paramsKey, reloadKey]);

  // Purchases saved/edited by anyone appear without a refresh.
  useLiveRefresh(["purchases"], () => {
    listPurchases(JSON.parse(paramsKey)).then(setPurchases).catch(() => {});
  });

  useEffect(() => {
    listVendors().then(setVendors).catch(() => {});
    listCategories().then(setCategories).catch(() => {});
    listUnregisteredSuppliers().then(setUnregistered).catch(() => {});
  }, []);

  const selectCls =
    "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none";
  const total = purchases.reduce((sum, p) => sum + p.total, 0);

  return (
    <Layout>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">Purchases</h1>
        <div className="flex flex-wrap gap-2">
          <ReportDownloadButtons onExport={(format) => exportPurchases(format, params)} />
          <Link to="/purchases/new" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
            + New Purchase
          </Link>
          <button
            onClick={() => navigate("/purchases/new", { state: { upload: true } })}
            title="Read a purchase bill (JPG, PNG or PDF) and fill the purchase form from it"
            className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-primary hover:bg-surface"
          >
            Upload Bill (Image / PDF)
          </button>
          <button
            onClick={() => setExcelOpen(true)}
            title="Upload many purchase invoices at once from an Excel file (.xlsx or .xls)"
            className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-primary hover:bg-surface"
          >
            Upload Excel
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <select aria-label="Supplier" value={supplierValue} onChange={(e) => setSupplier(e.target.value)} className={selectCls}>
          <option value="">All Suppliers</option>
          <optgroup label="Registered suppliers">
            {vendors.map((v) => (
              <option key={v._id} value={v._id}>{v.name}</option>
            ))}
          </optgroup>
          <optgroup label="Unregistered suppliers">
            <option value="unregistered">All unregistered</option>
            {unregistered.map((n) => (
              <option key={n} value={`name:${n}`}>{n}</option>
            ))}
          </optgroup>
          <option value="none">No supplier</option>
        </select>
        <select aria-label="Payment status" value={filters.payment} onChange={(e) => setFilter("payment", e.target.value)} className={selectCls}>
          <option value="">Any payment status</option>
          <option value="paid">Fully paid</option>
          <option value="due">Balance due</option>
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
                <p className="font-medium text-text">
                  {p.vendor ? p.vendor.name : p.supplierName || "No supplier"} — {p.invoiceNo}
                  {!p.vendor && (
                    <span className="ml-2 rounded-full bg-bg px-2 py-0.5 text-[11px] font-semibold text-muted">
                      {p.supplierName ? "Unregistered" : "Without supplier"}
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted">
                  {new Date(p.date).toLocaleDateString()} · {p.paymentMode}
                  {p.balanceDue > 0 && <span className="font-semibold text-danger"> · ₹{p.balanceDue.toFixed(2)} due</span>}
                  {p.editedAt && ` · Edited ${new Date(p.editedAt).toLocaleDateString()}`}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <p className="font-mono text-sm font-semibold text-text">₹{p.total.toFixed(2)}</p>
                <button
                  onClick={() => navigate(`/purchases/${p._id}/edit`)}
                  className="rounded-lg border border-border px-3 py-1 text-xs font-semibold text-primary hover:bg-bg"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(p)}
                  disabled={deletingId === p._id}
                  className="rounded-lg border border-danger/40 px-3 py-1 text-xs font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
                >
                  {deletingId === p._id ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
            <ul className="mt-2 space-y-0.5 text-xs text-muted">
              {p.items.map((item, i) => (
                <li key={i}>
                  {item.product?.name} ({item.product?.productCode}) — {item.qtyPacks} × ₹{item.costPrice}
                  {item.discountPercent > 0 && ` − ${item.discountPercent}%`}
                  {item.previousCostPrice != null && item.previousCostPrice !== item.costPrice && (
                    <span className={item.costPrice > item.previousCostPrice ? "text-danger" : "text-success"}>
                      {" "}(prev ₹{item.previousCostPrice})
                    </span>
                  )}
                  {item.rack ? ` · 📍 ${item.rack}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {excelOpen && (
        <ExcelUploadModal kind="purchases" onClose={() => setExcelOpen(false)} onSaved={() => setReloadKey((k) => k + 1)} />
      )}
    </Layout>
  );
}
