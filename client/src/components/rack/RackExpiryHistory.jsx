import { useEffect, useState } from "react";
import { getRackExpiry, exportRackExpiry, getRackHistory } from "../../api/racks";
import ReportDownloadButtons from "../ReportDownloadButtons";
import { RackCodeInput, StockRowCard, fmtDate } from "./RackCommon";

// Rack-wise expiry alerts: expired / near-expiry batches grouped by rack.
export function RackExpiry({ racks, reloadKey }) {
  const [days, setDays] = useState(90);
  const [rack, setRack] = useState("");
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getRackExpiry({ days, ...(rack ? { scope: rack } : {}) })
      .then((d) => !cancelled && setRows(d.rows))
      .catch(() => !cancelled && setRows([]));
    return () => {
      cancelled = true;
    };
  }, [days, rack, reloadKey]);

  const groups = new Map();
  for (const r of rows || []) {
    const k = r.rackLetter ? `Rack ${r.rackLetter}` : "No Rack";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const sel = "h-10 rounded-lg border border-border bg-surface px-3 text-sm text-text";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Window" value={days} onChange={(e) => setDays(Number(e.target.value))} className={sel}>
          {[30, 60, 90, 180].map((d) => (
            <option key={d} value={d}>Expired or within {d} days</option>
          ))}
        </select>
        <select aria-label="Rack" value={rack} onChange={(e) => setRack(e.target.value)} className={sel}>
          <option value="">All racks</option>
          {racks.map((r) => (
            <option key={r.letter} value={r.letter}>Rack {r.letter}</option>
          ))}
          <option value="NONE">No Rack</option>
        </select>
        <div className="ml-auto">
          <ReportDownloadButtons onExport={(format) => exportRackExpiry(format, { days, ...(rack ? { scope: rack } : {}) })} />
        </div>
      </div>
      {rows && rows.length === 0 && <p className="text-sm text-muted">Nothing expires on these racks in that window.</p>}
      {[...groups.entries()].map(([name, list]) => (
        <div key={name} className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            {name} · {list.filter((r) => r.daysToExpiry < 0).length} expired · {list.filter((r) => r.daysToExpiry >= 0).length} expiring
          </p>
          {list.map((r) => (
            <StockRowCard key={`${r.batchId}:${r.rack}`} row={r} />
          ))}
        </div>
      ))}
    </div>
  );
}

const TYPE_LABEL = {
  purchase: "Purchase in",
  sale: "Sold",
  "manual-add": "Manual add",
  "manual-reduce": "Manual reduce",
  "void-reversal": "Void – returned",
  "stock-clearance": "Expired write-off",
  "rack-transfer": "Moved",
  "stock-audit": "Audit correction",
};

// Rack History: every movement in / out of a rack, shelf or position.
export function RackHistory({ scope, onScope, reloadKey }) {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    getRackHistory(scope || undefined)
      .then((d) => !cancelled && setEntries(d))
      .catch((err) => {
        if (cancelled) return;
        setEntries([]);
        setError(err.response?.data?.message || "Could not load history.");
      });
    return () => {
      cancelled = true;
    };
  }, [scope, reloadKey]);

  return (
    <div className="space-y-3">
      <RackCodeInput onCode={onScope} placeholder="Scan or type a rack, shelf or position (blank = all)" />
      <p className="text-xs text-muted">Showing {scope ? scope : "all racks"}. Movements recorded before rack tracking started can't be placed on a rack.</p>
      {error && <p className="text-sm text-danger">{error}</p>}
      {entries && entries.length === 0 && !error && <p className="text-sm text-muted">No movements recorded here yet.</p>}
      <ul className="space-y-1.5">
        {(entries || []).map((e) => {
          const out = e.type === "rack-transfer" ? null : e.qtyChange < 0;
          return (
            <li key={e._id} className="rounded-xl border border-border bg-surface p-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-medium text-text">
                  {TYPE_LABEL[e.type] || e.type} · {e.product?.name || "—"}
                  {e.batchNo ? <span className="ml-1 font-mono text-xs text-muted">{e.batchNo}</span> : null}
                </span>
                <span className={`font-semibold ${out === null ? "text-primary" : out ? "text-danger" : "text-success"}`}>
                  {out === null ? "" : out ? "−" : "+"}
                  {e.qtyDisplay}
                </span>
              </div>
              <p className="text-xs text-muted">
                {e.type === "rack-transfer" ? `${e.rack || "No Rack"} → ${e.toRack || "No Rack"}` : e.rack || "No Rack"} · {fmtDate(e.date)}{" "}
                {new Date(e.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {e.by}
              </p>
              {e.reason && <p className="text-xs text-muted">{e.reason}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
