import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import Layout from "../components/Layout";
import Icon from "../components/Icon";
import { useAuth } from "../context/AuthContext";
import { getErrorMessage } from "../api/client";
import { listProducts } from "../api/products";
import { createSalesEntry, getSalesEntry, getSalesEntryMeta, updateSalesEntry } from "../api/salesEntries";
import { calcInvoice, GST_RATES } from "../utils/salesEntryCalc";

// Sales Entry: a simple form to type in a sale and save it to the database.
// Nothing else happens on Save - no stock change, no PDF/Excel files. The
// invoice number (SALES-001, ...) is given by the server when saving.
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
const blankRow = () => ({ key: ++keySeq, product: null, name: "", qty: "1", rate: "", gstPercent: 12 });
const blankForm = () => ({ customerName: "", invoiceDate: todayIso(), items: [blankRow()] });
const isBlankRow = (r) => !r.name.trim() && !Number(r.rate);

function formFromEntry(e) {
  return {
    customerName: e.customer?.name || "",
    invoiceDate: isoInIndia(e.invoiceDate),
    items: e.items.map((it) => ({ key: ++keySeq, product: it.product || null, name: it.name, qty: String(it.qty), rate: String(it.rate), gstPercent: it.gstPercent })),
  };
}

function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    if (!d || !Array.isArray(d.items) || !d.items.length) return null;
    return { customerName: d.customerName || "", invoiceDate: d.invoiceDate || todayIso(), items: d.items.map((r) => ({ ...blankRow(), ...r, key: ++keySeq })) };
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

// Product name box: type freely, or pick a product to fill in rate and GST.
function ProductInput({ value, onChange, onPick, inputRef, disabled }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const typed = useRef(false);

  useEffect(() => {
    const q = value.trim();
    if (!typed.current || q.length < 2) return undefined;
    let cancelled = false;
    const t = setTimeout(() => {
      listProducts({ q })
        .then((list) => {
          if (cancelled) return;
          setItems(list.slice(0, 8));
          setActive(0);
          setOpen(list.length > 0);
        })
        .catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [value]);

  const pick = (p) => {
    typed.current = false;
    setOpen(false);
    onPick(p);
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={value}
        disabled={disabled}
        autoComplete="off"
        maxLength={200}
        placeholder="Product name"
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none disabled:bg-bg"
        onChange={(e) => {
          typed.current = true;
          if (e.target.value.trim().length < 2) setOpen(false);
          onChange(e.target.value);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || !items.length) return;
          if (["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(e.key)) {
            e.preventDefault();
            e.stopPropagation();
          }
          if (e.key === "ArrowDown") setActive((a) => (a + 1) % items.length);
          if (e.key === "ArrowUp") setActive((a) => (a - 1 + items.length) % items.length);
          if (e.key === "Enter") pick(items[active]);
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && (
        <ul className="absolute left-0 top-full z-30 mt-1 max-h-60 w-full min-w-[240px] overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-lg">
          {items.map((p, i) => (
            <li key={p._id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p)}
                className={`block w-full px-3 py-1.5 text-left text-sm ${i === active ? "bg-primary-soft" : "hover:bg-bg"}`}
              >
                <span className="font-medium text-text">{p.name}</span>
                <span className="ml-2 text-xs text-muted">
                  ₹{fmt(p.packRate)} · GST {p.gstPercent}%
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
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

  const save = async () => {
    if (saving || readOnly) return;
    const body = {
      invoiceDate: form.invoiceDate,
      customer: { ...(entry?.customer || {}), name: form.customerName },
      paymentMode: entry?.paymentMode,
      interState: entry?.interState,
      items: form.items
        .filter((r) => !isBlankRow(r))
        .map((r) => {
          // Keep any details an older entry had (HSN, unit, discount).
          const old = entry?.items?.find((it) => it.name === r.name) || {};
          return { hsnCode: old.hsnCode, unit: old.unit, discountPercent: old.discountPercent, product: r.product, name: r.name, qty: r.qty, rate: r.rate, gstPercent: r.gstPercent };
        }),
    };
    setSaving(true);
    try {
      if (entry) {
        const saved = await updateSalesEntry(entry._id, body);
        setEntry(saved);
        setForm(formFromEntry(saved));
        setLastSaved({ archiveNo: saved.archiveNo, _id: saved._id, edited: true });
        toast.success(`${saved.archiveNo} updated successfully.`);
      } else {
        const saved = await createSalesEntry(body);
        clearDraft();
        setForm(blankForm());
        setLastSaved({ archiveNo: saved.archiveNo, _id: saved._id, edited: false });
        toast.success(`Sales entry ${saved.archiveNo} saved successfully.`);
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
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">{id ? (readOnly ? "Sales Entry" : "Edit Sales Entry") : "Sales Entry"}</h1>
          <div className="flex gap-2">
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

        <div className="card mt-4 p-5">
          <div className="grid gap-4 sm:grid-cols-[1fr_180px_180px]">
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
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="w-8 pb-2">#</th>
                  <th className="pb-2">Product Name</th>
                  <th className="w-24 pb-2 pl-2">Quantity</th>
                  <th className="w-28 pb-2 pl-2">Rate (₹)</th>
                  <th className="w-24 pb-2 pl-2">GST</th>
                  <th className="w-32 pb-2 pl-2 text-right">Total (₹)</th>
                  {!readOnly && <th className="w-10" />}
                </tr>
              </thead>
              <tbody>
                {form.items.map((r, i) => (
                  <tr key={r.key} onKeyDown={(e) => rowKeyDown(e, i)}>
                    <td className="py-1 text-xs text-muted">{i + 1}</td>
                    <td className="py-1">
                      <ProductInput
                        value={r.name}
                        disabled={readOnly}
                        inputRef={(el) => (nameRefs.current[r.key] = el)}
                        onChange={(name) => setRow(r.key, { name, product: null })}
                        onPick={(p) =>
                          setRow(r.key, {
                            product: p._id,
                            name: p.name,
                            rate: p.packRate != null ? String(p.packRate) : "",
                            gstPercent: GST_RATES.includes(Number(p.gstPercent)) ? Number(p.gstPercent) : 12,
                          })
                        }
                      />
                    </td>
                    <td className="py-1 pl-2">
                      <input className={`${inputCls} text-right`} inputMode="decimal" value={r.qty} disabled={readOnly} onChange={(e) => setRow(r.key, { qty: e.target.value.replace(/[^\d.]/g, "") })} />
                    </td>
                    <td className="py-1 pl-2">
                      <input className={`${inputCls} text-right`} inputMode="decimal" placeholder="0.00" value={r.rate} disabled={readOnly} onChange={(e) => setRow(r.key, { rate: e.target.value.replace(/[^\d.]/g, "") })} />
                    </td>
                    <td className="py-1 pl-2">
                      <select className={inputCls} value={r.gstPercent} disabled={readOnly} onChange={(e) => setRow(r.key, { gstPercent: Number(e.target.value) })}>
                        {GST_RATES.map((g) => (
                          <option key={g} value={g}>
                            {g}%
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 pl-2 text-right font-mono tabular-nums text-text">{lineTotal(r)}</td>
                    {!readOnly && (
                      <td className="py-1 pl-1 text-center">
                        <button type="button" onClick={() => removeRow(r.key)} title="Remove row" aria-label={`Remove row ${i + 1}`} className="rounded-md p-1.5 text-muted hover:bg-danger/10 hover:text-danger">
                          <Icon name="trash" size={15} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!readOnly && (
            <button type="button" onClick={addRow} className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary-soft">
              <Icon name="plus" size={15} />
              Add Row
            </button>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-end gap-x-6 gap-y-1 border-t border-border pt-4 text-sm">
            <span className="text-muted">
              Amount <span className="font-mono text-text">₹{fmt(calc.taxableTotal)}</span>
            </span>
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
          </div>
        )}
      </div>
    </Layout>
  );
}
