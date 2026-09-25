import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import Layout from "../components/Layout";
import AdjustStockModal from "../components/AdjustStockModal";
import ExportButtons from "../components/ExportButtons";
import { listStockLedger, getExpiryTracker, markStockClearance } from "../api/stock";
import { getStockReport, exportStockReport } from "../api/products";

const TABS = ["Stock Ledger", "Expiry Tracker", "Stock Report"];

function ExpiryGroup({ title, batches, selected, onToggle, onToggleAll, badgeCls }) {
  if (batches.length === 0) return null;
  const allSelected = batches.every((b) => selected.has(b._id));

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">
          {title} <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${badgeCls}`}>{batches.length}</span>
        </h3>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={allSelected} onChange={() => onToggleAll(batches)} />
          Select All
        </label>
      </div>
      <div className="mt-2 space-y-1.5">
        {batches.map((b) => (
          <label key={b._id} className="flex items-center justify-between gap-2 rounded-lg bg-surface p-2.5 text-sm shadow-sm">
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={selected.has(b._id)} onChange={() => onToggle(b._id)} />
              <div>
                <p className="text-text">{b.product?.name} <span className="font-mono text-xs text-muted">({b.product?.productCode})</span></p>
                <p className="text-xs text-muted">Batch {b.batchNo} · Expires {new Date(b.expiryDate).toLocaleDateString()} · Qty {b.qtyRemaining}</p>
              </div>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

export default function StockManagement() {
  const [tab, setTab] = useState(TABS[0]);

  const [ledger, setLedger] = useState([]);
  const [loadingLedger, setLoadingLedger] = useState(true);
  const [showAdjust, setShowAdjust] = useState(false);

  const [tracker, setTracker] = useState({ expired: [], expiringSoon: [], ok: [] });
  const [loadingTracker, setLoadingTracker] = useState(true);
  const [selected, setSelected] = useState(new Set());

  const [stockReport, setStockReport] = useState(null);
  const [loadingStockReport, setLoadingStockReport] = useState(true);

  const loadStockReport = () => {
    setLoadingStockReport(true);
    getStockReport().then((data) => {
      setStockReport(data);
      setLoadingStockReport(false);
    });
  };

  const loadLedger = () => {
    setLoadingLedger(true);
    listStockLedger().then((data) => {
      setLedger(data);
      setLoadingLedger(false);
    });
  };

  const loadTracker = () => {
    setLoadingTracker(true);
    getExpiryTracker().then((data) => {
      setTracker(data);
      setLoadingTracker(false);
    });
  };

  useEffect(() => {
    loadLedger();
    loadTracker();
    loadStockReport();
  }, []);

  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = (batches) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = batches.every((b) => next.has(b._id));
      batches.forEach((b) => (allSelected ? next.delete(b._id) : next.add(b._id)));
      return next;
    });
  };

  const handleClearance = async () => {
    const allBatches = [...tracker.expired, ...tracker.expiringSoon, ...tracker.ok];
    const chosen = allBatches.filter((b) => selected.has(b._id));
    const totalQty = chosen.reduce((sum, b) => sum + b.qtyRemaining, 0);

    const confirmed = window.confirm(
      `This will remove ${chosen.length} item(s), totalling ${totalQty} units, from stock as a loss - this cannot be undone. Continue?`
    );
    if (!confirmed) return;

    await markStockClearance([...selected]);
    toast.success("Stock cleared and recorded as a loss.");
    setSelected(new Set());
    loadTracker();
    loadLedger();
  };

  return (
    <Layout>
      <h1 className="font-display text-2xl font-semibold text-text">Stock Management</h1>

      <div className="mt-4 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-semibold ${tab === t ? "border-b-2 border-primary text-primary" : "text-muted"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Stock Ledger" && (
        <div className="mt-4">
          <button
            onClick={() => setShowAdjust(true)}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-95"
          >
            Adjust Stock
          </button>

          <div className="mt-4 space-y-1.5">
            {loadingLedger && <p className="text-sm text-muted">Loading…</p>}
            {!loadingLedger && ledger.length === 0 && <p className="text-sm text-muted">No records found.</p>}
            {ledger.map((e) => (
              <div key={e._id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface p-3 text-sm shadow-sm">
                <div>
                  <p className="text-text">
                    {e.product?.name} <span className="font-mono text-xs text-muted">({e.product?.productCode})</span>
                  </p>
                  <p className="text-xs text-muted">
                    {e.type} · {e.reason}{e.batch?.batchNo ? ` · Batch ${e.batch.batchNo}` : ""} · by {e.performedBy?.username}
                  </p>
                </div>
                <span className={`font-mono font-semibold ${e.qtyChange >= 0 ? "text-success" : "text-danger"}`}>
                  {e.qtyChange >= 0 ? "+" : ""}{e.qtyChange}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "Expiry Tracker" && (
        <div className="mt-4">
          {selected.size > 0 && (
            <button
              onClick={handleClearance}
              className="rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white hover:brightness-95"
            >
              Mark as Stock Clearance ({selected.size})
            </button>
          )}

          {loadingTracker && <p className="mt-4 text-sm text-muted">Loading…</p>}
          {!loadingTracker && (
            <>
              <ExpiryGroup title="Expired" batches={tracker.expired} selected={selected} onToggle={toggleOne} onToggleAll={toggleAll} badgeCls="bg-danger/15 text-danger" />
              <ExpiryGroup title="Expiring Soon" batches={tracker.expiringSoon} selected={selected} onToggle={toggleOne} onToggleAll={toggleAll} badgeCls="bg-warning/15 text-warning" />
              <ExpiryGroup title="OK" batches={tracker.ok} selected={selected} onToggle={toggleOne} onToggleAll={toggleAll} badgeCls="bg-success/15 text-success" />
              {tracker.expired.length + tracker.expiringSoon.length + tracker.ok.length === 0 && (
                <p className="mt-4 text-sm text-muted">No records found.</p>
              )}
            </>
          )}
        </div>
      )}

      {tab === "Stock Report" && (
        <div className="mt-4">
          {loadingStockReport && <p className="text-sm text-muted">Loading…</p>}
          {!loadingStockReport && stockReport && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-3">
                  <div className="rounded-2xl bg-surface p-4 shadow-sm">
                    <p className="text-xs font-medium text-muted">SKUs</p>
                    <p className="mt-1 font-mono text-lg font-semibold text-text">{stockReport.totals.skuCount}</p>
                  </div>
                  <div className="rounded-2xl bg-surface p-4 shadow-sm">
                    <p className="text-xs font-medium text-muted">Stock Value (Cost)</p>
                    <p className="mt-1 font-mono text-lg font-semibold text-text">₹{stockReport.totals.totalValueCost.toFixed(2)}</p>
                  </div>
                  <div className="rounded-2xl bg-surface p-4 shadow-sm">
                    <p className="text-xs font-medium text-muted">Stock Value (MRP)</p>
                    <p className="mt-1 font-mono text-lg font-semibold text-text">₹{stockReport.totals.totalValueMrp.toFixed(2)}</p>
                  </div>
                </div>
                <ExportButtons onExport={(format) => exportStockReport(format)} />
              </div>

              <div className="mt-4 overflow-x-auto rounded-xl bg-surface shadow-sm">
                <table className="w-full text-left text-sm text-text">
                  <thead className="border-b border-border text-xs uppercase text-muted">
                    <tr>
                      <th className="px-4 py-2">Product</th>
                      <th className="px-4 py-2">Category</th>
                      <th className="px-4 py-2">Qty on Hand</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2 text-right">Value (Cost)</th>
                      <th className="px-4 py-2 text-right">Value (MRP)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockReport.rows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-muted">No records found.</td>
                      </tr>
                    )}
                    {stockReport.rows.map((r) => (
                      <tr key={r.productId} className="border-b border-border last:border-0">
                        <td className="px-4 py-2">
                          {r.name} <span className="font-mono text-xs text-muted">({r.productCode})</span>
                        </td>
                        <td className="px-4 py-2">{r.category}</td>
                        <td className="px-4 py-2">{r.qtyDisplay}</td>
                        <td className="px-4 py-2">
                          {r.isOut && <span className="rounded-full bg-danger/15 px-2 py-0.5 text-xs font-semibold text-danger">Out of Stock</span>}
                          {!r.isOut && r.isLowStock && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning">Low Stock</span>}
                          {!r.isOut && !r.isLowStock && <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-semibold text-success">OK</span>}
                        </td>
                        <td className="px-4 py-2 text-right font-mono">₹{r.valueCost.toFixed(2)}</td>
                        <td className="px-4 py-2 text-right font-mono">₹{r.valueMrp.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {showAdjust && (
        <AdjustStockModal
          onClose={() => setShowAdjust(false)}
          onSaved={() => {
            setShowAdjust(false);
            loadLedger();
            loadTracker();
            toast.success("Stock adjusted.");
          }}
        />
      )}
    </Layout>
  );
}
