import { useEffect, useState } from "react";
import { getCompositionReport, exportCompositionReport } from "../api/products";
import ReportDownloadButtons from "./ReportDownloadButtons";

const money = (n) => (n == null || n === "" ? "—" : `₹${Number(n).toFixed(2)}`);

// Brands grouped by composition + strength + dosage form + release type,
// with combined stock shown for information. Nothing here changes stock.
export default function CompositionReportModal({ onClose, onOpenProduct }) {
  const [q, setQ] = useState("");
  const [groups, setGroups] = useState(null);
  const [open, setOpen] = useState({});

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      getCompositionReport(q.trim() ? { q: q.trim() } : {})
        .then((data) => !cancelled && setGroups(data))
        .catch(() => !cancelled && setGroups([]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8">
      <div className="w-full max-w-3xl space-y-4 rounded-2xl bg-surface p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold text-text">Composition Report</h2>
            <p className="text-xs text-muted">
              Combined stock is for information only. Each brand keeps its own stock and batches, and the same composition does not make brands interchangeable.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-muted hover:text-text" aria-label="Close">✕</button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by composition, generic or brand"
            className="w-full max-w-xs rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
          />
          <ReportDownloadButtons onExport={(format) => exportCompositionReport(format, q.trim() ? { q: q.trim() } : {})} />
        </div>

        {groups === null && <p className="text-sm text-muted">Loading…</p>}
        {groups && groups.length === 0 && (
          <p className="text-sm text-muted">No composition groups yet. Add a composition to products to group their brands.</p>
        )}

        <div className="space-y-2">
          {(groups || []).map((g) => {
            const isOpen = open[g.key] ?? Boolean(q.trim());
            return (
              <div key={g.key} className="rounded-xl border border-border">
                <button
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, [g.key]: !isOpen }))}
                  aria-expanded={isOpen}
                  className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left"
                >
                  <span>
                    <span className="font-medium text-text">{g.label}</span>
                    <span className="ml-2 text-xs text-muted">
                      {g.brandCount} brand{g.brandCount === 1 ? "" : "s"} · {g.brandsInStock} in stock
                    </span>
                  </span>
                  <span className="text-sm text-text">
                    Combined: <span className="font-semibold">{g.combinedStockDisplay}</span>
                    <span className="ml-2 text-xs text-muted">{isOpen ? "▲" : "▼"}</span>
                  </span>
                </button>
                {isOpen && (
                  <div className="overflow-x-auto border-t border-border">
                    <table className="w-full min-w-[520px] text-sm">
                      <thead className="text-xs text-muted">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Brand</th>
                          <th className="px-3 py-2 text-left font-medium">Manufacturer</th>
                          <th className="px-3 py-2 text-left font-medium">Stock</th>
                          <th className="px-3 py-2 text-right font-medium">Selling</th>
                          <th className="px-3 py-2 text-right font-medium">Avg Cost</th>
                          <th className="px-3 py-2 text-left font-medium">Nearest Expiry</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.brands.map((b) => (
                          <tr key={b.productId} className="border-t border-border">
                            <td className="px-3 py-2">
                              <button type="button" onClick={() => onOpenProduct?.(b.productId)} className="text-left font-medium text-text hover:text-primary hover:underline">
                                {b.name}
                              </button>
                              <span className="ml-1 font-mono text-xs text-muted">{b.productCode}</span>
                            </td>
                            <td className="px-3 py-2 text-muted">{b.manufacturer || "—"}</td>
                            <td className={`px-3 py-2 ${b.packsOnHand > 0 ? "text-text" : "text-danger"}`}>{b.qtyDisplay}</td>
                            <td className="px-3 py-2 text-right font-mono">{money(b.packRate)}</td>
                            <td className="px-3 py-2 text-right font-mono">{money(b.avgCostPrice)}</td>
                            <td className="px-3 py-2 text-muted">{b.nearestExpiry ? new Date(b.nearestExpiry).toLocaleDateString() : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
