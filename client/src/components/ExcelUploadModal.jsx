import { useRef, useState } from "react";
import Icon from "./Icon";
import { checkUploadRows, downloadUploadTemplate, saveUploadedInvoice } from "../api/imports";
import { getErrorMessage } from "../api/client";
import { readExcelRows } from "../utils/readExcel";

// Excel upload for Purchases (kind="purchases") and Sales (kind="sales"):
// Download Template -> Fill -> Upload -> Save. Suppliers, customers and
// products named in the file are found or added by the save itself.

const TEXT = {
  purchases: { title: "Upload Purchases from Excel", one: "purchase", many: "purchases" },
  sales: { title: "Upload Sales from Excel", one: "bill", many: "bills" },
};
const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Step({ n, title, children }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-bold text-primary">{n}</span>
      <div className="min-w-0 flex-1">
        <p className="pt-1 text-sm font-semibold text-text">{title}</p>
        <div className="mt-2">{children}</div>
      </div>
    </div>
  );
}

function Problems({ title, list }) {
  if (!list.length) return null;
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="text-sm font-semibold text-danger">{title}</p>
      <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto text-xs text-text">
        {list.map((m, i) => (
          <li key={i}>{m}</li>
        ))}
      </ul>
    </div>
  );
}

export default function ExcelUploadModal({ kind, onClose, onSaved }) {
  const t = TEXT[kind];
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(""); // "reading" | "saving"
  const [error, setError] = useState("");
  const [found, setFound] = useState(null); // the checked file
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null); // { saved, again, failed: [] }

  const ready = found?.entries.filter((e) => e.save) || [];
  const count = (n) => `${n} ${n === 1 ? t.one : t.many}`;

  const pick = async (file) => {
    if (!file || busy) return;
    setFileName(file.name);
    setError("");
    setFound(null);
    setResult(null);
    setBusy("reading");
    try {
      const rows = await readExcelRows(file);
      if (!rows.length) throw new Error("The file has no rows below its header.");
      setFound(await checkUploadRows(kind, rows));
    } catch (err) {
      setError(err.response ? getErrorMessage(err, "The file couldn't be read.") : err.message || "The file couldn't be read.");
    } finally {
      setBusy("");
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const save = async () => {
    setBusy("saving");
    setProgress(0);
    const out = { saved: 0, again: 0, failed: [] };
    for (const [i, e] of ready.entries()) {
      try {
        const r = await saveUploadedInvoice(e.save.endpoint, e.save.body);
        if (r.alreadySaved) out.again += 1;
        else out.saved += 1;
      } catch (err) {
        // Someone saved the same one meanwhile: it's recorded, not lost.
        if (err.response?.status === 409) out.again += 1;
        else out.failed.push(`${e.ref} (${e.party}): ${getErrorMessage(err, "Could not be saved. Upload the file again.")}`);
      }
      setProgress(i + 1);
    }
    setBusy("");
    setResult(out);
    if (out.saved) onSaved?.();
  };

  const primary = "rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8">
      <div role="dialog" aria-modal="true" aria-labelledby="xl-title" className="w-full max-w-xl space-y-5 rounded-2xl bg-surface p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 id="xl-title" className="font-display text-xl font-semibold text-text">{t.title}</h2>
          <button onClick={onClose} disabled={busy === "saving"} className="text-muted hover:text-text disabled:opacity-40" aria-label="Close">✕</button>
        </div>

        {result ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-success/30 bg-success/10 p-4 text-sm text-text" role="status">
              <p className="flex items-center gap-2 font-semibold">
                <Icon name="check" size={18} className="text-success" /> {count(result.saved)} saved
              </p>
              {result.again + found.alreadySaved > 0 && <p className="mt-1 text-xs text-muted">{count(result.again + found.alreadySaved)} in this file had already been saved before.</p>}
            </div>
            <Problems title={`Not saved (${found.problems.length + result.failed.length})`} list={[...found.problems, ...result.failed]} />
            <div className="flex gap-2">
              <button onClick={onClose} className={primary}>Done</button>
              <button
                onClick={() => {
                  setFound(null);
                  setResult(null);
                  setFileName("");
                }}
                className="rounded-xl border border-border px-5 py-2.5 text-sm font-semibold text-primary hover:bg-bg"
              >
                Upload another file
              </button>
            </div>
          </div>
        ) : (
          <>
            <Step n={1} title="Download the template and fill it in">
              <button onClick={() => downloadUploadTemplate(kind)} className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-primary hover:bg-bg">
                <Icon name="download" size={16} /> Download Excel template
              </button>
            </Step>

            <Step n={2} title="Upload the filled file">
              <label
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  pick(e.dataTransfer.files[0]);
                }}
                className="flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed border-border px-4 py-6 text-center hover:border-primary/50"
              >
                <Icon name="download" size={22} className="rotate-180 text-primary" />
                <span className="text-sm font-semibold text-text">{busy === "reading" ? `Reading ${fileName}…` : fileName || "Choose the Excel file"}</span>
                <span className="text-xs text-muted">or drop it here (.xlsx, .xls)</span>
                <input ref={fileRef} type="file" aria-label="Excel file" accept=".xlsx,.xls" disabled={Boolean(busy)} onChange={(e) => pick(e.target.files[0])} className="sr-only" />
              </label>
              {error && <p className="mt-2 text-sm text-danger" role="alert">{error}</p>}
            </Step>

            <Step n={3} title="Save">
              {found && (
                <div className="mb-3 space-y-2 text-sm text-text" role="status">
                  <p>
                    <strong>{count(ready.length)}</strong> ready · {money(ready.reduce((s, e) => s + e.total, 0))}
                    {found.alreadySaved > 0 && <span className="text-muted"> · {found.alreadySaved} already saved before</span>}
                  </p>
                  <Problems title={`Can't be saved (${found.problems.length})`} list={found.problems} />
                </div>
              )}
              <button onClick={save} disabled={!ready.length || Boolean(busy)} className={primary}>
                {busy === "saving" ? `Saving ${progress} of ${ready.length}…` : ready.length ? `Save ${count(ready.length)}` : "Save"}
              </button>
            </Step>
          </>
        )}
      </div>
    </div>
  );
}
