import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { locateMedicine, transferStock } from "../../api/racks";
import RackInput from "../RackInput";
import { isRackChoice, NO_RACK } from "../../utils/rack";
import { inputCls, btnCls, ghostBtnCls, StockRowCard, unitsText } from "./RackCommon";

// Medicine Locator (search by brand, generic, composition, strength,
// code or barcode -> every rack position it sits on) with Rack Transfer
// built in: move some or all of one batch from a position to another.
export default function MedicineLocator({ canTransfer, onChanged, reloadKey }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [moving, setMoving] = useState(null); // the stock row being moved
  const [bump, setBump] = useState(0);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      locateMedicine(term)
        .then((d) => !cancelled && setResults(d))
        .catch(() => !cancelled && setResults([]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, reloadKey, bump]);

  return (
    <div className="space-y-3">
      <input
        type="search"
        aria-label="Find a medicine"
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Brand, generic, composition, strength or barcode"
        className={inputCls}
      />
      {results && results.length === 0 && <p className="text-sm text-muted">No matching medicines.</p>}
      {(results || []).map((p) => (
        <div key={p.productId} className="space-y-1.5 rounded-2xl bg-bg/60 p-2">
          <p className="px-1 text-sm">
            <span className="font-semibold text-text">{p.name}</span>{" "}
            <span className="text-xs text-muted">
              {p.productCode}
              {p.manufacturer ? ` · ${p.manufacturer}` : ""}
              {p.composition ? ` · ${p.composition}` : ""}
            </span>
          </p>
          {p.locations.length === 0 && <p className="px-1 text-xs text-muted">No stock on any rack.</p>}
          {p.locations.map((r) => (
            <StockRowCard
              key={`${r.batchId}:${r.rack}`}
              row={r}
              right={
                canTransfer && (
                  <button type="button" onClick={() => setMoving(r)} className="mt-1 text-xs font-semibold text-primary hover:underline">
                    Move…
                  </button>
                )
              }
            />
          ))}
        </div>
      ))}
      {moving && (
        <TransferDialog
          row={moving}
          onClose={() => setMoving(null)}
          onDone={() => {
            setMoving(null);
            setBump((b) => b + 1);
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}

function TransferDialog({ row, onClose, onDone }) {
  const loose = row.soldAs === "pack-and-loose" && row.unitsPerPack > 1;
  const [packs, setPacks] = useState(String(Math.floor(row.qty / (loose ? row.unitsPerPack : 1))));
  const [looseQty, setLooseQty] = useState(loose ? String(row.qty % row.unitsPerPack) : "0");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const units = (Number(packs) || 0) * (loose ? row.unitsPerPack : 1) + (loose ? Number(looseQty) || 0 : 0);
  const valid = units > 0 && units <= row.qty && isRackChoice(to) && (to === NO_RACK ? "" : to) !== row.rack;

  const submit = async (e) => {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError("");
    try {
      await transferStock({ batch: row.batchId, from: row.rack || NO_RACK, to, qty: units, reason });
      toast.success(`Moved ${unitsText(row, units)} of ${row.name} to ${to === NO_RACK ? "No Rack" : to}`);
      onDone();
    } catch (err) {
      setError(err.response?.data?.message || "Could not move the stock.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <form onSubmit={submit} className="w-full max-w-md space-y-3 rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-display text-lg font-semibold text-text">Rack Transfer</h3>
            <p className="text-xs text-muted">
              {row.name} · batch {row.batchNo} · {unitsText(row, row.qty)} on {row.rack || "No Rack"}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted hover:text-text">✕</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted">
            {row.packUnit}s to move
            <input type="number" min="0" value={packs} onChange={(e) => setPacks(e.target.value)} className={inputCls} />
          </label>
          {loose && (
            <label className="text-xs text-muted">
              + loose {row.looseUnitName}s
              <input type="number" min="0" max={row.unitsPerPack - 1} value={looseQty} onChange={(e) => setLooseQty(e.target.value)} className={inputCls} />
            </label>
          )}
        </div>
        <RackInput id="transfer-to" value={to} onChange={setTo} label="Move to" labelClassName="block text-xs font-medium text-muted" />
        <label className="block text-xs text-muted">
          Reason (optional)
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} placeholder="e.g. Shelf reorganised" />
        </label>
        {units > row.qty && <p className="text-xs text-danger">Only {unitsText(row, row.qty)} here.</p>}
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={!valid || saving} className={btnCls}>{saving ? "Moving…" : "Move stock"}</button>
          <button type="button" onClick={onClose} className={ghostBtnCls}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
