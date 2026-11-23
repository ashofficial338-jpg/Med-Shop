import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import Icon from "./Icon";
import { getErrorMessage } from "../api/client";
import { downloadSalesEntryTemplate, importSalesEntries, previewSalesEntryImport } from "../api/salesEntries";

// Upload Sales Entry Excel: choose the filled-in template -> preview (with
// errors, warnings and duplicates) -> tick what to save -> save -> results.
// Nothing is saved before "Save".

const fmt = (n) => Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function SalesEntryImportModal({ onClose }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState("");
  const [results, setResults] = useState(null);

  const readFile = async () => {
    if (!file) return;
    setBusy("preview");
    try {
      const out = await previewSalesEntryImport(file);
      setPreview(out);
      setPicked(new Set(out.invoices.map((inv, i) => (inv.ok ? i : null)).filter((i) => i !== null)));
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy("");
    }
  };

  const save = async () => {
    const chosen = preview.invoices.filter((_, i) => picked.has(i));
    if (!chosen.length) return;
    setBusy("save");
    try {
      const out = await importSalesEntries(chosen.map(({ ref, rows, body }) => ({ ref, rows, body })));
      setResults(out);
      toast.success(`${out.saved} invoice${out.saved === 1 ? "" : "s"} saved${out.failed ? `, ${out.failed} not saved` : ""}.`);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy("");
    }
  };

  const toggle = (i) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const chosenTotal = preview ? preview.invoices.filter((_, i) => picked.has(i)).reduce((s, inv) => s + (inv.totals?.grandTotal || 0), 0) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8" role="dialog" aria-modal="true" aria-label="Upload Sales Entry Excel">
      <div className="w-full max-w-4xl rounded-2xl bg-surface p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-text">Upload Sales Entry Excel</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted hover:text-text" aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* Step 1: choose file */}
        {!results && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border bg-bg p-4 text-sm">
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setPreview(null);
              }}
              className="text-sm"
            />
            <button type="button" disabled={!file || Boolean(busy)} onClick={readFile} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50">
              {busy === "preview" ? "Reading…" : "Read & Preview"}
            </button>
            <button type="button" onClick={() => downloadSalesEntryTemplate().catch((err) => toast.error(getErrorMessage(err)))} className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
              <Icon name="download" size={14} />
              Download the template
            </button>
          </div>
        )}

        {/* Step 2: preview */}
        {preview && !results && (
          <>
            <p className="mt-4 text-sm text-muted">
              {preview.invoices.length} invoice{preview.invoices.length === 1 ? "" : "s"} found · <span className="font-semibold text-success">{preview.ready} ready</span>
              {preview.withErrors > 0 && (
                <>
                  {" "}
                  · <span className="font-semibold text-danger">{preview.withErrors} with errors (won't be saved)</span>
                </>
              )}
            </p>
            <div className="mt-2 max-h-[55vh] overflow-y-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-bg text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <tr>
                    <th className="w-10 px-3 py-2" />
                    <th className="px-2 py-2">Ref / Rows</th>
                    <th className="px-2 py-2">Date</th>
                    <th className="px-2 py-2">Customer</th>
                    <th className="px-2 py-2">Payment</th>
                    <th className="px-2 py-2">Items</th>
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.invoices.map((inv, i) => (
                    <tr key={i} className={`border-t border-border align-top ${inv.ok ? "" : "bg-danger/5"}`}>
                      <td className="px-3 py-2">
                        <input type="checkbox" className="h-4 w-4" disabled={!inv.ok} checked={picked.has(i)} onChange={() => toggle(i)} aria-label={`Import ${inv.ref || `rows ${inv.rows.join(", ")}`}`} />
                      </td>
                      <td className="px-2 py-2">
                        <p className="font-mono font-semibold text-text">{inv.ref || "-"}</p>
                        <p className="text-[11px] text-muted">row{inv.rows.length > 1 ? "s" : ""} {inv.rows.join(", ")}</p>
                      </td>
                      <td className="px-2 py-2 text-text">{inv.body.invoiceDate ? inv.body.invoiceDate.split("-").reverse().join("-") : "-"}</td>
                      <td className="px-2 py-2 text-text">{inv.body.customer?.name || "Walk-in"}</td>
                      <td className="px-2 py-2 text-text">{inv.body.paymentMode || "-"}</td>
                      <td className="px-2 py-2 text-text">
                        {inv.body.items.map((it, j) => (
                          <p key={j} className="text-xs">
                            {it.name || "?"} × {it.qty ?? "?"} @ ₹{it.rate ?? "?"}
                            {it.discountPercent ? ` −${it.discountPercent}%` : ""} · GST {it.gstPercent ?? "?"}%
                          </p>
                        ))}
                        {inv.errors.map((e, j) => (
                          <p key={`e${j}`} className="mt-1 text-xs font-semibold text-danger">
                            ✕ {e}
                          </p>
                        ))}
                        {inv.warnings.map((w, j) => (
                          <p key={`w${j}`} className="mt-1 text-xs text-warning">
                            ! {w}
                          </p>
                        ))}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-text">{inv.totals ? `₹${fmt(inv.totals.grandTotal)}` : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" disabled={!picked.size || Boolean(busy)} onClick={save} className="inline-flex items-center gap-2 rounded-lg bg-secondary px-5 py-2.5 text-sm font-semibold text-white hover:bg-secondary-dark disabled:opacity-50">
                <Icon name="check" size={16} />
                {busy === "save" ? "Saving…" : `Save ${picked.size} invoice${picked.size === 1 ? "" : "s"} (₹${fmt(chosenTotal)})`}
              </button>
              <span className="text-xs text-muted">Fix rows with errors in Excel and upload again - invoices already saved are skipped automatically.</span>
            </div>
          </>
        )}

        {/* Step 3: results */}
        {results && (
          <>
            <p className="mt-4 text-sm font-semibold text-text">
              {results.saved} saved{results.failed ? `, ${results.failed} not saved` : ""}.
            </p>
            <ul className="mt-2 max-h-[55vh] space-y-1 overflow-y-auto text-sm">
              {results.results.map((r, i) => (
                <li key={i} className={r.ok ? "text-success" : "text-danger"}>
                  <span className="font-mono">{r.ref}</span> →{" "}
                  {r.ok ? (
                    <>
                      <Link to={`/sales-entry/${r._id}`} className="font-mono font-semibold underline" onClick={onClose}>
                        {r.archiveNo}
                      </Link>{" "}
                      ₹{fmt(r.grandTotal)}
                      {r.stockNote && <span className="text-warning"> · {r.stockNote}</span>}
                    </>
                  ) : (
                    r.message
                  )}
                </li>
              ))}
            </ul>
            <button type="button" onClick={onClose} className="mt-4 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-dark">
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}
