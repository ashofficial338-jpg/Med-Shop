import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getProductPurchases } from "../api/products";

const money = (n) => (n == null ? "—" : `₹${Number(n).toFixed(2)}`);
const TYPE_LABEL = { registered: "", unregistered: " (unregistered)", none: "" };

// Every purchase of this one product, whichever supplier it came from, with
// each supplier's totals and the weighted average cost. Admin only.
export default function ProductPurchaseHistory({ productId, reloadKey }) {
  const [data, setData] = useState(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getProductPurchases(productId)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData({ lines: [], suppliers: [] }));
    return () => {
      cancelled = true;
    };
  }, [productId, reloadKey]);

  if (!data) return <p className="text-xs text-muted">Loading purchases…</p>;

  const lines = showAll ? data.lines : data.lines.slice(0, 5);
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted">Purchases by supplier</p>
      {data.lines.length === 0 ? (
        <p className="text-xs text-muted">No purchases recorded yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-bg px-2.5 py-1.5">
              <p className="text-muted">Avg cost of stock on hand</p>
              <p className="font-mono font-semibold text-text">{money(data.avgCostOnHand)}</p>
            </div>
            <div className="rounded-lg bg-bg px-2.5 py-1.5">
              <p className="text-muted">Avg purchase price (all time)</p>
              <p className="font-mono font-semibold text-text">{money(data.avgPurchasePrice)}</p>
            </div>
          </div>
          <div className="space-y-1">
            {data.suppliers.map((s) => (
              <div key={`${s.supplierType}:${s.vendorId || s.supplier}`} className="flex items-center justify-between gap-2 rounded-lg bg-bg px-2.5 py-1.5 text-xs">
                <span className="min-w-0 truncate text-text">
                  {s.vendorId ? (
                    <Link to={`/purchases?vendor=${s.vendorId}&product=${productId}`} className="hover:text-primary hover:underline">{s.supplier}</Link>
                  ) : (
                    `${s.supplier}${TYPE_LABEL[s.supplierType]}`
                  )}
                  <span className="ml-1 text-muted">· {s.purchases} purchase{s.purchases === 1 ? "" : "s"}</span>
                </span>
                <span className="shrink-0 text-right font-mono text-text">
                  {s.qtyPacks} @ avg {money(s.avgPrice)}
                </span>
              </div>
            ))}
          </div>
          <ul className="space-y-0.5 text-xs text-muted">
            {lines.map((l, i) => (
              <li key={`${l.purchaseId}:${i}`}>
                {new Date(l.date).toLocaleDateString()} · {l.supplier}
                {TYPE_LABEL[l.supplierType]} · {l.invoiceNo} · {l.qtyPacks} × {money(l.costPrice)} · batch {l.batchNo}
              </li>
            ))}
          </ul>
          {data.lines.length > 5 && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="text-xs font-semibold text-primary hover:underline">
              {showAll ? "Show fewer" : `Show all ${data.lines.length}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
