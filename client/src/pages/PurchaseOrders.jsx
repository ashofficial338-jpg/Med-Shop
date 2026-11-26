import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import Layout from "../components/Layout";
import ReportDownloadButtons from "../components/ReportDownloadButtons";
import DocumentViewer from "../components/DocumentViewer";
import { useLiveRefresh } from "../context/LiveSync";
import { listVendors } from "../api/vendors";
import { listPurchaseOrders, exportPurchaseOrders, purchaseOrderPdf, raisePurchaseOrder } from "../api/purchaseOrders";
import { PO_STATUSES, StatusBadge, ProgressBar, inr, showDate } from "../components/purchase/poCommon";
import { compactParams } from "../utils/query";

const FILTER_KEYS = ["q", "status", "vendor", "from", "to"];

export default function PurchaseOrders() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, searchParams.get(k) || ""]));
  const params = compactParams(filters);
  const key = JSON.stringify(params);
  const setFilter = (k, v) => setSearchParams(compactParams({ ...filters, [k]: v }), { replace: true });
  const [orders, setOrders] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState(null);

  const load = () => listPurchaseOrders(JSON.parse(key)).then(setOrders).catch(() => {}).finally(() => setLoading(false));
  useEffect(() => {
    setLoading(true);
    const t = setTimeout(load, filters.q ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    listVendors().then(setVendors).catch(() => {});
  }, []);
  useLiveRefresh(["purchase-orders"], load);

  const raise = async (po) => {
    try {
      await raisePurchaseOrder(po._id);
      toast.success(`${po.poNo} raised.`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not raise the order.");
    }
  };

  const selectCls = "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none";
  const open = orders.filter((o) => ["Pending", "Partially Received"].includes(o.status));
  const btn = "rounded-lg border border-border px-3 py-1 text-xs font-semibold text-primary hover:bg-bg";

  return (
    <Layout>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">Purchase Orders</h1>
          <p className="mt-0.5 text-sm text-muted">Orders to suppliers. They don't change stock - receive goods on a Purchase Invoice.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ReportDownloadButtons onExport={(format) => exportPurchaseOrders(format, params)} />
          <Link to="/purchase-orders/new" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-95">+ New Purchase Order</Link>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <input type="search" aria-label="Search" placeholder="Search PO no, supplier…" value={filters.q} onChange={(e) => setFilter("q", e.target.value)} className={`${selectCls} min-w-0 flex-1 sm:max-w-xs`} />
        <select aria-label="Status" value={filters.status} onChange={(e) => setFilter("status", e.target.value)} className={selectCls}>
          <option value="">All statuses</option>
          <option value="open">Open (pending / partial)</option>
          {PO_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select aria-label="Supplier" value={filters.vendor} onChange={(e) => setFilter("vendor", e.target.value)} className={selectCls}>
          <option value="">All suppliers</option>
          {vendors.map((v) => <option key={v._id} value={v._id}>{v.name}</option>)}
        </select>
        <input type="date" aria-label="From" value={filters.from} onChange={(e) => setFilter("from", e.target.value)} className={selectCls} />
        <input type="date" aria-label="To" value={filters.to} onChange={(e) => setFilter("to", e.target.value)} className={selectCls} />
        {Object.keys(params).length > 0 && (
          <button onClick={() => setSearchParams({}, { replace: true })} className="rounded-lg px-3 py-2 text-sm font-semibold text-primary hover:bg-surface">Clear filters</button>
        )}
      </div>

      {!loading && orders.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          {orders.length} order{orders.length === 1 ? "" : "s"} · {open.length} open · {inr(orders.filter((o) => o.status !== "Cancelled").reduce((s, o) => s + o.total, 0))} ordered
        </p>
      )}

      <div className="mt-4 space-y-2">
        {loading && <p className="text-sm text-muted">Loading…</p>}
        {!loading && orders.length === 0 && <p className="text-sm text-muted">No purchase orders found.</p>}
        {orders.map((po) => (
          <div key={po._id} className="rounded-xl bg-surface p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-text">
                  <Link to={`/purchase-orders/${po._id}`} className="font-mono text-primary hover:underline">{po.poNo}</Link> · {po.vendor?.name}{" "}
                  <StatusBadge status={po.status} />
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {showDate(po.date)}{po.expectedDate ? ` · expected ${showDate(po.expectedDate)}` : ""} · {po.items.length} item{po.items.length === 1 ? "" : "s"}
                </p>
                <div className="mt-1.5"><ProgressBar received={po.progress.received} ordered={po.progress.ordered} /></div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="mr-1 font-mono text-sm font-semibold text-text">{inr(po.total)}</p>
                <button onClick={() => navigate(`/purchase-orders/${po._id}`)} className={btn}>View</button>
                <button onClick={() => setViewing(po)} className={btn}>Print / PDF</button>
                {["Draft", "Pending", "Partially Received"].includes(po.status) && <button onClick={() => navigate(`/purchase-orders/${po._id}/edit`)} className={btn}>Edit</button>}
                {po.status === "Draft" && <button onClick={() => raise(po)} className={btn}>Raise</button>}
                {["Pending", "Partially Received"].includes(po.status) && (
                  <button onClick={() => navigate(`/purchases/new?po=${po._id}`)} className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-white hover:brightness-95">Receive (Create Invoice)</button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {viewing && <DocumentViewer title={`Purchase Order ${viewing.poNo}`} filename={`${viewing.poNo}.pdf`} load={() => purchaseOrderPdf(viewing._id)} onClose={() => setViewing(null)} />}
    </Layout>
  );
}
