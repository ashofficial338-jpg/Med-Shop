import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import Layout from "../components/Layout";
import Icon from "../components/Icon";
import { useAuth } from "../context/AuthContext";
import { getErrorMessage } from "../api/client";
import { downloadSalesEntryFile, exportSalesEntries, listSalesEntries } from "../api/salesEntries";
import { compactParams } from "../utils/query";
import { PAYMENT_MODES } from "../utils/salesEntryCalc";

// Sales History for Sales Entry invoices: search by invoice number or
// customer, filter by date range / payment mode, then view, edit (Admin) or
// download each invoice. Filters live in the URL.
const FILTER_KEYS = ["q", "from", "to", "paymentMode"];
const fmt = (n) => Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d) => new Date(d).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });

export default function SalesEntryHistory() {
  const { user } = useAuth();
  const admin = user.role === "admin";
  const [searchParams, setSearchParams] = useSearchParams();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, searchParams.get(k) || ""]));
  const paramsKey = JSON.stringify(compactParams(filters));
  const setFilter = (key, value) => setSearchParams(compactParams({ ...filters, [key]: value }), { replace: true });

  // Typing in the search box waits a moment before asking the server.
  const [query, setQuery] = useState(filters.q);
  useEffect(() => {
    const t = setTimeout(() => {
      if (query !== filters.q) setFilter("q", query);
    }, 300);
    return () => clearTimeout(t);
  });

  useEffect(() => {
    setLoading(true);
    setError("");
    listSalesEntries(JSON.parse(paramsKey))
      .then(setEntries)
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [paramsKey]);

  const run = async (key, fn) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy("");
    }
  };

  const total = entries.reduce((s, e) => s + e.grandTotal, 0);
  const inputCls = "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none";
  const iconBtn = "inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold text-primary hover:bg-primary-soft disabled:opacity-50";
  const hasFilters = FILTER_KEYS.some((k) => filters[k]);

  return (
    <Layout>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">Sales History</h1>
          <p className="mt-1 text-sm text-muted">Invoices made on the Sales Entry screen{admin ? "" : " by you"}.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy === "export" || !entries.length}
            onClick={() => run("export", () => exportSalesEntries(JSON.parse(paramsKey)))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-semibold text-text hover:bg-bg disabled:opacity-50"
          >
            <Icon name="download" size={16} />
            {busy === "export" ? "Preparing…" : "Export list to Excel"}
          </button>
          <Link to="/sales-entry" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-white hover:bg-primary-dark">
            <Icon name="plus" size={16} />
            New Sales Entry
          </Link>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input type="search" placeholder="Invoice number or customer name / mobile" value={query} onChange={(e) => setQuery(e.target.value)} className={`${inputCls} w-full max-w-xs`} />
        <label className="flex items-center gap-1.5 text-xs text-muted">
          From
          <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter("from", e.target.value)} className={inputCls} />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          To
          <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter("to", e.target.value)} className={inputCls} />
        </label>
        <select aria-label="Payment mode" value={filters.paymentMode} onChange={(e) => setFilter("paymentMode", e.target.value)} className={inputCls}>
          <option value="">All payment modes</option>
          {PAYMENT_MODES.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setSearchParams({}, { replace: true });
            }}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-primary hover:bg-surface"
          >
            Clear filters
          </button>
        )}
      </div>

      {!loading && !error && entries.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          {entries.length} invoice{entries.length === 1 ? "" : "s"}
          {entries.length === 500 ? " (latest 500 shown)" : ""} · Total ₹{fmt(total)}
        </p>
      )}

      <div className="card mt-3 overflow-x-auto p-0">
        {loading && <p className="p-4 text-sm text-muted">Loading…</p>}
        {error && <p className="p-4 text-sm text-danger">{error}</p>}
        {!loading && !error && entries.length === 0 && <p className="p-4 text-sm text-muted">No records found.</p>}
        {!loading && !error && entries.length > 0 && (
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border bg-bg text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5">Invoice No</th>
                <th className="px-3 py-2.5">Date</th>
                <th className="px-3 py-2.5">Customer</th>
                <th className="px-3 py-2.5">Payment</th>
                <th className="px-3 py-2.5 text-right">Grand Total</th>
                <th className="px-3 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e._id} className="border-b border-border/70 last:border-0 hover:bg-bg/60">
                  <td className="px-4 py-2.5">
                    <Link to={`/sales-entry/${e._id}`} className="font-mono font-semibold text-primary hover:underline">
                      {e.archiveNo}
                    </Link>
                    {e.editedAt && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">EDITED</span>}
                  </td>
                  <td className="px-3 py-2.5 text-text">{day(e.invoiceDate)}</td>
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-text">{e.customer?.name || "Cash Customer"}</p>
                    <p className="text-xs text-muted">{[e.customer?.mobile, e.customer?.gstin].filter(Boolean).join(" · ")}</p>
                  </td>
                  <td className="px-3 py-2.5 text-text">{e.paymentMode}</td>
                  <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-text">₹{fmt(e.grandTotal)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1">
                      <Link to={`/sales-entry/${e._id}`} className={iconBtn}>
                        <Icon name="eye" size={14} />
                        View
                      </Link>
                      {admin && (
                        <Link to={`/sales-entry/${e._id}?edit=1`} className={iconBtn}>
                          <Icon name="edit" size={14} />
                          Edit
                        </Link>
                      )}
                      <button type="button" disabled={Boolean(busy)} onClick={() => run(`${e._id}pdf`, () => downloadSalesEntryFile(e, "pdf"))} className={iconBtn}>
                        <Icon name="download" size={14} />
                        PDF
                      </button>
                      <button type="button" disabled={Boolean(busy)} onClick={() => run(`${e._id}xlsx`, () => downloadSalesEntryFile(e, "xlsx"))} className={iconBtn}>
                        <Icon name="download" size={14} />
                        Excel
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  );
}
