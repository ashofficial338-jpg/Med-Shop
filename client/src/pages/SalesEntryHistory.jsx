import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Layout from "../components/Layout";
import Icon from "../components/Icon";
import { useAuth } from "../context/AuthContext";
import { getErrorMessage } from "../api/client";
import { toast } from "react-toastify";
import { downloadSalesEntryFile, linkAllSalesEntries, listSalesEntries, unlinkedSalesEntryCount } from "../api/salesEntries";
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

  // Older entries not yet linked to stock and ledgers (Admin).
  const [unlinked, setUnlinked] = useState(0);
  const [linkResults, setLinkResults] = useState(null);
  useEffect(() => {
    if (admin) unlinkedSalesEntryCount().then(setUnlinked).catch(() => {});
  }, [admin, entries]);
  const linkAll = async () => {
    if (!window.confirm(`Link ${unlinked} older entr${unlinked === 1 ? "y" : "ies"} to stock and ledgers? Their items will be taken from stock and they'll appear in ledgers, Day Book and reports on their own dates. Entries that can't be linked (e.g. not enough stock) are skipped and listed.`)) return;
    setBusy("link");
    try {
      const out = await linkAllSalesEntries();
      setLinkResults(out);
      toast.success(`${out.linked} linked${out.skipped ? `, ${out.skipped} skipped` : ""}.`);
      listSalesEntries(JSON.parse(paramsKey)).then(setEntries).catch(() => {});
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy("");
    }
  };

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

        {admin && unlinked > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
            <Icon name="alert" size={18} />
            <span className="font-semibold">
              {unlinked} older entr{unlinked === 1 ? "y isn't" : "ies aren't"} linked to stock and ledgers yet.
            </span>
            <button type="button" onClick={linkAll} disabled={Boolean(busy)} className="rounded-lg bg-warning px-3 py-1 text-xs font-semibold text-white disabled:opacity-60">
              {busy === "link" ? "Linking…" : "Link all older entries"}
            </button>
          </div>
        )}
        {linkResults && (
          <div className="card mt-3 p-4 text-sm">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-text">
                Linking: {linkResults.linked} linked, {linkResults.skipped} skipped
              </p>
              <button type="button" onClick={() => setLinkResults(null)} aria-label="Close" className="rounded p-1 text-muted hover:bg-bg">
                <Icon name="close" size={14} />
              </button>
            </div>
            <ul className="mt-2 space-y-1">
              {linkResults.results.map((r) => (
                <li key={r._id} className={r.ok ? "text-success" : "text-danger"}>
                  <Link to={`/sales-entry/${r._id}`} className="font-mono font-semibold underline">
                    {r.archiveNo}
                  </Link>{" "}
                  - {r.message}
                </li>
              ))}
            </ul>
          </div>
        )}

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
                      {admin && !e.sale && <span className="ml-2 rounded-full bg-warning/15 px-2 py-0.5 font-sans text-[10px] font-semibold text-warning">NOT LINKED</span>}
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
