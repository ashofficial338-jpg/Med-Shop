import { Fragment, useMemo, useRef, useState } from "react";
import { checkUploadRows, downloadUploadTemplate, saveUploadedInvoice } from "../api/imports";
import { createCustomer, searchCustomers } from "../api/customers";
import { getErrorMessage } from "../api/client";
import { readExcelRows } from "../utils/readExcel";

// Excel upload for Purchases (kind="purchases") and Sales (kind="sales").
// 1. Choose a file - it's read here and checked by the server (nothing saved).
// 2. Preview: every invoice with its lines, errors and warnings. Invoices
//    with errors (or already recorded) can't be ticked; fix the file and
//    upload it again.
// 3. Save: ticked invoices are saved one by one through the normal purchase /
//    billing save, with progress, then a summary of saved / failed / skipped.

const TEXT = {
  purchases: { title: "Upload Purchases (Excel)", party: "Supplier", noParty: "No supplier", module: "Purchase History" },
  sales: { title: "Upload Sales (Excel)", party: "Customer", noParty: "Walk-in", module: "Bill History" },
};

const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = (iso) => (iso ? iso.split("-").reverse().join("-") : "");
const countIssues = (inv, key) => inv[key].length + inv.lines.reduce((s, l) => s + l[key].length, 0);

export default function ExcelUploadModal({ kind, onClose, onSaved }) {
  const t = TEXT[kind];
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState("");
  const [stage, setStage] = useState("choose"); // choose | checking | preview | saving | done
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // check response
  const [selected, setSelected] = useState(new Set());
  const [open, setOpen] = useState(new Set());
  const [filter, setFilter] = useState("all");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [outcome, setOutcome] = useState({}); // key -> { ok, message }
  const [downloading, setDownloading] = useState(false);

  const invoices = useMemo(() => result?.invoices || [], [result]);
  const ready = invoices.filter((i) => i.ok);
  const withErrors = invoices.filter((i) => !i.ok && !i.duplicate);
  const duplicates = invoices.filter((i) => i.duplicate);
  const withWarnings = invoices.filter((i) => i.ok && countIssues(i, "warnings") > 0);
  const shown = invoices.filter((i) =>
    filter === "ready" ? i.ok : filter === "errors" ? !i.ok && !i.duplicate : filter === "duplicates" ? i.duplicate : filter === "warnings" ? i.ok && countIssues(i, "warnings") > 0 : true
  );

  const reset = () => {
    setResult(null);
    setSelected(new Set());
    setOpen(new Set());
    setOutcome({});
    setFilter("all");
    setError("");
    setFileName("");
    setStage("choose");
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFile = async (file) => {
    if (!file) return;
    setFileName(file.name);
    setError("");
    setStage("checking");
    try {
      const rows = await readExcelRows(file);
      if (rows.length === 0) throw new Error("The file has no rows under the header row.");
      const data = await checkUploadRows(kind, rows);
      setResult(data);
      setSelected(new Set(data.invoices.filter((i) => i.ok).map((i) => i.key)));
      // Open the invoices that need attention, so their problems are visible.
      setOpen(new Set(data.invoices.filter((i) => !i.ok).slice(0, 20).map((i) => i.key)));
      setFilter("all");
      setStage("preview");
    } catch (err) {
      setError(err.response ? getErrorMessage(err, "The file couldn't be checked.") : err.message || "The file couldn't be read.");
      setStage("choose");
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const toggle = (set, setter, key) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  };
  const allReadyTicked = ready.length > 0 && ready.every((i) => selected.has(i.key));

  // A new customer is added once and reused by every bill in the file.
  const customerFor = async (newCustomer, cache) => {
    const key = newCustomer.phone || `name:${newCustomer.name.toLowerCase()}`;
    if (cache.has(key)) return cache.get(key);
    let customer;
    try {
      customer = await createCustomer(newCustomer);
    } catch (err) {
      if (err.response?.status === 409 && newCustomer.phone) {
        const found = await searchCustomers(newCustomer.phone);
        customer = found.find((c) => c.phone === newCustomer.phone);
      }
      if (!customer) throw err;
    }
    cache.set(key, customer._id);
    return customer._id;
  };

  const save = async () => {
    const queue = invoices.filter((i) => i.ok && selected.has(i.key));
    if (!queue.length) return;
    setStage("saving");
    setProgress({ done: 0, total: queue.length });
    const results = {};
    const customers = new Map();
    for (let n = 0; n < queue.length; n++) {
      const inv = queue[n];
      try {
        const body = { ...inv.save.body };
        if (inv.save.newCustomer && !body.customer) body.customer = await customerFor(inv.save.newCustomer, customers);
        const saved = await saveUploadedInvoice(inv.save.endpoint, body);
        results[inv.key] = { ok: true, message: kind === "sales" ? `Saved as bill ${saved.billNo}` : "Saved" };
      } catch (err) {
        results[inv.key] = { ok: false, message: getErrorMessage(err, "Could not be saved.") };
      }
      setOutcome({ ...results });
      setProgress({ done: n + 1, total: queue.length });
    }
    setStage("done");
    if (Object.values(results).some((r) => r.ok)) onSaved?.();
  };

  const savedCount = Object.values(outcome).filter((r) => r.ok).length;
  const failedCount = Object.values(outcome).filter((r) => !r.ok).length;
  const skippedCount = invoices.length - savedCount - failedCount;

  // Every problem (and, after saving, each failed save) as a spreadsheet, to
  // fix the original file from.
  const downloadProblems = async () => {
    setDownloading(true);
    try {
      const XLSX = await import("xlsx");
      const rows = [];
      for (const inv of invoices) {
        const party = kind === "sales" ? inv.customer?.name || inv.newCustomer?.name || inv.newCustomer?.phone || t.noParty : inv.supplier || t.noParty;
        const add = (row, product, type, message) => rows.push({ "Excel Row": row, "Invoice No": inv.invoiceNo, [t.party]: party, Product: product, Type: type, Problem: message });
        for (const e of inv.errors) add(inv.rows.join(", "), "", "Error", e);
        for (const w of inv.warnings) add(inv.rows.join(", "), "", "Warning", w);
        for (const l of inv.lines) {
          for (const e of l.errors) add(l.row, l.product, "Error", e);
          for (const w of l.warnings) add(l.row, l.product, "Warning", w);
        }
        if (outcome[inv.key] && !outcome[inv.key].ok) add(inv.rows.join(", "), "", "Not saved", outcome[inv.key].message);
      }
      const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Problem: "No problems found." }]);
      ws["!cols"] = [{ wch: 10 }, { wch: 14 }, { wch: 22 }, { wch: 24 }, { wch: 10 }, { wch: 90 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Problems");
      XLSX.writeFile(wb, `${kind === "sales" ? "Sales" : "Purchase"}_Upload_Problems.xlsx`);
    } finally {
      setDownloading(false);
    }
  };

  const status = (inv) => {
    const o = outcome[inv.key];
    if (o) return o.ok ? <span className="text-success">{o.message}</span> : <span className="text-danger">Failed: {o.message}</span>;
    if (inv.duplicate) return <span className="font-semibold text-danger">Duplicate</span>;
    if (!inv.ok) return <span className="font-semibold text-danger">{countIssues(inv, "errors")} error(s)</span>;
    const w = countIssues(inv, "warnings");
    return w ? <span className="font-semibold text-warning">Ready · {w} warning(s)</span> : <span className="font-semibold text-success">Ready</span>;
  };

  const busy = stage === "checking" || stage === "saving";
  const btn = "rounded-lg border border-border px-4 py-2 text-sm font-semibold text-primary hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8">
      <div className="w-full max-w-5xl space-y-4 rounded-2xl bg-surface p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-text">{t.title}</h2>
          <button onClick={onClose} disabled={stage === "saving"} className="text-muted hover:text-text disabled:opacity-40" aria-label="Close">✕</button>
        </div>

        {(stage === "choose" || stage === "checking") && (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              One row per product line; rows with the same Invoice No{kind === "purchases" ? " and Supplier" : ""} become one invoice. Nothing is saved until you
              check the preview and click Save.
            </p>
            <button onClick={() => downloadUploadTemplate(kind)} className="text-sm font-semibold text-primary hover:underline">
              Download Excel Template
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              disabled={busy}
              onChange={(e) => handleFile(e.target.files[0])}
              className="block w-full text-sm text-text file:mr-3 file:rounded-lg file:border-0 file:bg-bg file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-primary"
            />
            {stage === "checking" && <p className="text-sm text-muted">Reading and checking {fileName}…</p>}
            {error && <p className="text-sm text-danger">{error}</p>}
          </div>
        )}

        {result && stage !== "choose" && stage !== "checking" && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-lg bg-bg px-2.5 py-1.5 text-text">{fileName} · {result.rowsRead} rows · {invoices.length} invoices</span>
              {[
                ["all", `All ${invoices.length}`, "text-text"],
                ["ready", `Ready ${ready.length}`, "text-success"],
                ["warnings", `With warnings ${withWarnings.length}`, "text-warning"],
                ["errors", `With errors ${withErrors.length}`, "text-danger"],
                ["duplicates", `Duplicates ${duplicates.length}`, "text-danger"],
              ].map(([key, label, cls]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`rounded-lg border px-2.5 py-1.5 font-semibold ${cls} ${filter === key ? "border-primary bg-primary-soft" : "border-border hover:bg-bg"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {result.columns.unknown.length > 0 && (
              <p className="text-xs text-muted">
                Columns not used: {result.columns.unknown.join(", ")}. Matched: {result.columns.mapped.map((m) => m.header).join(", ")}.
              </p>
            )}

            {(stage === "saving" || stage === "done") && (
              <div className="rounded-xl border border-border p-3">
                <div className="flex justify-between text-sm text-text">
                  <span>{stage === "saving" ? `Saving ${progress.done} of ${progress.total}…` : "Finished"}</span>
                  <span>
                    <span className="text-success">{savedCount} saved</span> · <span className="text-danger">{failedCount} failed</span> ·{" "}
                    <span className="text-muted">{skippedCount} not saved (errors, duplicates or unticked)</span>
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-bg">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
                </div>
              </div>
            )}

            <div className="max-h-[55vh] overflow-auto rounded-xl border border-border">
              <table className="w-full text-left text-sm text-text">
                <thead className="sticky top-0 border-b border-border bg-surface text-xs uppercase text-muted">
                  <tr>
                    <th className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label="Tick all ready invoices"
                        checked={allReadyTicked}
                        disabled={stage !== "preview" || ready.length === 0}
                        onChange={() => setSelected(allReadyTicked ? new Set() : new Set(ready.map((i) => i.key)))}
                      />
                    </th>
                    <th className="px-3 py-2">Invoice</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">{t.party}</th>
                    <th className="px-3 py-2">Mode</th>
                    <th className="px-3 py-2 text-right">Lines</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center text-muted">No invoices in this view.</td>
                    </tr>
                  )}
                  {shown.map((inv) => {
                    const party =
                      kind === "sales"
                        ? inv.customer
                          ? `${inv.customer.name}${inv.customer.phone ? ` · ${inv.customer.phone}` : ""}`
                          : inv.newCustomer
                            ? `${inv.newCustomer.name || inv.newCustomer.phone} (new)`
                            : t.noParty
                        : inv.supplier
                          ? `${inv.supplier}${inv.supplierKind === "unregistered" ? " (unregistered)" : ""}`
                          : t.noParty;
                    const isOpen = open.has(inv.key);
                    return (
                      <Fragment key={inv.key}>
                        <tr className="border-b border-border">
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              aria-label={`Save invoice ${inv.invoiceNo}`}
                              checked={selected.has(inv.key)}
                              disabled={!inv.ok || stage !== "preview"}
                              onChange={() => toggle(selected, setSelected, inv.key)}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <button onClick={() => toggle(open, setOpen, inv.key)} className="font-mono text-xs font-semibold text-primary hover:underline">
                              {isOpen ? "▾" : "▸"} {inv.invoiceNo || "(no invoice no)"}
                            </button>
                            <span className="block text-[11px] text-muted">Row{inv.rows.length > 1 ? "s" : ""} {inv.rows.join(", ")}</span>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">{dmy(inv.date)}</td>
                          <td className="px-3 py-2">{party}</td>
                          <td className="px-3 py-2">{inv.paymentMode}</td>
                          <td className="px-3 py-2 text-right">{inv.lines.length}</td>
                          <td className="px-3 py-2 text-right font-mono">
                            {money(inv.total)}
                            {inv.excelTotal !== null && Math.abs(inv.excelTotal - inv.total) > 1 && (
                              <span className="block text-[11px] text-warning">file: {money(inv.excelTotal)}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs">{status(inv)}</td>
                        </tr>
                        {isOpen && (
                          <tr className="border-b border-border bg-bg/60">
                            <td />
                            <td colSpan={7} className="px-3 py-2">
                              {inv.errors.map((e, i) => (
                                <p key={`e${i}`} className="text-xs text-danger">✕ {e}</p>
                              ))}
                              {inv.warnings.map((w, i) => (
                                <p key={`w${i}`} className="text-xs text-warning">! {w}</p>
                              ))}
                              <table className="mt-1 w-full text-xs">
                                <thead className="text-muted">
                                  <tr>
                                    <th className="py-1 pr-2 text-left">Row</th>
                                    <th className="py-1 pr-2 text-left">Product</th>
                                    <th className="py-1 pr-2 text-right">Qty</th>
                                    <th className="py-1 pr-2 text-right">Rate</th>
                                    <th className="py-1 pr-2 text-right">GST</th>
                                    <th className="py-1 pr-2 text-right">Amount</th>
                                    <th className="py-1 text-left">Notes</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {inv.lines.map((l) => (
                                    <tr key={l.row} className="align-top">
                                      <td className="py-1 pr-2 text-muted">{l.row}</td>
                                      <td className="py-1 pr-2">
                                        {l.matchedName || l.product}
                                        {l.isNew && <span className="ml-1 font-semibold text-secondary">new</span>}
                                        {kind === "purchases" && (l.batchNo || l.expiryDate) && (
                                          <span className="block text-muted">
                                            {l.batchNo && `Batch ${l.batchNo}`} {l.expiryDate && `· Exp ${dmy(l.expiryDate)}`}
                                          </span>
                                        )}
                                      </td>
                                      <td className="py-1 pr-2 text-right">
                                        {l.qty ?? "—"} {l.unitLabel || ""}
                                      </td>
                                      <td className="py-1 pr-2 text-right font-mono">{money(l.rate)}</td>
                                      <td className="py-1 pr-2 text-right">{l.gst}%</td>
                                      <td className="py-1 pr-2 text-right font-mono">{money(l.amount + l.gstAmount)}</td>
                                      <td className="py-1">
                                        {l.errors.map((e, i) => (
                                          <p key={`e${i}`} className="text-danger">✕ {e}</p>
                                        ))}
                                        {l.warnings.map((w, i) => (
                                          <p key={`w${i}`} className="text-warning">! {w}</p>
                                        ))}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              <p className="mt-1 text-right text-xs text-muted">
                                Subtotal {money(inv.subtotal)} · GST {money(inv.gstAmount)}
                                {inv.discount ? ` · Discount ${money(inv.discount)}` : ""} · Total {money(inv.total)}
                                {inv.paymentMode === "Credit" ? ` · ${kind === "sales" ? "Received" : "Paid"} now ${money(kind === "sales" ? inv.amountReceived : inv.amountPaid)}` : ""}
                              </p>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {withErrors.length + duplicates.length > 0 && stage === "preview" && (
              <p className="text-xs text-muted">
                Invoices with errors or already recorded can't be saved. Fix them in the Excel file and upload it again - invoices saved now will show as duplicates
                next time, so nothing is saved twice.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {stage === "preview" && (
                <button
                  onClick={save}
                  disabled={selected.size === 0}
                  className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-primary-dark"
                >
                  Save {selected.size} invoice{selected.size === 1 ? "" : "s"}
                </button>
              )}
              {stage === "saving" && (
                <button disabled className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white opacity-50">
                  Saving {progress.done} of {progress.total}…
                </button>
              )}
              <button onClick={downloadProblems} disabled={downloading || stage === "saving"} className={btn}>
                {downloading ? "Preparing…" : "Download problems (.xlsx)"}
              </button>
              <button onClick={reset} disabled={stage === "saving"} className={btn}>
                Upload another file
              </button>
              {stage === "done" && (
                <button onClick={onClose} className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-dark">
                  Done - see {t.module}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
