import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import Layout from "../components/Layout";
import DocumentViewer from "../components/DocumentViewer";
import { ItemSelect, StatusBadge, inr, showDate } from "../components/purchase/poCommon";
import { useLiveRefresh } from "../context/LiveSync";
import { listProducts } from "../api/products";
import { purchaseInvoicePdf } from "../api/purchases";
import {
  downloadExtraTemplate,
  previewExtraRows,
  importExtraRows,
  listExtraImports,
  getExtraImport,
  downloadExtraOriginal,
  extraImportPdf,
  listIncompletePurchases,
  updateIncompletePurchase,
  completeIncompletePurchase,
  discardIncompletePurchase,
} from "../api/extraPurchases";
import { readExcelRows } from "../utils/readExcel";
import { newEntryRef } from "../utils/entryRef";

const TABS = [
  ["upload", "Upload & Preview"],
  ["history", "Import History"],
  ["incomplete", "Incomplete Records"],
];
const FIELDS = [
  ["date", "Purchase Date", "w-28"],
  ["supplier", "Supplier", "w-36"],
  ["invoiceNo", "Invoice No", "w-28"],
  ["itemCode", "Item Code", "w-24"],
  ["itemName", "Item Name", "w-40"],
  ["category", "Category", "w-28"],
  ["qty", "Qty", "w-16"],
  ["unit", "Unit", "w-20"],
  ["rate", "Rate", "w-20"],
  ["discount", "Disc %", "w-16"],
  ["gst", "GST %", "w-16"],
  ["total", "Total", "w-24"],
  ["remarks", "Remarks", "w-40"],
];
const KEYS = FIELDS.map(([k]) => k);
const editable = (r) => ({ row: r.row, productId: r.productId, ...Object.fromEntries(KEYS.map((k) => [k, r[k] ?? ""])) });
const STATUS = {
  ready: ["Ready", "bg-success/15 text-success"],
  incomplete: ["Incomplete", "bg-warning/15 text-warning"],
  duplicate: ["Already recorded", "bg-danger/10 text-danger"],
};
const cell = "rounded-md border border-border bg-surface px-1.5 py-1 text-xs text-text focus:border-primary focus:outline-none";

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = reject;
    r.readAsDataURL(file);
  });

export default function ExtraPurchases() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([k]) => k === params.get("tab")) ? params.get("tab") : "upload";
  const [products, setProducts] = useState([]);
  useEffect(() => {
    listProducts().then(setProducts).catch(() => {});
  }, []);
  useLiveRefresh(["products"], () => listProducts().then(setProducts).catch(() => {}));

  return (
    <Layout>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">Extra Purchases</h1>
          <p className="mt-0.5 text-sm text-muted">Bulk purchase entry from Excel - every column is optional. Separate from Purchase Order purchases.</p>
        </div>
        <button type="button" onClick={() => downloadExtraTemplate().catch(() => toast.error("Could not download the template."))} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-primary hover:bg-bg">
          Download Excel Template
        </button>
      </div>
      <div className="mt-4 flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setParams({ tab: k }, { replace: true })} className={`shrink-0 whitespace-nowrap px-4 py-2 text-sm font-semibold ${tab === k ? "border-b-2 border-primary text-primary" : "text-muted"}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "upload" && <UploadTab products={products} onDone={() => setParams({ tab: "history" }, { replace: true })} />}
      {tab === "history" && <HistoryTab />}
      {tab === "incomplete" && <IncompleteTab products={products} />}
    </Layout>
  );
}

// ---------- Upload & Preview ----------

function UploadTab({ products, onDone }) {
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState(null); // editable rows
  const [check, setCheck] = useState(null); // server's analysis
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [paymentMode, setPaymentMode] = useState("Credit");
  const [result, setResult] = useState(null);
  const ref = useRef(newEntryRef());
  const input = useRef(null);
  const seq = useRef(0);

  const recheck = (next) => {
    const mine = ++seq.current;
    previewExtraRows({ rows: next })
      .then((c) => mine === seq.current && setCheck(c))
      .catch((err) => mine === seq.current && setError(err.response?.data?.message || "Could not check the rows."));
  };
  useEffect(() => {
    if (!rows) return undefined;
    const t = setTimeout(() => recheck(rows), 400);
    return () => clearTimeout(t);
  }, [rows]);

  const choose = async (f) => {
    if (!f) return;
    setError("");
    setResult(null);
    setBusy("Reading the file…");
    try {
      const raw = await readExcelRows(f);
      const c = await previewExtraRows({ raw });
      ref.current = newEntryRef();
      setFile(f);
      setCheck(c);
      setRows(c.rows.map(editable));
      if (!c.rows.length) setError("The file has no filled rows below its header.");
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Could not read the file.");
    } finally {
      setBusy("");
      if (input.current) input.current.value = "";
    }
  };

  const setField = (row, patch) => setRows((rs) => rs.map((r) => (r.row === row ? { ...r, ...patch } : r)));
  const removeRow = (row) => setRows((rs) => rs.filter((r) => r.row !== row));
  const byRow = new Map((check?.rows || []).map((a) => [a.row, a]));
  const s = check?.summary;

  const confirm = async () => {
    if (!rows?.length || busy) return;
    if (!window.confirm(`Import ${s.rows} row(s)? ${s.ready} will be saved as purchases and add stock; ${s.incomplete} will be kept as incomplete records without stock changes${s.duplicate ? `; ${s.duplicate} already-recorded row(s) are skipped` : ""}.`)) return;
    setBusy("Importing…");
    setError("");
    try {
      const data = await fileToBase64(file).catch(() => "");
      const out = await importExtraRows({ rows, fileName: file.name, fileType: file.type, fileData: data, paymentMode, clientRef: ref.current });
      setResult(out.import);
      setRows(null);
      setCheck(null);
      toast.success(`Import ${out.import.refNo} done: ${out.import.importedRows} imported, ${out.import.incompleteRows} incomplete, ${out.import.failedRows} not imported.`);
    } catch (err) {
      setError(err.response?.data?.message || "The import didn't finish. Press Confirm again - nothing will be saved twice.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="mt-4 space-y-4">
      {!rows && (
        <div className="rounded-2xl border-2 border-dashed border-border bg-surface p-6 text-center">
          <p className="text-sm text-text">Fill the template with whatever details you have - no column is required - then upload it.</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={() => input.current?.click()} disabled={Boolean(busy)} className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50">
              {busy || "Upload Excel (.xlsx / .xls)"}
            </button>
          </div>
          <input ref={input} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => choose(e.target.files?.[0])} />
        </div>
      )}

      {result && (
        <div className="rounded-xl border border-success/30 bg-success/10 p-4 text-sm text-text" role="status">
          <p className="font-semibold">Import {result.refNo} complete</p>
          <p className="mt-1">
            {result.totalRows} rows · {result.importedRows} imported (stock added) · {result.incompleteRows} incomplete · {result.failedRows} not imported · {inr(result.totalValue)}
          </p>
          {result.failures?.length > 0 && (
            <ul className="mt-1 text-xs text-danger">{result.failures.slice(0, 10).map((f) => <li key={f.row}>Row {f.row}: {f.reason}</li>)}</ul>
          )}
          <button onClick={onDone} className="mt-2 text-sm font-semibold text-primary hover:underline">Open import history →</button>
        </div>
      )}

      {error && <p className="text-sm text-danger" role="alert">{error}</p>}

      {rows && s && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-text">
              <strong>{file?.name}</strong> · {s.rows} rows
            </p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-1.5 text-muted">
                Supplier purchases paid by
                <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text">
                  <option value="Credit">Credit (pay later)</option>
                  <option value="Cash">Cash (paid)</option>
                </select>
              </label>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Ready to import", s.ready],
              ["Incomplete (no stock)", s.incomplete],
              ["Already recorded", s.duplicate],
              ["Items", s.items],
              ["Total qty", s.qty],
              ["Purchase value", inr(s.value)],
            ].map(([l, v]) => (
              <div key={l} className="rounded-2xl bg-surface p-3 shadow-sm">
                <p className="text-xs font-medium text-muted">{l}</p>
                <p className="mt-0.5 font-mono text-base font-semibold text-text">{v}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted">
            {check.groups.length} purchase{check.groups.length === 1 ? "" : "s"} will be created. Blank cells are fine. Edit any cell below; the check updates as you type. Rows without an item and a quantity are saved as incomplete records you can finish later.
          </p>

          <div className="overflow-x-auto rounded-xl bg-surface shadow-sm">
            <table className="text-left text-xs text-text">
              <thead className="border-b border-border text-[11px] uppercase text-muted">
                <tr>
                  <th className="px-2 py-2">Row</th>
                  <th className="px-2 py-2">Status</th>
                  {FIELDS.map(([k, l]) => <th key={k} className="px-1 py-2">{l}</th>)}
                  <th className="px-2 py-2">Matched item</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const a = byRow.get(r.row);
                  const [label, tone] = STATUS[a?.status] || ["…", "bg-bg text-muted"];
                  return (
                    <tr key={r.row} className="border-b border-border align-top last:border-0">
                      <td className="px-2 py-1.5 text-muted">{r.row}</td>
                      <td className="px-2 py-1.5">
                        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{label}</span>
                        {a?.missing?.length > 0 && <p className="mt-0.5 whitespace-nowrap text-[11px] text-muted">needs {a.missing.join(" + ")}</p>}
                      </td>
                      {FIELDS.map(([k, l, w]) => (
                        <td key={k} className="px-1 py-1.5">
                          <input aria-label={`${l}, row ${r.row}`} value={r[k]} onChange={(e) => setField(r.row, { [k]: e.target.value, ...(["itemCode", "itemName"].includes(k) ? { productId: undefined } : {}) })} className={`${cell} ${w}`} />
                        </td>
                      ))}
                      <td className="w-48 px-2 py-1.5">
                        {a?.product ? (
                          <p className="text-[11px]"><span className="font-semibold">{a.product.name}</span> <span className="text-muted">({a.match === "code" ? "by code" : a.match === "name" ? "by name" : "picked"})</span></p>
                        ) : a?.match === "new" ? (
                          <p className="text-[11px] text-primary">New item will be added</p>
                        ) : (
                          <p className="text-[11px] text-muted">No item</p>
                        )}
                        <div className="mt-1 w-44">
                          <ItemSelect products={products} value={r.productId || ""} onPick={(p) => setField(r.row, { productId: p._id })} inputCls={`${cell} w-full`} />
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono">{a?.amount != null ? inr(a.amount) : ""}</td>
                      <td className="px-2 py-1.5">
                        <button type="button" onClick={() => removeRow(r.row)} className="text-muted hover:text-danger" aria-label={`Remove row ${r.row}`}>✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {check.rows.some((a) => a.warnings.length) && (
            <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-text">
              <p className="font-semibold">Please check these entered values</p>
              <ul className="mt-1 space-y-0.5">
                {check.rows.flatMap((a) => a.warnings.map((w, i) => <li key={`${a.row}-${i}`}>Row {a.row}: {w}</li>))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2 pb-6">
            <button type="button" onClick={confirm} disabled={Boolean(busy) || !rows.length} className="rounded-xl bg-accent px-8 py-3 text-base font-semibold text-white hover:brightness-95 disabled:opacity-50">
              {busy || "Confirm Import"}
            </button>
            <button type="button" onClick={() => (setRows(null), setCheck(null), setFile(null))} disabled={busy === "Importing…"} className="rounded-xl px-5 py-3 text-sm font-semibold text-muted hover:bg-surface">
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Import History ----------

function HistoryTab() {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  const [doc, setDoc] = useState(null);
  const load = () => listExtraImports().then(setList).catch(() => setList([]));
  useEffect(() => {
    load();
  }, []);
  useLiveRefresh(["extra-purchases", "purchases"], load);
  useEffect(() => {
    setDetail(null);
    if (open) getExtraImport(open).then(setDetail).catch(() => {});
  }, [open]);

  const btn = "rounded-lg border border-border px-3 py-1 text-xs font-semibold text-primary hover:bg-bg";
  return (
    <div className="mt-4 space-y-2">
      {!list && <p className="text-sm text-muted">Loading…</p>}
      {list?.length === 0 && <p className="text-sm text-muted">No uploads yet.</p>}
      {list?.map((imp) => (
        <div key={imp._id} className="rounded-xl bg-surface p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-medium text-text">
                <span className="font-mono text-primary">{imp.refNo}</span> · {imp.fileName || "Upload"}
              </p>
              <p className="text-xs text-muted">
                {new Date(imp.createdAt).toLocaleString("en-IN")} · by {imp.uploadedBy?.username}
              </p>
              <p className="mt-1 text-xs text-text">
                {imp.totalRows} rows · <span className="text-success">{imp.importedRows} imported</span> · <span className="text-warning">{imp.incompleteRows} incomplete</span> · <span className="text-danger">{imp.failedRows} failed</span> · {inr(imp.totalValue)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setOpen(open === imp._id ? null : imp._id)} className={btn}>{open === imp._id ? "Hide" : "Details"}</button>
              <button onClick={() => setDoc({ title: `Extra Purchase Import ${imp.refNo}`, filename: `${imp.refNo}.pdf`, load: () => extraImportPdf(imp._id) })} className={btn}>Print / PDF</button>
              {imp.fileSize > 0 && <button onClick={() => downloadExtraOriginal(imp._id, imp.fileName).catch(() => toast.error("Could not download the file."))} className={btn}>Original Excel</button>}
            </div>
          </div>
          {open === imp._id && (
            <div className="mt-3 border-t border-border pt-3 text-xs">
              {!detail && <p className="text-muted">Loading…</p>}
              {detail && (
                <>
                  <p className="font-semibold text-text">Purchases created</p>
                  {detail.purchases.length === 0 && <p className="text-muted">None.</p>}
                  <ul className="mt-1 space-y-1">
                    {detail.purchases.map((p) => (
                      <li key={p._id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-bg px-2 py-1.5">
                        <span>
                          <span className="font-mono font-semibold">{p.extraRef}</span> / {p.piNo} · {p.vendor?.name || "No supplier"} · inv {p.invoiceNo} · {showDate(p.date)} · {p.items.length} item(s) · {inr(p.total)}
                        </span>
                        <span className="flex gap-2">
                          <button onClick={() => setDoc({ title: `Purchase Invoice ${p.piNo}`, filename: `${p.piNo}.pdf`, load: () => purchaseInvoicePdf(p._id) })} className={btn}>Print / PDF</button>
                          <Link to={`/purchases/${p._id}/edit`} className={btn}>Edit</Link>
                        </span>
                      </li>
                    ))}
                  </ul>
                  {detail.incomplete.length > 0 && (
                    <>
                      <p className="mt-3 font-semibold text-text">Incomplete records</p>
                      <ul className="mt-1 space-y-0.5 text-muted">
                        {detail.incomplete.map((x) => (
                          <li key={x._id}>
                            {x.refNo} · row {x.row} · {x.itemName || x.itemCode || "no item"} · <StatusBadge status={x.status === "Open" ? "Pending" : x.status === "Completed" ? "Completed" : "Cancelled"} /> {x.status}
                            {x.status === "Open" && x.missing ? ` – needs ${x.missing}` : ""}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {detail.failures?.length > 0 && (
                    <>
                      <p className="mt-3 font-semibold text-text">Not imported</p>
                      <ul className="mt-1 space-y-0.5 text-danger">{detail.failures.map((f) => <li key={f.row}>Row {f.row}: {f.reason}</li>)}</ul>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      ))}
      {doc && <DocumentViewer {...doc} onClose={() => setDoc(null)} />}
    </div>
  );
}

// ---------- Incomplete Records ----------

const fromRecord = (x) => ({
  date: x.purchaseDate || "",
  supplier: x.supplierName || "",
  invoiceNo: x.invoiceNo || "",
  itemCode: x.itemCode || "",
  itemName: x.itemName || "",
  category: x.category || "",
  qty: x.qty ?? "",
  unit: x.unit || "",
  rate: x.rate ?? "",
  discount: x.discount ?? "",
  gst: x.gst ?? "",
  total: x.totalAmount ?? "",
  remarks: x.remarks || "",
});

function IncompleteTab({ products }) {
  const [status, setStatus] = useState("Open");
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null); // { id, fields, productId }
  const [busy, setBusy] = useState(false);
  const load = () => listIncompletePurchases(status).then(setList).catch(() => setList([]));
  useEffect(() => {
    setList(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
  useLiveRefresh(["extra-purchases"], load);

  const act = async (fn, done) => {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  const payload = () => ({ ...editing.fields, productId: editing.productId });

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text">
          <option value="Open">Open (to complete)</option>
          <option value="Completed">Completed</option>
          <option value="Discarded">Discarded</option>
        </select>
        <p className="text-xs text-muted">Incomplete rows changed no stock. Add the item and quantity, then Complete to save it as a purchase and add stock.</p>
      </div>
      {!list && <p className="text-sm text-muted">Loading…</p>}
      {list?.length === 0 && <p className="text-sm text-muted">No records.</p>}
      {list?.map((x) => (
        <div key={x._id} className="rounded-xl bg-surface p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="text-sm">
              <p className="font-medium text-text">
                <span className="font-mono text-primary">{x.refNo}</span> · {x.itemName || x.itemCode || "No item"}{x.qty ? ` × ${x.qty}` : ""}
                {x.status === "Open" && x.missing && <span className="ml-2 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">needs {x.missing}</span>}
              </p>
              <p className="text-xs text-muted">
                {[x.supplierName, x.invoiceNo && `inv ${x.invoiceNo}`, x.purchaseDate && showDate(x.purchaseDate), x.totalAmount != null && inr(x.totalAmount), x.remarks].filter(Boolean).join(" · ") || "No other details"}
                {x.importBatch ? ` · from ${x.importBatch.refNo} row ${x.row}` : ""}
                {x.purchase ? ` · saved as ${x.purchase.extraRef} / ${x.purchase.piNo}` : ""}
              </p>
            </div>
            {x.status === "Open" && editing?.id !== x._id && (
              <div className="flex gap-2">
                <button onClick={() => setEditing({ id: x._id, fields: fromRecord(x), productId: undefined })} className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-white hover:brightness-95">Complete / Edit</button>
                <button onClick={() => window.confirm(`Discard ${x.refNo}? It stays in the history as discarded.`) && act(() => discardIncompletePurchase(x._id), `${x.refNo} discarded.`)} className="rounded-lg border border-danger/40 px-3 py-1 text-xs font-semibold text-danger hover:bg-danger/10">Discard</button>
              </div>
            )}
          </div>
          {editing?.id === x._id && (
            <div className="mt-3 border-t border-border pt-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                {FIELDS.map(([k, l]) => (
                  <label key={k} className="text-[11px] text-muted">
                    {l}
                    <input value={editing.fields[k]} onChange={(e) => setEditing((ed) => ({ ...ed, fields: { ...ed.fields, [k]: e.target.value }, ...(["itemCode", "itemName"].includes(k) ? { productId: undefined } : {}) }))} className={`${cell} mt-0.5 w-full`} />
                  </label>
                ))}
                <label className="col-span-2 text-[11px] text-muted">
                  Or pick an existing item
                  <ItemSelect products={products} value={editing.productId || ""} onPick={(p) => setEditing((ed) => ({ ...ed, productId: p._id, fields: { ...ed.fields, itemName: p.name, itemCode: p.productCode || "" } }))} inputCls={`${cell} mt-0.5 w-full`} />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button disabled={busy} onClick={() => act(() => completeIncompletePurchase(x._id, payload()), `${x.refNo} completed - purchase saved and stock added.`)} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50">Complete & Add Stock</button>
                <button disabled={busy} onClick={() => act(() => updateIncompletePurchase(x._id, payload()), `${x.refNo} saved.`)} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-primary hover:bg-bg disabled:opacity-50">Save Changes Only</button>
                <button onClick={() => setEditing(null)} className="rounded-lg px-4 py-2 text-sm font-semibold text-muted hover:bg-bg">Cancel</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
