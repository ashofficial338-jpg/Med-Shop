import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import Layout from "../components/Layout";
import ReportDownloadButtons from "../components/ReportDownloadButtons";
import DocumentViewer from "../components/DocumentViewer";
import { useLiveRefresh } from "../context/LiveSync";
import { listVendors } from "../api/vendors";
import { listPurchaseReturns, exportPurchaseReturns, purchaseReturnPdf, cancelPurchaseReturn } from "../api/purchaseReturns";
import { StatusBadge, inr, showDate } from "../components/purchase/poCommon";
import { compactParams } from "../utils/query";

const FILTER_KEYS = ["q", "status", "vendor", "from", "to"];

export default function PurchaseReturns() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, searchParams.get(k) || ""]));
  const params = compactParams(filters);
  const key = JSON.stringify(params);
  const setFilter = (k, v) => setSearchParams(compactParams({ ...filters, [k]: v }), { replace: true });
  const [rows, setRows] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState(location.state?.view || null);
  const [busy, setBusy] = useState(null);

  const load = () => listPurchaseReturns(JSON.parse(key)).then(setRows).catch(() => {}).finally(() => setLoading(false));
  useEffect(() => {
    setLoading(true);
    const t = setTimeout(load, filters.q ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    listVendors().then(setVendors).catch(() => {});
  }, []);
  useLiveRefresh(["purchase-returns"], load);

  const cancel = async (r) => {
    const reason = window.prompt(`Cancel return ${r.returnNo}? Its stock (${r.items.reduce((s, i) => s + i.qtyPacks, 0)} packs) goes back onto the same batches. Reason (optional):`);
    if (reason === null) return;
    setBusy(r._id);
    try {
      await cancelPurchaseReturn(r._id, reason);
      toast.success(`${r.returnNo} cancelled. Stock restored.`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not cancel the return.");
    } finally {
      setBusy(null);
    }
  };

  const selectCls = "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none";
  const live = rows.filter((r) => r.status === "Confirmed");

  return (
    <Layout>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">Purchase Returns</h1>
          <p className="mt-0.5 text-sm text-muted">Goods sent back to suppliers. Confirming reduces stock; cancelling puts it back.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ReportDownloadButtons onExport={(format) => exportPurchaseReturns(format, params)} />
          <Link to="/purchase-returns/new" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-95">+ New Purchase Return</Link>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <input type="search" aria-label="Search" placeholder="Search return / PI / invoice no, supplier…" value={filters.q} onChange={(e) => setFilter("q", e.target.value)} className={`${selectCls} min-w-0 flex-1 sm:max-w-xs`} />
        <select aria-label="Status" value={filters.status} onChange={(e) => setFilter("status", e.target.value)} className={selectCls}>
          <option value="">All statuses</option>
          <option>Confirmed</option>
          <option>Cancelled</option>
        </select>
        <select aria-label="Supplier" value={filters.vendor} onChange={(e) => setFilter("vendor", e.target.value)} className={selectCls}>
          <option value="">All suppliers</option>
          {vendors.map((v) => <option key={v._id} value={v._id}>{v.name}</option>)}
        </select>
        <input type="date" aria-label="From" value={filters.from} onChange={(e) => setFilter("from", e.target.value)} className={selectCls} />
        <input type="date" aria-label="To" value={filters.to} onChange={(e) => setFilter("to", e.target.value)} className={selectCls} />
        {Object.keys(params).length > 0 && <button onClick={() => setSearchParams({}, { replace: true })} className="rounded-lg px-3 py-2 text-sm font-semibold text-primary hover:bg-surface">Clear filters</button>}
      </div>

      {!loading && rows.length > 0 && (
        <p className="mt-3 text-xs text-muted">{live.length} confirmed · {inr(live.reduce((s, r) => s + r.total, 0))} returned</p>
      )}

      <div className="mt-4 space-y-2">
        {loading && <p className="text-sm text-muted">Loading…</p>}
        {!loading && rows.length === 0 && <p className="text-sm text-muted">No purchase returns found.</p>}
        {rows.map((r) => (
          <div key={r._id} className="rounded-xl bg-surface p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-text">
                  <span className="font-mono text-primary">{r.returnNo}</span> · {r.vendor?.name || "No supplier"} <StatusBadge status={r.status} />
                </p>
                <p className="text-xs text-muted">
                  {showDate(r.date)} · from {r.piNo || "—"} (inv {r.invoiceNo}){r.reason ? ` · ${r.reason}` : ""} · by {r.createdBy?.username}
                  {r.status === "Cancelled" && r.cancelReason ? ` · cancelled: ${r.cancelReason}` : ""}
                </p>
                <ul className="mt-1 text-xs text-muted">
                  {r.items.map((i, k) => <li key={k}>{i.product?.name} · batch {i.batchNo} — {i.qtyPacks} × {inr(i.rate)}</li>)}
                </ul>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="mr-1 font-mono text-sm font-semibold text-text">{inr(r.total)}</p>
                <button onClick={() => setViewing(r)} className="rounded-lg border border-border px-3 py-1 text-xs font-semibold text-primary hover:bg-bg">View / Print</button>
                <button onClick={() => navigate(`/purchases/${r.purchase}/edit`)} className="rounded-lg border border-border px-3 py-1 text-xs font-semibold text-primary hover:bg-bg">Invoice</button>
                {r.status === "Confirmed" && (
                  <button onClick={() => cancel(r)} disabled={busy === r._id} className="rounded-lg border border-danger/40 px-3 py-1 text-xs font-semibold text-danger hover:bg-danger/10 disabled:opacity-50">
                    {busy === r._id ? "Cancelling…" : "Cancel"}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {viewing && <DocumentViewer title={`Purchase Return ${viewing.returnNo}`} filename={`${viewing.returnNo}.pdf`} load={() => purchaseReturnPdf(viewing._id)} onClose={() => setViewing(null)} />}
    </Layout>
  );
}
