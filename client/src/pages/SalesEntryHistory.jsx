import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Layout from "../components/Layout";
import Icon from "../components/Icon";
import { useAuth } from "../context/AuthContext";
import { getErrorMessage } from "../api/client";
import { toast } from "react-toastify";
import { downloadSalesEntryFile, listSalesEntries } from "../api/salesEntries";
import { PAYMENT_MODES } from "../utils/salesEntryCalc";
import { useLiveRefresh } from "../context/LiveSync";
import { compactParams } from "../utils/query";

// Sales History: every saved Sales Entry, newest first. Search by invoice
// number or customer name, narrow by date, click a row to open (and, for an
// Admin, edit) it. Filters live in the URL.
const FILTER_KEYS = ["q", "from", "to", "paymentMode"];
const fmt = (n) => Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d) => new Date(d).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });

export default function SalesEntryHistory() {
  const { user } = useAuth();
  const admin = user.role === "admin";
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, searchParams.get(k) || ""]));
  const paramsKey = JSON.stringify(compactParams(filters));
  const setFilter = (key, value) => setSearchParams(compactParams({ ...filters, [key]: value }), { replace: true });

  // The search box waits a moment after typing before searching.
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

  // Entries saved or edited by anyone appear without a refresh.
  useLiveRefresh(["sales-entries"], () => {
    listSalesEntries(JSON.parse(paramsKey)).then(setEntries).catch(() => {});
  });

  const [busy, setBusy] = useState("");
  const download = async (e, format) => {
    setBusy(`${e._id}${format}`);
    try {
      await downloadSalesEntryFile(e, format);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy("");
    }
  };

  const total = entries.reduce((s, e) => s + e.grandTotal, 0);
  const inputCls = "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none";
  const hasFilters = FILTER_KEYS.some((k) => filters[k]);

  return (
    <Layout>
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">Sales History</h1>
          <Link to="/sales-entry" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-white hover:bg-primary-dark">
            <Icon name="plus" size={16} />
            New Sales Entry
          </Link>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input type="search" placeholder="Search invoice number or customer" value={query} onChange={(e) => setQuery(e.target.value)} className={`${inputCls} w-full max-w-xs`} />
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
              Clear
            </button>
          )}
        </div>

        {!loading && !error && entries.length > 0 && (
          <p className="mt-3 text-xs text-muted">
            {entries.length} entr{entries.length === 1 ? "y" : "ies"}
            {entries.length === 500 ? " (latest 500 shown)" : ""} · Total ₹{fmt(total)}
          </p>
        )}

        <div className="card mt-3 overflow-x-auto p-0">
          {loading && <p className="p-4 text-sm text-muted">Loading…</p>}
          {error && <p className="p-4 text-sm text-danger">{error}</p>}
          {!loading && !error && entries.length === 0 && <p className="p-4 text-sm text-muted">No records found.</p>}
          {!loading && !error && entries.length > 0 && (
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border bg-bg text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5">Invoice No</th>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Customer</th>
                  <th className="px-3 py-2.5">Payment</th>
                  <th className="px-3 py-2.5 text-right">Total</th>
                  <th className="px-3 py-2.5 text-right" />
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e._id} onClick={() => navigate(`/sales-entry/${e._id}`)} className="cursor-pointer border-b border-border/70 last:border-0 hover:bg-bg/60">
                    <td className="px-4 py-2.5 font-mono font-semibold text-primary">
                      {e.archiveNo}
                      {e.editedAt && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 font-sans text-[10px] font-semibold">EDITED</span>}
                    </td>
                    <td className="px-3 py-2.5 text-text">{day(e.invoiceDate)}</td>
                    <td className="px-3 py-2.5 text-text">{e.customer?.name || "-"}</td>
                    <td className="px-3 py-2.5 text-text">{e.paymentMode}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-text">₹{fmt(e.grandTotal)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">
                      {["pdf", "xlsx"].map((f) => (
                        <button
                          key={f}
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            download(e, f);
                          }}
                          title={`Download ${e.archiveNo}.${f}`}
                          className="mr-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-primary hover:bg-primary-soft disabled:opacity-50"
                        >
                          <Icon name="download" size={14} />
                          {busy === `${e._id}${f}` ? "…" : f === "pdf" ? "PDF" : "Excel"}
                        </button>
                      ))}
                      <Link to={`/sales-entry/${e._id}`} onClick={(ev) => ev.stopPropagation()} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-primary hover:bg-primary-soft">
                        <Icon name={admin ? "edit" : "eye"} size={14} />
                        {admin ? "Edit" : "View"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Layout>
  );
}
