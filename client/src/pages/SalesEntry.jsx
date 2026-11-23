import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import Layout from "../components/Layout";
import Icon from "../components/Icon";
import { useAuth } from "../context/AuthContext";
import { getErrorMessage } from "../api/client";
import ProductPicker from "../components/ProductPicker";
import SalesEntryImportModal from "../components/SalesEntryImportModal";
import { downloadSalesEntryTemplate } from "../api/salesEntries";
import { createSalesEntry, deleteSalesEntry, linkSalesEntry, getSalesEntry, getSalesEntryMeta, updateSalesEntry } from "../api/salesEntries";
import { calcInvoice, GST_RATES, PAYMENT_MODES } from "../utils/salesEntryCalc";
import { useLiveRefresh } from "../context/LiveSync";

// Sales Entry: the main place sales are typed in. Saving it also records
// the sale everywhere - stock goes down, a credit sale goes on the customer's
// ledger, and Bill History, Day Book, Dashboard and Reports include it (see
// server routes/salesEntries.js). No PDF/Excel is made on Save. The invoice
// number (SALES-001, ...) is given by the server when saving. A
// product name that isn't in the Product List yet is added to it on Save
// (with its HSN, unit and GST) - see components/ProductPicker.jsx.
//
// /sales-entry      new entry (a half-typed one is kept on this device until saved)
// /sales-entry/:id  open a saved entry; an Admin can edit and save it again

const DRAFT_KEY = "salesEntryDraft";
const fmt = (n) => Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const isoInIndia = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

let keySeq = 0;
const blankRow = () => ({ key: ++keySeq, product: null, name: "", hsnCode: "", unit: "", qty: "1", rate: "", discountPercent: "", gstPercent: 12 });
const blankForm = () => ({ customerName: "", mobile: "", address: "", invoiceDate: todayIso(), paymentMode: "Cash", amountReceived: "", items: [blankRow()] });
const isBlankRow = (r) => !r.name.trim() && !Number(r.rate);

function formFromEntry(e) {
  return {
    customerName: e.customer?.name || "",
    mobile: e.customer?.mobile || "",
    address: e.customer?.address || "",
    amountReceived: e.paymentMode === "Credit" && e.amountReceived ? String(e.amountReceived) : "",
    invoiceDate: isoInIndia(e.invoiceDate),
    paymentMode: e.paymentMode || "Cash",
    items: e.items.map((it) => ({
      key: ++keySeq,
      product: it.product || null,
      name: it.name,
      hsnCode: it.hsnCode || "",
      unit: it.unit && it.unit !== "Nos" ? it.unit : "",
      qty: String(it.qty),
      rate: String(it.rate),
      discountPercent: it.discountPercent ? String(it.discountPercent) : "",
      gstPercent: it.gstPercent,
    })),
  };
}

function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    if (!d || !Array.isArray(d.items) || !d.items.length) return null;
    return { customerName: d.customerName || "", mobile: d.mobile || "", address: d.address || "", amountReceived: d.amountReceived || "", invoiceDate: d.invoiceDate || todayIso(), paymentMode: PAYMENT_MODES.includes(d.paymentMode) ? d.paymentMode : "Cash", items: d.items.map((r) => ({ ...blankRow(), ...r, key: ++keySeq })) };
  } catch {
    return null;
  }
}
function saveDraft(form) {
  try {
    if (!form.customerName.trim() && form.items.every(isBlankRow)) localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
  } catch {
    /* storage unavailable - the draft just isn't kept */
  }
}
function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

// A fresh form for every entry opened (and for "new"), so nothing from one
// entry can ever be saved onto another.
export default function SalesEntry() {
  const { id } = useParams();
  return <SalesEntryForm key={id || "new"} id={id} />;
}

function SalesEntryForm({ id }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const admin = user.role === "admin";

  const [nextNo, setNextNo] = useState("");
  const [entry, setEntry] = useState(null); // saved entry being edited/viewed
  const [form, setForm] = useState(() => (id ? blankForm() : loadDraft() || blankForm()));
  const [saving, setSaving] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [lastSaved, setLastSaved] = useState(null); // { archiveNo, _id, edited }
  const [loadError, setLoadError] = useState("");
  const nameRefs = useRef({});
  const focusKey = useRef(null);
  const readOnly = Boolean(id) && !admin;

  const loadNextNo = useCallback(() => {
    getSalesEntryMeta()
      .then((m) => setNextNo(m.nextInvoiceNo))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) {
      loadNextNo();
      return;
    }
    setLoadError("");
    getSalesEntry(id)
      .then((e) => {
        setEntry(e);
        setForm(formFromEntry(e));
      })
      .catch((err) => setLoadError(getErrorMessage(err)));
  }, [id, loadNextNo]);

  // Live: keep the next invoice number current (POS bills share the series),
  // and say so when someone else changes the entry that's open here.
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  useLiveRefresh(["sales-entries", "sales"], (evt) => {
    if (!id) loadNextNo();
    else if (evt?.catchUp || (evt?.resource === "sales-entries" && evt.id === id && evt.by !== String(user._id))) setChangedElsewhere(true);
  });
  const reloadEntry = () =>
    getSalesEntry(id)
      .then((e) => {
        setEntry(e);
        setForm(formFromEntry(e));
        setChangedElsewhere(false);
      })
      .catch((err) => toast.error(getErrorMessage(err)));

  // A new entry being typed is kept on this device until it's saved.
  useEffect(() => {
    if (!id) saveDraft(form);
  }, [id, form]);

  useEffect(() => {
    if (focusKey.current) {
      nameRefs.current[focusKey.current]?.focus();
      focusKey.current = null;
    }
  });

  const calc = useMemo(() => calcInvoice(form.items.filter((r) => !isBlankRow(r)), false), [form.items]);
  const lineTotal = (r) => (isBlankRow(r) ? "" : fmt(calcInvoice([r], false).lines[0].total));

  const setRow = (key, patch) => setForm((f) => ({ ...f, items: f.items.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
  const addRow = () => {
    const row = blankRow();
    focusKey.current = row.key;
    setForm((f) => ({ ...f, items: [...f.items, row] }));
  };
  const removeRow = (key) => setForm((f) => ({ ...f, items: f.items.length > 1 ? f.items.filter((r) => r.key !== key) : [blankRow()] }));

  // Enter moves to the next row (a new one on the last row).
  const rowKeyDown = (e, i) => {
    if (e.key !== "Enter" || e.target.tagName === "SELECT") return;
    e.preventDefault();
    if (i === form.items.length - 1) addRow();
    else nameRefs.current[form.items[i + 1].key]?.focus();
  };

  const announceNewProducts = (list) => {
    if (!list?.length) return;
    toast.info(`Added to Product List: ${list.map((p) => `${p.name} (${p.productCode})`).join(", ")}`, { autoClose: 6000 });
  };

  const save = async () => {
    if (saving || readOnly) return;
    const body = {
      invoiceDate: form.invoiceDate,
      customer: { ...(entry?.customer || {}), name: form.customerName, mobile: form.mobile, address: form.address },
      paymentMode: form.paymentMode,
      amountReceived: form.paymentMode === "Credit" ? form.amountReceived : undefined,
      // Refused if someone else saved this entry after it was opened.
      expectedUpdatedAt: entry?.updatedAt,
      interState: entry?.interState,
      items: form.items
        .filter((r) => !isBlankRow(r))
        .map((r) => ({ product: r.product, name: r.name, hsnCode: r.hsnCode, unit: r.unit, qty: r.qty, rate: r.rate, discountPercent: r.discountPercent, gstPercent: r.gstPercent })),
    };
    setSaving(true);
    try {
      if (entry) {
        const saved = await updateSalesEntry(entry._id, body);
        setEntry(saved);
        setForm(formFromEntry(saved));
        setLastSaved({ archiveNo: saved.archiveNo, _id: saved._id, edited: true });
        toast.success(`${saved.archiveNo} updated successfully.`);
        if (saved.stockNote) toast.info(saved.stockNote, { autoClose: 6000 });
        announceNewProducts(saved.createdProducts);
      } else {
        const saved = await createSalesEntry(body);
        clearDraft();
        setForm(blankForm());
        setLastSaved({ archiveNo: saved.archiveNo, _id: saved._id, edited: false });
        toast.success(`Sales entry ${saved.archiveNo} saved successfully.`);
        if (saved.stockNote) toast.info(saved.stockNote, { autoClose: 6000 });
        announceNewProducts(saved.createdProducts);
        loadNextNo();
      }
    } catch (err) {
      // The form is left exactly as typed, so nothing is lost.
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Deletes the entry and its bill (Admin): stock goes back, payments removed.
  const [deleting, setDeleting] = useState(false);
  const removeEntry = async () => {
    if (!entry || deleting) return;
    if (!window.confirm(`Delete ${entry.archiveNo}? Any stock it took will be put back and its payments removed. This can't be undone.`)) return;
    setDeleting(true);
    try {
      const out = await deleteSalesEntry(entry._id);
      toast.success(out.message);
      navigate("/sales-entry/history");
    } catch (err) {
      toast.error(getErrorMessage(err));
      setDeleting(false);
    }
  };

  // Older entry without a bill: record its sale now (stock, ledger, Day Book).
  const [linking, setLinking] = useState(false);
  const linkEntry = async () => {
    if (!entry || linking) return;
    if (!window.confirm(`Link ${entry.archiveNo}? Its items will be taken from stock and it will appear in the ledgers, Day Book and reports on ${new Date(entry.invoiceDate).toLocaleDateString()}.`)) return;
    setLinking(true);
    try {
      const saved = await linkSalesEntry(entry._id);
      setEntry(saved);
      setForm(formFromEntry(saved));
      toast.success(saved.message);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLinking(false);
    }
  };

  const clearForm = () => {
    if (!form.items.every(isBlankRow) && !window.confirm("Clear this form?")) return;
    clearDraft();
    setLastSaved(null);
    if (id) navigate("/sales-entry");
    else setForm(blankForm());
  };

  const inputCls = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none disabled:bg-bg";
  const labelCls = "mb-1 block text-xs font-semibold text-muted";

  if (loadError) {
    return (
      <Layout>
        <p className="text-sm text-danger">{loadError}</p>
        <Link to="/sales-entry/history" className="mt-3 inline-block text-sm font-semibold text-primary">
          Back to Sales History
        </Link>
      </Layout>
    );
  }

  return (
    <Layout>
      {showImport && (
        <SalesEntryImportModal
          onClose={() => {
            setShowImport(false);
            loadNextNo();
          }}
        />
      )}
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">{id ? (readOnly ? "Sales Entry" : "Edit Sales Entry") : "Sales Entry"}</h1>
          <div className="flex flex-wrap gap-2">
            {!id && (
              <>
                <button
                  type="button"
                  onClick={() => downloadSalesEntryTemplate().catch((err) => toast.error(getErrorMessage(err)))}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-semibold text-text hover:bg-bg"
                >
                  <Icon name="download" size={16} />
                  Download Excel Template
                </button>
                <button type="button" onClick={() => setShowImport(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-semibold text-text hover:bg-bg">
                  <Icon name="plus" size={16} />
                  Upload Excel
                </button>
              </>
            )}
            {id && (
              <Link to="/sales-entry" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-semibold text-text hover:bg-bg">
                <Icon name="plus" size={16} />
                New Entry
              </Link>
            )}
            <Link to="/sales-entry/history" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-semibold text-text hover:bg-bg">
              <Icon name="clock" size={16} />
              Sales History
            </Link>
          </div>
        </div>

        {lastSaved && (
          <div role="status" className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-success/30 bg-secondary-soft px-4 py-3 text-sm text-success">
            <Icon name="check" size={18} />
            <span className="font-semibold">
              {lastSaved.archiveNo} {lastSaved.edited ? "updated" : "saved"} successfully.
            </span>
            {!lastSaved.edited && (
              <Link to={`/sales-entry/${lastSaved._id}`} className="font-semibold underline">
                Open it
              </Link>
            )}
            <button type="button" onClick={() => setLastSaved(null)} aria-label="Dismiss" className="ml-auto rounded p-1 hover:bg-success/10">
              <Icon name="close" size={14} />
            </button>
          </div>
        )}

        {changedElsewhere && (
          <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
            <Icon name="alert" size={18} />
            <span className="font-semibold">This entry may have been changed by another user.</span>
            <button type="button" onClick={reloadEntry} className="rounded-lg bg-warning px-3 py-1 text-xs font-semibold text-white">
              Load latest
            </button>
          </div>
        )}

        <div className="card mt-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_160px_160px_160px]">
            <label className="block">
              <span className={labelCls}>Customer Name</span>
              <input className={inputCls} maxLength={120} placeholder="Customer name" value={form.customerName} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))} />
            </label>
            <div>
              <span className={labelCls}>Invoice Number</span>
              <p className="rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm font-semibold text-primary">{entry?.archiveNo || nextNo || "…"}</p>
            </div>
            <label className="block">
              <span className={labelCls}>Date</span>
              <input type="date" className={inputCls} value={form.invoiceDate} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, invoiceDate: e.target.value }))} />
            </label>
            <label className="block">
              <span className={labelCls}>Payment Mode</span>
              <select className={inputCls} value={form.paymentMode} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, paymentMode: e.target.value }))}>
                {PAYMENT_MODES.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-[160px_1fr_160px]">
            <label className="block">
              <span className={labelCls}>Mobile (optional)</span>
              <input
                className={inputCls}
                inputMode="numeric"
                maxLength={10}
                placeholder="10 digits"
                value={form.mobile}
                disabled={readOnly}
                onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value.replace(/\D/g, "") }))}
              />
            </label>
            <label className="block">
              <span className={labelCls}>Address (optional)</span>
              <input className={inputCls} maxLength={300} value={form.address} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </label>
            {form.paymentMode === "Credit" && (
              <label className="block">
                <span className={labelCls}>Amount Received Now</span>
                <input
                  className={`${inputCls} text-right`}
                  inputMode="decimal"
                  placeholder="0.00"
                  value={form.amountReceived}
                  disabled={readOnly}
                  onChange={(e) => setForm((f) => ({ ...f, amountReceived: e.target.value.replace(/[^\d.]/g, "") }))}
                />
              </label>
            )}
          </div>
          {entry && (
            <p className="mt-3 text-xs text-muted">
              {entry.sale ? (
                <>
                  Recorded as a sale (stock, ledger, Day Book, reports).{" "}
                  <Link to={`/bills/${entry.sale}`} className="font-semibold text-primary underline">
                    View bill
                  </Link>
                </>
              ) : (
                <>
                  Saved before Sales Entry was linked to stock and ledgers - this entry doesn't affect them yet.{" "}
                  {admin && (
                    <button type="button" onClick={linkEntry} disabled={linking} className="font-semibold text-primary underline disabled:opacity-60">
                      {linking ? "Linking…" : "Link to stock & ledgers"}
                    </button>
                  )}
                </>
              )}
            </p>
          )}

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="w-8 pb-2">#</th>
                  <th className="pb-2">Product Name</th>
                  <th className="w-24 pb-2 pl-2">HSN</th>
                  <th className="w-24 pb-2 pl-2">Unit</th>
                  <th className="w-24 pb-2 pl-2">Quantity</th>
                  <th className="w-28 pb-2 pl-2">Rate (₹)</th>
                  {admin && <th className="w-20 pb-2 pl-2">Disc %</th>}
                  <th className="w-24 pb-2 pl-2">GST</th>
                  <th className="w-32 pb-2 pl-2 text-right">Total (₹)</th>
                  {!readOnly && <th className="w-10" />}
                </tr>
              </thead>
              <tbody>
                {form.items.map((r, i) => (
                  <tr key={r.key} onKeyDown={(e) => rowKeyDown(e, i)}>
                    <td className="py-1 pt-3 align-top text-xs text-muted">{i + 1}</td>
                    <td className="py-1 align-top">
                      <ProductPicker
                        value={r.name}
                        productId={r.product}
                        disabled={readOnly}
                        className={inputCls}
                        inputRef={(el) => (nameRefs.current[r.key] = el)}
                        onChange={(name) => setRow(r.key, { name, product: null })}
                        onPick={(p) =>
                          setRow(r.key, {
                            product: p._id,
                            name: p.name,
                            hsnCode: p.hsnCode || "",
                            unit: p.packUnit || "",
                            rate: p.packRate != null ? String(p.packRate) : "",
                            gstPercent: GST_RATES.includes(Number(p.gstPercent)) ? Number(p.gstPercent) : 12,
                          })
                        }
                      />
                    </td>
                    <td className="py-1 align-top pl-2">
                      <input className={inputCls} maxLength={20} placeholder="HSN" value={r.hsnCode} disabled={readOnly} onChange={(e) => setRow(r.key, { hsnCode: e.target.value })} />
                    </td>
                    <td className="py-1 align-top pl-2">
                      <input className={inputCls} maxLength={30} placeholder="Strip" list="sales-entry-units" value={r.unit} disabled={readOnly} onChange={(e) => setRow(r.key, { unit: e.target.value })} />
                    </td>
                    <td className="py-1 align-top pl-2">
                      <input className={`${inputCls} text-right`} inputMode="decimal" value={r.qty} disabled={readOnly} onChange={(e) => setRow(r.key, { qty: e.target.value.replace(/[^\d.]/g, "") })} />
                    </td>
                    <td className="py-1 align-top pl-2">
                      <input className={`${inputCls} text-right`} inputMode="decimal" placeholder="0.00" value={r.rate} disabled={readOnly} onChange={(e) => setRow(r.key, { rate: e.target.value.replace(/[^\d.]/g, "") })} />
                    </td>
                    {admin && (
                      <td className="py-1 align-top pl-2">
                        <input className={`${inputCls} text-right`} inputMode="decimal" placeholder="0" value={r.discountPercent} disabled={readOnly} onChange={(e) => setRow(r.key, { discountPercent: e.target.value.replace(/[^\d.]/g, "") })} />
                      </td>
                    )}
                    <td className="py-1 align-top pl-2">
                      <select className={inputCls} value={r.gstPercent} disabled={readOnly} onChange={(e) => setRow(r.key, { gstPercent: Number(e.target.value) })}>
                        {GST_RATES.map((g) => (
                          <option key={g} value={g}>
                            {g}%
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 pt-3 align-top pl-2 text-right font-mono tabular-nums text-text">{lineTotal(r)}</td>
                    {!readOnly && (
                      <td className="py-1 align-top pl-1 text-center">
                        <button type="button" onClick={() => removeRow(r.key)} title="Remove row" aria-label={`Remove row ${i + 1}`} className="rounded-md p-1.5 text-muted hover:bg-danger/10 hover:text-danger">
                          <Icon name="trash" size={15} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="sales-entry-units">
              {["Strip", "Bottle", "Box", "Tube", "Vial", "Jar", "Piece"].map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </div>

          {!readOnly && (
            <button type="button" onClick={addRow} className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary-soft">
              <Icon name="plus" size={15} />
              Add Row
            </button>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-end gap-x-6 gap-y-1 border-t border-border pt-4 text-sm">
            <span className="text-muted">
              Subtotal <span className="font-mono text-text">₹{fmt(calc.subtotal)}</span>
            </span>
            {calc.discountTotal > 0 && (
              <span className="text-muted">
                Discount <span className="font-mono text-text">−₹{fmt(calc.discountTotal)}</span>
              </span>
            )}
            <span className="text-muted">
              GST <span className="font-mono text-text">₹{fmt(calc.cgstTotal + calc.sgstTotal + calc.igstTotal)}</span>
            </span>
            <span className="font-semibold text-text">
              Total Amount <span className="ml-1 font-mono text-xl font-bold text-primary">₹{fmt(calc.grandTotal)}</span>
            </span>
          </div>
        </div>

        {!readOnly && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-secondary px-6 py-2.5 text-sm font-semibold text-white hover:bg-secondary-dark disabled:opacity-60"
            >
              <Icon name="check" size={17} />
              {saving ? "Saving…" : entry ? "Save Changes" : "Save"}
            </button>
            <button type="button" onClick={clearForm} disabled={saving} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-muted hover:bg-surface hover:text-text">
              Clear
            </button>
            <span className="text-xs text-muted">Ctrl+S saves · Enter goes to the next row</span>
            {entry && admin && (
              <button
                type="button"
                onClick={removeEntry}
                disabled={saving || deleting}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-danger hover:bg-danger/10 disabled:opacity-60"
              >
                <Icon name="trash" size={16} />
                {deleting ? "Deleting…" : "Delete Entry"}
              </button>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
