import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Layout from "../components/Layout";
import { listSales, exportSales } from "../api/sales";
import { listCategories } from "../api/products";
import { useAuth } from "../context/AuthContext";
import ExportButtons from "../components/ExportButtons";
import { PAYMENT_MODES } from "../components/dashboard/ReportFilters";
import { compactParams } from "../utils/query";

// Filters live in the URL so dashboard links (e.g. "Total Sales" for a date
// range / payment mode / category) open this list already narrowed down.
const FILTER_KEYS = ["q", "from", "to", "paymentMode", "status", "category"];

export default function BillHistory() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sales, setSales] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, searchParams.get(k) || ""]));
  const params = compactParams(filters);
  const paramsKey = JSON.stringify(params);

  const setFilter = (key, value) => {
    const next = { ...filters, [key]: value };
    setSearchParams(compactParams(next), { replace: true });
  };

  useEffect(() => {
    setLoading(true);
    listSales(JSON.parse(paramsKey)).then((data) => {
      setSales(data);
      setLoading(false);
    });
  }, [paramsKey]);

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
          {user.role === "admin" ? "Bill History" : "My Bills"}
        </h1>
        <ExportButtons onExport={(format) => exportSales(format, params)} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Search by bill number"
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

      <div className="mt-4 space-y-2">
        {loading && <p className="text-sm text-muted">Loading…</p>}
        {!loading && sales.length === 0 && <p className="text-sm text-muted">No records found.</p>}

        {sales.map((s) => (
          <button
            key={s._id}
            onClick={() => navigate(`/bills/${s._id}`)}
            className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl bg-surface p-4 text-left shadow-sm hover:bg-bg"
          >
            <div>
              <p className="font-medium text-text">
                {s.billNo}
                {s.paymentStatus === "void" && (
                  <span className="ml-2 rounded-full bg-danger/15 px-2 py-0.5 text-xs font-semibold text-danger">VOID</span>
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
        ))}
      </div>
    </Layout>
  );
}
