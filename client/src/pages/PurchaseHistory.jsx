import { useEffect, useState } from "react";
import { useLiveRefresh } from "../context/LiveSync";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Layout from "../components/Layout";
import { listPurchases, exportPurchases } from "../api/purchases";
import { listVendors } from "../api/vendors";
import { listCategories } from "../api/products";
import ReportDownloadButtons from "../components/ReportDownloadButtons";
import ExcelUploadModal from "../components/ExcelUploadModal";
import { listUnregisteredSuppliers, cancelPurchase, listPurchaseIds, bulkDeletePurchases, purchaseInvoicePdf, listCancelledPurchases } from "../api/purchases";
import DocumentViewer from "../components/DocumentViewer";
import BulkDelete from "../components/BulkDelete";
import { toast } from "react-toastify";
import { compactParams } from "../utils/query";

// Filters live in the URL so dashboard links open this list pre-filtered.
const FILTER_KEYS = ["q", "vendor", "supplierName", "product", "payment", "from", "to", "category", "purchaseOrder"];

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
  const [selected, setSelected] = useState(() => new Set());
  const [excelOpen, setExcelOpen] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const [cancelled, setCancelled] = useState(null);

  useEffect(() => {
    if (showCancelled) listCancelledPurchases().then(setCancelled).catch(() => setCancelled([]));
  }, [showCancelled, reloadKey]);

  const handleDelete = async (p) => {
    const reason = window.prompt(`Cancel purchase invoice ${p.piNo || p.invoiceNo}? Its stock comes off the shelves again and it leaves every report and balance (a copy stays in Cancelled invoices). Reason (optional):`);
    if (reason === null) return;
    setDeletingId(p._id);
    try {
      await cancelPurchase(p._id, reason);
      toast.success(`Purchase invoice ${p.piNo || p.invoiceNo} cancelled. Stock reversed.`);
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
  // Other filters show other purchases: start the selection again.
  useEffect(() => setSelected(new Set()), [paramsKey]);
  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

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
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">Purchase Invoices</h1>
          <p className="mt-0.5 text-sm text-muted">Confirming an invoice adds its stock. Receive against an order from <Link to="/purchase-orders?status=open" className="font-semibold text-primary hover:underline">Purchase Orders</Link>.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ReportDownloadButtons onExport={(format) => exportPurchases(format, params)} />
          <Link to="/purchases/new" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
            + New Purchase Invoice
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
        <input type="search" aria-label="Search" placeholder="Search PI / invoice / PO no, supplier…" value={filters.q} onChange={(e) => setFilter("q", e.target.value)} className={`${selectCls} min-w-0 flex-1 sm:max-w-xs`} />
        <select aria-label="Purchase order" value={filters.purchaseOrder} onChange={(e) => setFilter("purchaseOrder", e.target.value)} className={selectCls}>
          <option value="">With or without PO</option>
          <option value="any">Against a PO</option>
          <option value="none">Without a PO</option>
        </select>
        <select aria-label="Supplier" value={supplierValue} onChange={(e) => setSupplier(e.target.value)} className={selectCls}>
          <option value="">All Suppliers</option>
          <optgroup label="Suppliers">
            {vendors.map((v) => (
              <option key={v._id} value={v._id}>{v.name}</option>
            ))}
          </optgroup>
          {unregistered.length > 0 && (
            <optgroup label="Unregistered suppliers">
              <option value="unregistered">All unregistered</option>
              {unregistered.map((n) => (
                <option key={n} value={`name:${n}`}>{n}</option>
              ))}
            </optgroup>
          )}
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
        <label className="flex items-center gap-1.5 px-2 text-sm text-text">
          <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} className="accent-primary" />
          Cancelled invoices
        </label>
        {Object.keys(params).length > 0 && (
          <button onClick={() => setSearchParams({}, { replace: true })} className="rounded-lg px-3 py-2 text-sm font-semibold text-primary hover:bg-surface">
            Clear filters
          </button>
        )}
      </div>

      {showCancelled && (
        <div className="mt-4 rounded-xl border border-danger/20 bg-danger/5 p-3">
          <p className="text-sm font-semibold text-text">Cancelled purchase invoices</p>
          {!cancelled && <p className="text-xs text-muted">Loading…</p>}
          {cancelled?.length === 0 && <p className="text-xs text-muted">None.</p>}
          <ul className="mt-1 space-y-1 text-xs text-muted">
            {cancelled?.map((c) => (
              <li key={c._id}>
                <span className="font-mono font-semibold text-text">{c.piNo || "—"}</span> · {c.vendor?.name || "No supplier"} · inv {c.invoiceNo}
                {c.purchaseOrder ? ` · ${c.purchaseOrder.poNo}` : ""} · ₹{Number(c.total).toFixed(2)} · cancelled {new Date(c.createdAt).toLocaleDateString()} by {c.cancelledBy?.username}
                {c.reason ? ` – ${c.reason}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!loading && purchases.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          {purchases.length} purchase{purchases.length === 1 ? "" : "s"} · ₹{total.toFixed(2)} total
        </p>
      )}

      {purchases.length > 0 && (
        <BulkDelete
          noun="purchase invoice"
          shownIds={purchases.map((p) => p._id)}
          selected={selected}
          setSelected={setSelected}
          loadAllIds={() => listPurchaseIds(params)}
          deleteMany={bulkDeletePurchases}
          note="They are cancelled: their stock comes off the shelves and they leave every report and balance (copies stay in Cancelled invoices). One whose stock has been sold or returned is kept."
          onDeleted={() => setReloadKey((k) => k + 1)}
        />
      )}

      <div className="mt-4 space-y-2">
        {loading && <p className="text-sm text-muted">Loading…</p>}
        {!loading && purchases.length === 0 && <p className="text-sm text-muted">No records found.</p>}

        {purchases.map((p) => (
          <div key={p._id} className={`flex gap-3 rounded-xl bg-surface p-4 shadow-sm ${selected.has(p._id) ? "ring-2 ring-primary/40" : ""}`}>
            <input type="checkbox" aria-label={`Select purchase ${p.invoiceNo}`} checked={selected.has(p._id)} onChange={() => toggle(p._id)} className="mt-1 h-4 w-4 shrink-0 accent-primary" />
            <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium text-text">
                  {p.piNo && <span className="mr-1.5 font-mono text-primary">{p.piNo}</span>}
                  {p.vendor ? p.vendor.name : p.supplierName || "No supplier"} — {p.invoiceNo}
                  {p.purchaseOrder && (
                    <Link to={`/purchase-orders/${p.purchaseOrder._id}`} className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary hover:underline">{p.purchaseOrder.poNo}</Link>
                  )}
                  {p.returned && <span className="ml-2 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">Returned ₹{p.returned.total.toFixed(2)}</span>}
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
              <div className="flex flex-wrap items-center gap-2">
                <p className="mr-1 font-mono text-sm font-semibold text-text">₹{p.total.toFixed(2)}</p>
                <button
                  onClick={() => setViewing(p)}
                  className="rounded-lg border border-border px-3 py-1 text-xs font-semibold text-primary hover:bg-bg"
                >
                  View / Print
                </button>
                <button
                  onClick={() => navigate(`/purchase-returns/new?purchase=${p._id}`)}
                  className="rounded-lg border border-border px-3 py-1 text-xs font-semibold text-primary hover:bg-bg"
                >
                  Return
                </button>
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
                  {deletingId === p._id ? "Cancelling…" : "Cancel"}
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
          </div>
        ))}
      </div>
      {viewing && (
        <DocumentViewer
          title={`Purchase Invoice ${viewing.piNo || viewing.invoiceNo}`}
          filename={`${viewing.piNo || viewing.invoiceNo}.pdf`}
          load={() => purchaseInvoicePdf(viewing._id)}
          onClose={() => setViewing(null)}
        />
      )}
      {excelOpen && (
        <ExcelUploadModal kind="purchases" onClose={() => setExcelOpen(false)} onSaved={() => {
          setReloadKey((k) => k + 1);
          listVendors().then(setVendors).catch(() => {});
        }} />
      )}
    </Layout>
  );
}
