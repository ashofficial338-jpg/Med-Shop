import { useEffect, useState } from "react";
import { getRackStock, exportRackStock } from "../../api/racks";
import ReportDownloadButtons from "../ReportDownloadButtons";
import { RackCodeInput, StockRowCard } from "./RackCommon";

// Rack Scanner + rack-wise stock report: scan or pick a rack / shelf /
// position and see every medicine, batch and quantity stored there.
export default function RackStockView({ scope, onScope, racks, reloadKey }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    getRackStock(scope || undefined)
      .then((d) => !cancelled && setData(d))
      .catch((err) => {
        if (cancelled) return;
        setData(null);
        setError(err.response?.data?.message || "Could not load stock.");
      });
    return () => {
      cancelled = true;
    };
  }, [scope, reloadKey]);

  const rows = data?.rows || [];
  const byPosition = new Map();
  for (const r of rows) {
    const k = r.rack || "No Rack";
    if (!byPosition.has(k)) byPosition.set(k, []);
    byPosition.get(k).push(r);
  }

  return (
    <div className="space-y-3">
      <RackCodeInput onCode={onScope} autoFocus />
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Rack" value={scope && scope.length === 1 ? scope : ""} onChange={(e) => onScope(e.target.value)} className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-text">
          <option value="">All racks</option>
          {racks.map((r) => (
            <option key={r.letter} value={r.letter}>Rack {r.letter}{r.name ? ` · ${r.name}` : ""}</option>
          ))}
          <option value="NONE">No Rack</option>
        </select>
        {scope && scope.length === 1 && scope !== "NONE" && (racks.find((r) => r.letter === scope)?.layout.shelves || 1) > 1 && (
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: racks.find((r) => r.letter === scope).layout.shelves }, (_, i) => (
              <button key={i} type="button" onClick={() => onScope(`${scope}-S${i + 1}`)} className="rounded-lg border border-border px-2 py-1 text-xs font-semibold text-primary hover:bg-bg">
                Shelf {i + 1}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto">
          <ReportDownloadButtons onExport={(format) => exportRackStock(format, scope || undefined)} />
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {data && (
        <p className="text-sm text-text">
          <span className="font-semibold">{data.scope.label}</span>
          <span className="text-muted"> · {rows.length} batch location{rows.length === 1 ? "" : "s"} · {new Set(rows.map((r) => String(r.productId))).size} medicines</span>
        </p>
      )}
      {data && rows.length === 0 && <p className="text-sm text-muted">Nothing is stored here.</p>}
      {[...byPosition.entries()].map(([pos, list]) => (
        <div key={pos} className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            {pos} {list[0].rack && list[0].location !== list[0].rack ? `· ${list[0].location}` : ""}
          </p>
          {list.map((r) => (
            <StockRowCard key={`${r.batchId}:${r.rack}`} row={r} />
          ))}
        </div>
      ))}
    </div>
  );
}
