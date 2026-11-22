import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { getRackSummary, updateRack } from "../../api/racks";
import { inputCls, btnCls, ghostBtnCls } from "./RackCommon";

// Capacity, occupancy and expiry at a glance, per rack - plus the
// shelf/row/bin layout and bin capacity editor.
export default function RackOverview({ canEditRacks, onOpenScope, reloadKey }) {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [bump, setBump] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getRackSummary()
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData({ racks: [], noRack: null }));
    return () => {
      cancelled = true;
    };
  }, [reloadKey, bump]);

  const startEdit = (r) => {
    setEditing(r.letter);
    setForm({ name: r.name || "", shelves: r.layout.shelves, rowsPerShelf: r.layout.rows, binsPerRow: r.layout.bins, binCapacity: r.binCapacity || 0 });
  };

  const save = async (letter) => {
    setSaving(true);
    try {
      await updateRack(letter, form);
      toast.success(`Rack ${letter} updated`);
      setEditing(null);
      setBump((b) => b + 1);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not update the rack.");
    } finally {
      setSaving(false);
    }
  };

  if (!data) return <p className="text-sm text-muted">Loading racks…</p>;
  if (data.racks.length === 0) return <p className="text-sm text-muted">No racks yet. Add racks from Rack Finder → Manage Racks.</p>;

  const total = (k) => data.racks.reduce((s, r) => s + (r[k] || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Racks", data.racks.length],
          ["Occupied positions", `${total("occupiedPositions")} / ${total("positions")}`],
          ["Expiring ≤ 90 days", total("expiringSoon")],
          ["Expired on shelves", total("expired")],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-surface p-3 shadow-sm">
            <p className="text-xs text-muted">{label}</p>
            <p className="font-display text-xl font-bold text-text">{value}</p>
          </div>
        ))}
      </div>
      {data.noRack && data.noRack.batches > 0 && (
        <button type="button" onClick={() => onOpenScope("NONE")} className="w-full rounded-xl border border-warning/40 bg-warning/10 p-3 text-left text-sm text-text">
          {data.noRack.batches} batch location{data.noRack.batches === 1 ? "" : "s"} ({data.noRack.products} products) are on <b>No Rack</b>. Tap to view and move them.
        </button>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {data.racks.map((r) => {
          const pct = Math.min(r.utilizationPct || 0, 100);
          return (
            <div key={r.letter} className="rounded-xl bg-surface p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <button type="button" onClick={() => onOpenScope(r.letter)} className="flex items-center gap-3 text-left">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary font-display text-lg font-extrabold text-white">{r.letter}</span>
                  <span>
                    <span className="block font-semibold text-text">Rack {r.letter}{r.name ? ` · ${r.name}` : ""}</span>
                    <span className="block text-xs text-muted">
                      {r.layout.shelves} shelf{r.layout.shelves === 1 ? "" : "s"} × {r.layout.rows} row{r.layout.rows === 1 ? "" : "s"} × {r.layout.bins} bins = {r.positions} positions
                    </span>
                  </span>
                </button>
                {canEditRacks && editing !== r.letter && (
                  <button type="button" onClick={() => startEdit(r)} className="text-xs font-semibold text-primary hover:underline">Layout</button>
                )}
              </div>

              <div className="mt-3">
                <div className="flex justify-between text-xs text-muted">
                  <span>
                    {r.capacityPacks ? `${r.packs} / ${r.capacityPacks} packs` : `${r.occupiedPositions} / ${r.positions} positions used`}
                  </span>
                  <span>{pct.toFixed(0)}% full</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-bg" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <div className={`h-full rounded-full ${pct >= 90 ? "bg-danger" : pct >= 70 ? "bg-warning" : "bg-success"}`} style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1 text-xs text-muted">
                  {r.freePositions} free positions{r.freePacks != null ? ` · room for ${r.freePacks} more packs` : ""} · {r.products} products · {r.batches} batches
                </p>
                {(r.expired > 0 || r.expiringSoon > 0) && (
                  <p className="mt-1 text-xs">
                    {r.expired > 0 && <span className="mr-2 font-semibold text-danger">{r.expired} expired</span>}
                    {r.expiringSoon > 0 && <span className="font-semibold text-warning">{r.expiringSoon} expiring ≤ 90 days</span>}
                  </p>
                )}
              </div>

              {editing === r.letter && (
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3 text-xs">
                  <label className="col-span-2 text-muted">
                    Name
                    <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder="e.g. Antibiotics" />
                  </label>
                  {[
                    ["shelves", "Shelves"],
                    ["rowsPerShelf", "Rows per shelf"],
                    ["binsPerRow", "Bins per row"],
                    ["binCapacity", "Packs per bin (0 = not tracked)"],
                  ].map(([k, label]) => (
                    <label key={k} className="text-muted">
                      {label}
                      <input type="number" min={k === "binCapacity" ? 0 : 1} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className={inputCls} />
                    </label>
                  ))}
                  <p className="col-span-2 text-muted">
                    = {Number(form.shelves) * Number(form.rowsPerShelf) * Number(form.binsPerRow) || 0} positions. Position numbers run shelf by shelf, row by row, so existing codes like {r.letter}-001 keep working.
                  </p>
                  <div className="col-span-2 flex gap-2">
                    <button type="button" disabled={saving} onClick={() => save(r.letter)} className={btnCls}>Save</button>
                    <button type="button" onClick={() => setEditing(null)} className={ghostBtnCls}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
