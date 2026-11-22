import { useEffect, useRef, useState } from "react";
import { getLastPurchaseRate } from "../api/purchases";

const money = (n) => `₹${Number(n).toFixed(2)}`;
const fmt = (d) => new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });

// Previous purchase rate for one purchase line: this supplier's last rate
// when there is one, else the latest rate from anyone. onSuggest(rate) fires
// when a rate is found so the form can pre-fill the price - the user can
// always type a different one, and that typed rate is what gets saved.
export default function PurchaseRateHint({ productId, vendorId, supplierName, noSupplier, costPrice, onSuggest }) {
  const [data, setData] = useState(null);
  const suggestRef = useRef(onSuggest);

  useEffect(() => {
    suggestRef.current = onSuggest;
  }, [onSuggest]);

  useEffect(() => {
    if (!productId) {
      setData(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      const params = { product: productId };
      if (vendorId) params.vendor = vendorId;
      else if (supplierName?.trim()) params.supplierName = supplierName.trim();
      else if (noSupplier) params.noSupplier = "1";
      getLastPurchaseRate(params)
        .then((d) => {
          if (cancelled) return;
          setData(d);
          if (d.suggested != null) suggestRef.current?.(d.suggested);
        })
        .catch(() => !cancelled && setData(null));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [productId, vendorId, supplierName, noSupplier]);

  if (!productId || !data) return null;
  const prev = data.supplierRate || data.latestRate;
  if (!prev) return <p className="mt-1 text-xs text-muted">No previous purchase rate - enter the new rate.</p>;

  const typed = costPrice === "" || costPrice === undefined ? null : Number(costPrice);
  const diff = typed === null || Number.isNaN(typed) ? null : Number((typed - prev.costPrice).toFixed(2));
  const pct = diff !== null && prev.costPrice > 0 ? (diff / prev.costPrice) * 100 : null;

  return (
    <div className="mt-1 rounded-lg bg-bg px-2.5 py-1.5 text-xs text-muted">
      <p>
        Previous rate: <span className="font-mono font-semibold text-text">{money(prev.costPrice)}</span> · {prev.supplier} · {fmt(prev.date)}
        {prev.invoiceNo ? ` · ${prev.invoiceNo}` : ""}
        <span className="ml-1 italic">
          ({data.basis === "supplier" ? "this supplier" : data.basis === "latest" ? "latest from any supplier" : "from stock records"})
        </span>
      </p>
      {data.supplierRate && data.latestRate && data.latestRate.purchaseId !== data.supplierRate.purchaseId && (
        <p>
          Latest overall: {money(data.latestRate.costPrice)} · {data.latestRate.supplier} · {fmt(data.latestRate.date)}
        </p>
      )}
      {diff !== null && (
        <p>
          New rate: <span className="font-mono font-semibold text-text">{money(typed)}</span>{" "}
          {diff === 0 ? (
            <span>(same as before)</span>
          ) : (
            <span className={diff > 0 ? "text-danger" : "text-success"}>
              ({diff > 0 ? "▲" : "▼"} {money(Math.abs(diff))}
              {pct !== null ? `, ${pct > 0 ? "+" : ""}${pct.toFixed(1)}%` : ""})
            </span>
          )}
          {data.avgCostOnHand != null && <span> · avg cost on hand {money(data.avgCostOnHand)}</span>}
        </p>
      )}
    </div>
  );
}
