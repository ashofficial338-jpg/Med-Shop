import { useState } from "react";
import { toast } from "react-toastify";
import { createRack, updateRack, deleteRack } from "../api/racks";
import { RACK_LETTERS, positionCode } from "../utils/rack";

const DEFAULT_POSITIONS = 20;

// Add racks A-Z and set how many positions each one has (A-001 ... A-0NN).
// `initialLetter` preselects a rack to add, e.g. when an unused letter is tapped.
export default function ManageRacksModal({ racks, productCounts, initialLetter = "", onClose, onChanged }) {
  const free = RACK_LETTERS.filter((l) => !racks.some((r) => r.letter === l));
  const [letter, setLetter] = useState(free.includes(initialLetter) ? initialLetter : free[0] || "");
  const [positions, setPositions] = useState(String(DEFAULT_POSITIONS));
  const [edits, setEdits] = useState({}); // letter -> position count being typed
  const [busy, setBusy] = useState(false);

  const run = async (action, success) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      toast.success(success);
      await onChanged();
      return true;
    } catch (err) {
      toast.error(err.response?.data?.message || "Something went wrong. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    const n = Number(positions);
    if (!letter || !(n >= 1)) return;
    const ok = await run(() => createRack({ letter, positions: n }), `Rack ${letter} added (${positionCode(letter, 1)} to ${positionCode(letter, n)})`);
    if (ok) {
      const remaining = free.filter((l) => l !== letter);
      setLetter(remaining[0] || "");
      setPositions(String(DEFAULT_POSITIONS));
    }
  };

  const handleResize = async (rack) => {
    const n = Number(edits[rack.letter]);
    if (!(n >= 1) || n === rack.positions) return;
    const ok = await run(() => updateRack(rack.letter, { positions: n }), `Rack ${rack.letter} now has ${n} positions`);
    if (ok) {
      setEdits((d) => {
        const next = { ...d };
        delete next[rack.letter];
        return next;
      });
    }
  };

  const handleDelete = (rack) => {
    if (!window.confirm(`Delete Rack ${rack.letter}?`)) return;
    run(() => deleteRack(rack.letter), `Rack ${rack.letter} deleted`);
  };

  const inputCls =
    "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm font-semibold text-text focus:border-primary focus:outline-none";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md space-y-5 rounded-2xl bg-surface p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-text">Manage Racks</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-text" aria-label="Close">✕</button>
        </div>

        {free.length > 0 ? (
          <form onSubmit={handleAdd} className="rounded-xl border border-border p-4">
            <p className="text-sm font-semibold text-text">Add Rack</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block text-xs font-medium text-muted">
                Rack
                <select value={letter} onChange={(e) => setLetter(e.target.value)} className={`${inputCls} mt-1`}>
                  {free.map((l) => (
                    <option key={l} value={l}>Rack {l}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-muted">
                Number of positions
                <input
                  type="number"
                  min="1"
                  max="999"
                  value={positions}
                  onChange={(e) => setPositions(e.target.value)}
                  className={`${inputCls} mt-1`}
                />
              </label>
            </div>
            {letter && Number(positions) >= 1 && (
              <p className="mt-2 text-xs text-muted">
                Creates positions <span className="font-semibold text-primary">{positionCode(letter, 1)}</span> to{" "}
                <span className="font-semibold text-primary">{positionCode(letter, Math.min(Number(positions), 999))}</span>
              </p>
            )}
            <button
              type="submit"
              disabled={busy || !letter || !(Number(positions) >= 1)}
              className="mt-3 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
            >
              Add Rack
            </button>
          </form>
        ) : (
          <p className="rounded-xl bg-bg p-3 text-sm text-muted">All racks A to Z have been added.</p>
        )}

        <div>
          <p className="text-sm font-semibold text-text">Your racks ({racks.length})</p>
          {racks.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No racks yet. Add your first rack above.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
              {racks.map((rack) => {
                const draft = edits[rack.letter] ?? String(rack.positions);
                const changed = Number(draft) !== rack.positions;
                const count = productCounts[rack.letter] || 0;
                return (
                  <li key={rack.letter} className="flex items-center gap-3 px-3 py-2.5">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary font-display text-lg font-extrabold text-white">
                      {rack.letter}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted">
                        {positionCode(rack.letter, 1)} – {positionCode(rack.letter, rack.positions)} · {count} product{count === 1 ? "" : "s"}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <input
                          type="number"
                          min="1"
                          max="999"
                          aria-label={`Positions on Rack ${rack.letter}`}
                          value={draft}
                          onChange={(e) => setEdits((d) => ({ ...d, [rack.letter]: e.target.value }))}
                          className="w-20 rounded-lg border border-border bg-surface px-2 py-1 text-sm font-semibold text-text focus:border-primary focus:outline-none"
                        />
                        <span className="text-xs text-muted">positions</span>
                        {changed && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleResize(rack)}
                            className="rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
                          >
                            Save
                          </button>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleDelete(rack)}
                      className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
