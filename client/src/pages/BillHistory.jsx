import { useEffect, useState } from "react";
import { useLiveRefresh } from "../context/LiveSync";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Layout from "../components/Layout";
import { listSales, exportSales, listSaleIds, bulkDeleteSales, deleteSale } from "../api/sales";
import BulkDelete from "../components/BulkDelete";
import { getErrorMessage } from "../api/client";
import { toast } from "react-toastify";
import { listCategories } from "../api/products";
import { useAuth } from "../context/AuthContext";
import ExportButtons from "../components/ExportButtons";
import ExcelUploadModal from "../components/ExcelUploadModal";
import { PAYMENT_MODES } from "../components/dashboard/ReportFilters";
import { compactParams } from "../utils/query";

// Filters live in the URL so dashboard links (e.g. "Total Sales" for a date
// range / payment mode / category) open this list already narrowed down.
const FILTER_KEYS = ["q", "from", "to", "paymentMode", "status", "payment", "category"];

export default function BillHistory() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sales, setSales] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [excelOpen, setExcelOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState(() => new Set());
  const isAdmin = user.role === "admin";

  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, searchParams.get(k) || ""]));
  const params = compactParams(filters);
  const paramsKey = JSON.stringify(params);
  // Other filters show other bills: start the selection again.
  useEffect(() => setSelected(new Set()), [paramsKey]);

  const reload = () => listSales(JSON.parse(paramsKey)).then(setSales).catch(() => {});
  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const removeOne = async (s) => {
    if (!window.confirm(`Delete bill ${s.billNo} completely?${s.paymentStatus === "void" ? "" : " Its stock goes back on the shelves."} This cannot be undone.`)) return;
    try {
      await deleteSale(s._id);
      toast.success(`Bill ${s.billNo} deleted.`);
      setSelected((prev) => new Set([...prev].filter((id) => id !== s._id)));
      reload();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const setFilter = (key, value) => {
    const next = { ...filters, [key]: value };
    setSearchParams(compactParams(next), { replace: true });
  };

  useEffect(() => {
    // Only the latest filters' answer is shown (typing fires several).
    let cancelled = false;
    setLoading(true);
    listSales(JSON.parse(paramsKey))
      .then((data) => !cancelled && setSales(data))
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [paramsKey, reloadKey]);

  // Bills made/edited by anyone appear without a refresh.
  useLiveRefresh(["sales"], () => {
    listSales(JSON.parse(paramsKey)).then(setSales).catch(() => {});
  });

  useEffect(() => {
    if (filters.category) listCategories().then(setCategories).catch(() => {});
  }, [filters.category]);

  const activeCount = FILTER_KEYS.filter((k) => k !== "q" && filters[k]).length;
  const total = sales.filter((s) => s.paymentStatus !== "void").reduce((sum, s) => sum + s.total, 0);
  const categoryName = categories.find((c) => c._id === filters.category)?.name;

  const inputCls =
    "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none";

  return (
    <Layout>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">
          {user.role === "admin" ? "Bills (Sales)" : "My Bills"}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/billing" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
            + New Bill
          </Link>
          <ExportButtons onExport={(format) => exportSales(format, params)} />
          {user.role === "admin" && (
            <button
              onClick={() => setExcelOpen(true)}
              title="Upload many sales invoices at once from an Excel file (.xlsx or .xls)"
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-primary hover:bg-surface"
            >
              Upload Excel
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Bill number, customer name or phone"
          value={filters.q}
          onChange={(e) => setFilter("q", e.target.value)}
          className={`${inputCls} w-full max-w-xs`}
        />
        <input type="date" aria-label="From" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter("from", e.target.value)} className={inputCls} />
        <input type="date" aria-label="To" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter("to", e.target.value)} className={inputCls} />
        <select aria-label="Payment mode" value={filters.paymentMode} onChange={(e) => setFilter("paymentMode", e.target.value)} className={inputCls}>
          <option value="">All payment modes</option>
          {PAYMENT_MODES.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <select aria-label="Status" value={filters.status} onChange={(e) => setFilter("status", e.target.value)} className={inputCls}>
          <option value="">All bills</option>
          <option value="completed">Completed</option>
          <option value="void">Void</option>
        </select>
        <select aria-label="Payment status" value={filters.payment} onChange={(e) => setFilter("payment", e.target.value)} className={inputCls}>
          <option value="">Any payment status</option>
          <option value="paid">Fully paid</option>
          <option value="partial">Partly paid</option>
          <option value="unpaid">Unpaid (credit)</option>
        </select>
        {filters.category && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1.5 text-xs font-semibold text-primary">
            Category: {categoryName || "…"}
            <button onClick={() => setFilter("category", "")} aria-label="Remove category filter" className="hover:text-text">
              ✕
            </button>
          </span>
        )}
        {activeCount > 0 && (
          <button onClick={() => setSearchParams({}, { replace: true })} className="rounded-lg px-3 py-2 text-sm font-semibold text-primary hover:bg-surface">
            Clear filters
          </button>
        )}
      </div>

      {!loading && sales.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          {sales.length} bill{sales.length === 1 ? "" : "s"}
          {sales.length === 200 ? " (latest 200 shown; downloads include all)" : ""} · ₹{total.toFixed(2)} excluding void bills
        </p>
      )}

      {isAdmin && sales.length > 0 && (
        <BulkDelete
          noun="bill"
          shownIds={sales.map((s) => s._id)}
          selected={selected}
          setSelected={setSelected}
          loadAllIds={() => listSaleIds(params)}
          deleteMany={bulkDeleteSales}
          note="Their stock goes back on the shelves and they leave every report and balance."
          onDeleted={reload}
        />
      )}

      <div className="mt-4 space-y-2">
        {loading && <p className="text-sm text-muted">Loading…</p>}
        {!loading && sales.length === 0 && <p className="text-sm text-muted">No records found.</p>}

        {sales.map((s) => (
          <div key={s._id} className={`flex items-center gap-1 rounded-xl bg-surface pr-3 shadow-sm ${selected.has(s._id) ? "ring-2 ring-primary/40" : ""}`}>
          {isAdmin && (
            <label className="flex cursor-pointer items-center self-stretch pl-4 pr-2">
              <input type="checkbox" aria-label={`Select bill ${s.billNo}`} checked={selected.has(s._id)} onChange={() => toggle(s._id)} className="h-4 w-4 accent-primary" />
            </label>
          )}
          <button
            onClick={() => navigate(`/bills/${s._id}`)}
            className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2 rounded-xl p-4 text-left hover:bg-bg"
          >
            <div>
              <p className="font-medium text-text">
                {s.billNo}
                {s.paymentStatus === "void" && (
                  <span className="ml-2 rounded-full bg-danger/15 px-2 py-0.5 text-xs font-semibold text-danger">VOID</span>
                )}
                {s.editedAt && (
                  <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">EDITED</span>
                )}
                {s.paymentStatus !== "void" && s.paymentMode === "Credit" && s.balanceDue > 0 && (
                  <span className="ml-2 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning">
                    CREDIT · ₹{s.balanceDue.toFixed(2)} due
                  </span>
                )}
              </p>
              <p className="text-xs text-muted">
                {new Date(s.createdAt).toLocaleString()} · {s.customer?.name || "Walk-in"} · {s.paymentMode}
                {user.role === "admin" && ` · by ${s.createdBy?.username}`}
              </p>
            </div>
            <p className="font-mono text-sm font-semibold text-text">₹{s.total.toFixed(2)}</p>
          </button>
          {isAdmin && (
            <button onClick={() => removeOne(s)} aria-label={`Delete bill ${s.billNo}`} className="shrink-0 rounded-lg border border-danger/40 px-3 py-1 text-xs font-semibold text-danger hover:bg-danger/10">
              Delete
            </button>
          )}
          </div>
        ))}
      </div>
      {excelOpen && <ExcelUploadModal kind="sales" onClose={() => setExcelOpen(false)} onSaved={() => setReloadKey((k) => k + 1)} />}
    </Layout>
  );
}
