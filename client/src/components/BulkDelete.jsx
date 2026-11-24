import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import Icon from "./Icon";
import { getErrorMessage } from "../api/client";

const CHUNK = 50;

// The bar above a list whose rows have checkboxes: select all shown, select
// everything the filters match, and delete the selection after confirming.
// Deleting is one record at a time on the server (its own stock and balances
// are undone with it), so one that can't be deleted never blocks the others.
export default function BulkDelete({ shownIds, selected, setSelected, noun, loadAllIds, deleteMany, note, onDeleted }) {
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [failed, setFailed] = useState([]);
  const [loadingAll, setLoadingAll] = useState(false);

  const n = selected.size;
  const label = (count) => `${count} ${noun}${count === 1 ? "" : "s"}`;
  const allShown = shownIds.length > 0 && shownIds.every((id) => selected.has(id));

  useEffect(() => {
    if (!confirming) return undefined;
    const onKey = (e) => e.key === "Escape" && setConfirming(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirming]);

  const selectEverything = async () => {
    setLoadingAll(true);
    try {
      setSelected(new Set(await loadAllIds()));
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't select them all. Please try again."));
    } finally {
      setLoadingAll(false);
    }
  };

  const run = async () => {
    setConfirming(false);
    const ids = [...selected];
    const problems = [];
    let deleted = 0;
    setProgress({ done: 0, total: ids.length });
    for (let i = 0; i < ids.length; i += CHUNK) {
      const part = ids.slice(i, i + CHUNK);
      try {
        const r = await deleteMany(part);
        deleted += r.deleted;
        problems.push(...r.failed);
      } catch (err) {
        problems.push({ ref: "", message: getErrorMessage(err, "No answer from the server.") });
        break;
      }
      setProgress({ done: Math.min(i + CHUNK, ids.length), total: ids.length });
    }
    setProgress(null);
    setFailed(problems);
    // The ones that couldn't go stay selected.
    setSelected(new Set(problems.map((p) => p.id).filter(Boolean)));
    if (deleted) toast.success(`${label(deleted)} deleted.`);
    onDeleted();
  };

  return (
    <>
      <div className="mt-3 flex min-h-[44px] flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-surface px-4 py-2 text-sm shadow-sm">
        <label className="flex cursor-pointer items-center gap-2 font-medium text-text">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={allShown}
            disabled={!shownIds.length || Boolean(progress)}
            onChange={() => setSelected(allShown ? new Set() : new Set([...selected, ...shownIds]))}
          />
          Select all
        </label>
        {n > 0 && (
          <>
            <span className="text-muted">{n} selected</span>
            <button type="button" onClick={selectEverything} disabled={loadingAll || Boolean(progress)} className="font-semibold text-primary hover:underline disabled:opacity-50">
              {loadingAll ? "Selecting…" : `Select every ${noun} in this list`}
            </button>
            <button type="button" onClick={() => setSelected(new Set())} disabled={Boolean(progress)} className="text-muted hover:text-text">
              Clear
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={Boolean(progress)}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-danger px-4 py-1.5 font-semibold text-white hover:brightness-95 disabled:opacity-60"
            >
              <Icon name="trash" size={15} />
              {progress ? `Deleting ${progress.done} of ${progress.total}…` : `Delete ${label(n)}`}
            </button>
          </>
        )}
      </div>

      {failed.length > 0 && (
        <div className="mt-3 rounded-xl border border-danger/30 bg-surface p-4 text-sm" role="alert">
          <div className="flex items-start justify-between gap-3">
            <p className="font-semibold text-danger">{label(failed.length)} could not be deleted</p>
            <button type="button" onClick={() => setFailed([])} aria-label="Dismiss" className="text-muted hover:text-text">✕</button>
          </div>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-text">
            {failed.map((f, i) => (
              <li key={i}>
                {f.ref && <strong>{f.ref}: </strong>}
                {f.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div role="alertdialog" aria-modal="true" aria-labelledby="bulk-title" className="w-full max-w-sm space-y-4 rounded-2xl bg-surface p-6 shadow-xl">
            <h2 id="bulk-title" className="flex items-center gap-2 font-display text-lg font-bold text-danger">
              <Icon name="alert" size={20} /> Delete {label(n)}?
            </h2>
            <p className="text-sm text-text">{note} This cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <button type="button" autoFocus onClick={() => setConfirming(false)} className="rounded-lg px-5 py-2 text-sm font-semibold text-muted hover:bg-bg">
                Cancel
              </button>
              <button type="button" onClick={run} className="rounded-lg bg-danger px-5 py-2 text-sm font-semibold text-white hover:brightness-95">
                Yes, delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
