import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { getRackStock, saveStockAudit, listStockAudits } from "../../api/racks";
import { RackCodeInput, btnCls, fmtDate, unitsText } from "./RackCommon";

// Stock Audit: count what is physically on a rack / shelf / position,
// compare with system stock, then save the count (and optionally correct
// the system to it). Counts are entered in packs + loose units.
export default function StockAuditView({ scope, onScope, canApply, onChanged }) {
  const [rows, setRows] = useState(null);
  const [label, setLabel] = useState("");
  const [counts, setCounts] = useState({}); // key -> { packs, loose }
  const [apply, setApply] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [audits, setAudits] = useState([]);
  const [bump, setBump] = useState(0);
  const auditable = scope && scope !== "ALL";

  useEffect(() => {
    if (!auditable) {
      setRows(null);
      return;
    }
    let cancelled = false;
    getRackStock(scope)
      .then((d) => {
        if (cancelled) return;
        setRows(d.rows);
        setLabel(d.scope.label);
        setCounts({});
      })
      .catch(() => !cancelled && setRows([]));
    listStockAudits(scope === "NONE" ? "NONE" : scope).then((a) => !cancelled && setAudits(a)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [scope, auditable, bump]);

  const keyOf = (r) => `${r.batchId}:${r.rack}`;
  const physicalOf = (r) => {
    const c = counts[keyOf(r)];
    if (!c || (c.packs === "" && c.loose === "")) return null;
    const per = r.soldAs === "pack-and-loose" && r.unitsPerPack > 1 ? r.unitsPerPack : 1;
    return (Number(c.packs) || 0) * per + (per > 1 ? Number(c.loose) || 0 : 0);
  };
  const counted = (rows || []).filter((r) => physicalOf(r) !== null);
  const mismatches = counted.filter((r) => physicalOf(r) !== r.qty);

  const setCount = (r, field, value) => setCounts((c) => ({ ...c, [keyOf(r)]: { packs: "", loose: "", ...c[keyOf(r)], [field]: value } }));
  const matchAll = () => {
    const next = {};
    for (const r of rows) {
      const per = r.soldAs === "pack-and-loose" && r.unitsPerPack > 1 ? r.unitsPerPack : 1;
      next[keyOf(r)] = { packs: String(Math.floor(r.qty / per)), loose: per > 1 ? String(r.qty % per) : "" };
    }
    setCounts(next);
  };

  const submit = async () => {
    if (!counted.length || saving) return;
    setSaving(true);
    try {
      await saveStockAudit({ scope, apply: apply && canApply, note, lines: counted.map((r) => ({ batch: r.batchId, rack: r.rack || "NONE", physicalQty: physicalOf(r) })) });
      toast.success(apply && canApply ? `Audit saved and stock corrected (${mismatches.length} difference${mismatches.length === 1 ? "" : "s"})` : "Audit saved");
      setApply(false);
      setNote("");
      setBump((b) => b + 1);
      if (apply) onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not save the audit.");
    } finally {
      setSaving(false);
    }
  };

  const cell = "h-9 w-16 rounded-lg border border-border bg-surface px-2 text-sm text-text focus:border-primary focus:outline-none";

  return (
    <div className="space-y-3">
      <RackCodeInput onCode={onScope} placeholder="Scan or type the rack, shelf or position to audit" />
      {!auditable && <p className="text-sm text-muted">Choose a rack, shelf or position to start counting.</p>}
      {auditable && rows && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-text">Counting: {label}</p>
            {rows.length > 0 && (
              <button type="button" onClick={matchAll} className="text-xs font-semibold text-primary hover:underline">Fill all with system qty</button>
            )}
          </div>
          {rows.length === 0 && <p className="text-sm text-muted">The system has no stock here.</p>}
          <div className="space-y-1.5">
            {rows.map((r) => {
              const phys = physicalOf(r);
              const diff = phys === null ? null : phys - r.qty;
              const loose = r.soldAs === "pack-and-loose" && r.unitsPerPack > 1;
              return (
                <div key={keyOf(r)} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text">{r.name}</p>
                    <p className="text-xs text-muted">
                      {r.rack || "No Rack"} · batch {r.batchNo} · exp {fmtDate(r.expiryDate)} · system {r.qtyDisplay}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted">
                    <input aria-label={`${r.name} ${r.batchNo} packs counted`} type="number" min="0" value={counts[keyOf(r)]?.packs ?? ""} onChange={(e) => setCount(r, "packs", e.target.value)} className={cell} />
                    {r.packUnit}s
                    {loose && (
                      <>
                        <input aria-label={`${r.name} ${r.batchNo} loose counted`} type="number" min="0" value={counts[keyOf(r)]?.loose ?? ""} onChange={(e) => setCount(r, "loose", e.target.value)} className={cell} />
                        {r.looseUnitName}s
                      </>
                    )}
                    {diff !== null && (
                      <span className={`ml-2 font-semibold ${diff === 0 ? "text-success" : "text-danger"}`}>
                        {diff === 0 ? "✓ matches" : `${diff > 0 ? "+" : "−"}${unitsText(r, Math.abs(diff))}`}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {counted.length > 0 && (
            <div className="space-y-2 rounded-xl bg-surface p-3 shadow-sm">
              <p className="text-sm text-text">
                {counted.length} counted · <span className={mismatches.length ? "font-semibold text-danger" : "text-success"}>{mismatches.length} difference{mismatches.length === 1 ? "" : "s"}</span>
              </p>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm" />
              {canApply && (
                <label className="flex items-center gap-2 text-sm text-text">
                  <input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} className="accent-primary" />
                  Correct system stock to the physical counts
                </label>
              )}
              <button type="button" disabled={saving} onClick={submit} className={btnCls}>
                {saving ? "Saving…" : apply ? "Save audit & correct stock" : "Save audit"}
              </button>
            </div>
          )}
        </>
      )}
      {auditable && audits.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Past audits here</p>
          <ul className="space-y-1 text-xs text-muted">
            {audits.slice(0, 10).map((a) => (
              <li key={a._id} className="rounded-lg bg-bg px-2.5 py-1.5">
                {fmtDate(a.createdAt)} · {a.performedBy?.username || "—"} · {a.lines.length} lines · {a.lines.filter((l) => l.difference !== 0).length} differences ·{" "}
                {a.applied ? "stock corrected" : "count only"}
                {a.note ? ` · ${a.note}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
