import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import Layout from "../components/Layout";
import Icon from "../components/Icon";
import { useAuth } from "../context/AuthContext";
import { getErrorMessage } from "../api/client";
import { listProducts } from "../api/products";
import {
  createSalesEntry,
  downloadSalesEntryFile,
  getSalesEntry,
  getSalesEntryMeta,
  printSalesEntry,
  suggestSalesEntryCustomers,
  updateSalesEntry,
} from "../api/salesEntries";
import { calcInvoice, GST_RATES, PAYMENT_MODES } from "../utils/salesEntryCalc";

// Sales Entry: a Tally-style sales voucher. Numbers come from the server
// (SALES-001, ...), amounts are worked out live here and again on save, and
// the Invoice Saver files the PDF + Excel into reports\sales\<Y>\<M>\<date>.
// It doesn't change stock - POS billing (Products -> Orders) does that.

const fmt = (n) => Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const isoInIndia = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

let keySeq = 0;
const blankItem = () => ({ key: ++keySeq, product: null, name: "", hsnCode: "", qty: "1", unit: "Nos", rate: "", discountPercent: "", gstPercent: 12 });
const blankForm = () => ({
  invoiceDate: todayIso(),
  customer: { name: "", address: "", gstin: "", mobile: "" },
  interState: false,
  paymentMode: "Cash",
  notes: "",
  items: [blankItem()],
});

function formFromEntry(e) {
  return {
    invoiceDate: isoInIndia(e.invoiceDate),
    customer: { name: e.customer?.name || "", address: e.customer?.address || "", gstin: e.customer?.gstin || "", mobile: e.customer?.mobile || "" },
    interState: Boolean(e.interState),
    paymentMode: e.paymentMode,
    notes: e.notes || "",
    items: e.items.map((it) => ({
      key: ++keySeq,
      product: it.product || null,
      name: it.name,
      hsnCode: it.hsnCode || "",
      qty: String(it.qty),
      unit: it.unit || "Nos",
      rate: String(it.rate),
      discountPercent: it.discountPercent ? String(it.discountPercent) : "",
      gstPercent: it.gstPercent,
    })),
  };
}

const isBlankRow = (it) => !it.name.trim() && !Number(it.rate);

// Text box with a suggestion list (arrow keys + Enter, or click).
function Suggest({ value, onChange, fetcher, renderItem, onPick, inputProps, minChars = 2, disabled }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [active, setActive] = useState(0);
  const timer = useRef(null);
  const typed = useRef(false);

  useEffect(() => {
    if (!typed.current || value.trim().length < minChars) {
      setItems([]);
      return undefined;
    }
    clearTimeout(timer.current);
    let cancelled = false;
    timer.current = setTimeout(() => {
      fetcher(value.trim())
        .then((list) => {
          if (cancelled) return;
          setItems(list);
          setActive(0);
          setOpen(list.length > 0);
        })
        .catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer.current);
    };
  }, [value, fetcher, minChars]);

  const pick = (item) => {
    typed.current = false;
    setOpen(false);
    onPick(item);
  };

  return (
    <div className="relative">
      <input
        {...inputProps}
        value={value}
        disabled={disabled}
        autoComplete="off"
        onChange={(e) => {
          typed.current = true;
          onChange(e.target.value);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (open && items.length) {
            // Handled here - don't let the row's Enter handler see it too.
            if (["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(e.key)) e.stopPropagation();
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => (a + 1) % items.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a - 1 + items.length) % items.length);
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              pick(items[active]);
              return;
            }
            if (e.key === "Escape") {
              setOpen(false);
              return;
            }
          }
          inputProps?.onKeyDown?.(e);
        }}
      />
      {open && (
        <ul className="absolute left-0 top-full z-30 mt-1 max-h-64 w-full min-w-[260px] overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-lg">
          {items.map((item, i) => (
            <li key={i}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(item)}
                className={`block w-full px-3 py-1.5 text-left text-sm ${i === active ? "bg-primary-soft" : "hover:bg-bg"}`}
              >
                {renderItem(item)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const fetchProducts = (q) => listProducts({ q }).then((list) => list.slice(0, 8));

export default function SalesEntry() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const admin = user.role === "admin";

  const [meta, setMeta] = useState(null);
  const [entry, setEntry] = useState(null); // the saved entry being shown
  const [editing, setEditing] = useState(!id);
  const [form, setForm] = useState(blankForm);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [loadError, setLoadError] = useState("");
  const nameRefs = useRef({});
  const focusKey = useRef(null);

  const locked = Boolean(entry) && !editing;

  const loadMeta = useCallback(() => {
    getSalesEntryMeta().then(setMeta).catch(() => {});
  }, []);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  // Open a saved entry (/sales-entry/:id), or start a fresh one.
  useEffect(() => {
    setLoadError("");
    if (!id) {
      setEntry(null);
      setForm(blankForm());
      setEditing(true);
      setDirty(false);
      return;
    }
    getSalesEntry(id)
      .then((e) => {
        setEntry(e);
        setForm(formFromEntry(e));
        setEditing(admin && searchParams.get("edit") === "1");
        setDirty(false);
      })
      .catch((err) => setLoadError(getErrorMessage(err)));
  }, [id, admin, searchParams]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (focusKey.current && nameRefs.current[focusKey.current]) {
      nameRefs.current[focusKey.current].focus();
      focusKey.current = null;
    }
  });

  const calc = useMemo(() => {
    const rows = form.items.filter((it) => !isBlankRow(it));
    return calcInvoice(rows, form.interState);
  }, [form.items, form.interState]);
  const lineCalc = useMemo(() => {
    const map = new Map();
    for (const it of form.items) map.set(it.key, calcInvoice([it], form.interState).lines[0]);
    return map;
  }, [form.items, form.interState]);

  const update = (patch) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const updateCustomer = (patch) => {
    setForm((f) => {
      const customer = { ...f.customer, ...patch };
      let interState = f.interState;
      // Different state code from the shop's GSTIN -> inter-state (IGST).
      const shop = meta?.shopGstin || "";
      if (patch.gstin !== undefined && shop.length >= 2 && customer.gstin.length === 15) {
        interState = customer.gstin.slice(0, 2) !== shop.slice(0, 2);
      }
      return { ...f, customer, interState };
    });
    setDirty(true);
  };
  const updateItem = (key, patch) => {
    setForm((f) => ({ ...f, items: f.items.map((it) => (it.key === key ? { ...it, ...patch } : it)) }));
    setDirty(true);
  };
  const addItem = () => {
    const item = blankItem();
    focusKey.current = item.key;
    setForm((f) => ({ ...f, items: [...f.items, item] }));
  };
  const removeItem = (key) => {
    setForm((f) => ({ ...f, items: f.items.length > 1 ? f.items.filter((it) => it.key !== key) : [blankItem()] }));
    setDirty(true);
  };
  const pickProduct = (key, p) => {
    updateItem(key, {
      product: p._id,
      name: p.name,
      hsnCode: p.hsnCode || "",
      unit: p.packUnit || "Nos",
      rate: p.packRate != null ? String(p.packRate) : "",
      gstPercent: GST_RATES.includes(Number(p.gstPercent)) ? Number(p.gstPercent) : 12,
    });
  };

  // Enter on the last row starts a new one, like Tally.
  const rowKeyDown = (e, index) => {
    if (e.key !== "Enter" || e.target.tagName === "SELECT") return;
    e.preventDefault();
    if (index === form.items.length - 1) addItem();
    else nameRefs.current[form.items[index + 1].key]?.focus();
  };

  const payload = () => ({
    invoiceDate: form.invoiceDate,
    customer: form.customer,
    interState: form.interState,
    paymentMode: form.paymentMode,
    notes: form.notes,
    items: form.items
      .filter((it) => !isBlankRow(it))
      .map(({ product, name, hsnCode, qty, unit, rate, discountPercent, gstPercent }) => ({ product, name, hsnCode, qty, unit, rate, discountPercent, gstPercent })),
  });

  // Saves the form (new entry or admin edit). Returns the saved entry, or null.
  const save = async () => {
    if (locked) return entry;
    setBusy("save");
    try {
      const saved = entry ? await updateSalesEntry(entry._id, payload()) : await createSalesEntry(payload());
      setEntry(saved);
      setForm(formFromEntry(saved));
      setEditing(false);
      setDirty(false);
      toast.success(entry ? `${saved.archiveNo} updated.` : `${saved.archiveNo} saved.`);
      if (!entry) navigate(`/sales-entry/${saved._id}`, { replace: true });
      else if (searchParams.get("edit")) navigate(`/sales-entry/${saved._id}`, { replace: true });
      loadMeta();
      return saved;
    } catch (err) {
      toast.error(getErrorMessage(err));
      return null;
    } finally {
      setBusy("");
    }
  };

  // PDF / Excel / Print save the entry first when needed.
  const withSaved = (kind, action) => async () => {
    const saved = locked ? entry : await save();
    if (!saved) return;
    setBusy(kind);
    try {
      await action(saved);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy("");
    }
  };

  const clearForm = () => {
    if (dirty && !window.confirm("Clear this form? Unsaved changes will be lost.")) return;
    setDirty(false);
    if (id) navigate("/sales-entry");
    else {
      setForm(blankForm());
      loadMeta();
    }
  };

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!locked && !busy) save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const inputCls =
    "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:bg-bg disabled:text-text";
  const cellCls =
    "w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm text-text hover:border-border focus:border-primary focus:bg-surface focus:outline-none disabled:hover:border-transparent";
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

  const invoiceNo = entry?.archiveNo || meta?.nextInvoiceNo || "…";
  const btn = "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
  const ghost = `${btn} border border-border bg-surface text-text hover:bg-bg`;

  return (
    <Layout>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">Sales Entry</h1>
          <p className="mt-1 text-sm text-muted">
            {entry
              ? editing
                ? "Editing a saved invoice - the invoice number stays the same."
                : `Saved${entry.createdBy?.username ? ` by ${entry.createdBy.username}` : ""}${entry.editedAt ? ` · edited ${new Date(entry.editedAt).toLocaleString()}` : ""}`
              : "New sales invoice. Ctrl+S saves; Enter on the last item adds a new row. Stock is not changed."}
          </p>
        </div>
        <Link to="/sales-entry/history" className={ghost}>
          <Icon name="clock" size={16} />
          View Sales History
        </Link>
      </div>

      {/* Invoice + customer details */}
      <div className="card mt-5 grid gap-4 p-5 md:grid-cols-[minmax(0,240px)_1fr]">
        <div className="space-y-3">
          <div>
            <span className={labelCls}>Invoice Number</span>
            <p className="font-mono text-xl font-bold text-primary">{invoiceNo}</p>
            {!entry && <p className="text-[11px] text-muted">Confirmed when saved</p>}
          </div>
          <label className="block">
            <span className={labelCls}>Invoice Date</span>
            <input type="date" className={inputCls} value={form.invoiceDate} max={todayIso()} disabled={locked} onChange={(e) => update({ invoiceDate: e.target.value })} />
          </label>
          <label className="block">
            <span className={labelCls}>Payment Mode</span>
            <select className={inputCls} value={form.paymentMode} disabled={locked} onChange={(e) => update({ paymentMode: e.target.value })}>
              {PAYMENT_MODES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={labelCls}>Customer Name{form.paymentMode === "Credit" ? " *" : ""}</span>
            <Suggest
              value={form.customer.name}
              disabled={locked}
              onChange={(name) => updateCustomer({ name })}
              fetcher={suggestSalesEntryCustomers}
              onPick={(c) => updateCustomer({ name: c.name || "", mobile: c.mobile || "", address: c.address || "", gstin: c.gstin || "" })}
              renderItem={(c) => (
                <>
                  <span className="font-medium text-text">{c.name}</span>
                  <span className="ml-2 text-xs text-muted">{[c.mobile, c.gstin].filter(Boolean).join(" · ")}</span>
                </>
              )}
              inputProps={{ className: inputCls, placeholder: "Cash Customer", maxLength: 120 }}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Mobile Number</span>
            <input
              className={inputCls}
              inputMode="numeric"
              maxLength={10}
              placeholder="10 digits"
              value={form.customer.mobile}
              disabled={locked}
              onChange={(e) => updateCustomer({ mobile: e.target.value.replace(/\D/g, "") })}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className={labelCls}>Customer Address</span>
            <input className={inputCls} maxLength={300} value={form.customer.address} disabled={locked} onChange={(e) => updateCustomer({ address: e.target.value })} />
          </label>
          <label className="block">
            <span className={labelCls}>Customer GST Number</span>
            <input
              className={`${inputCls} font-mono uppercase`}
              maxLength={15}
              placeholder="e.g. 33ABCDE1234F1Z5"
              value={form.customer.gstin}
              disabled={locked}
              onChange={(e) => updateCustomer({ gstin: e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "") })}
            />
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-text">
            <input type="checkbox" className="h-4 w-4 accent-[var(--color-primary)]" checked={form.interState} disabled={locked} onChange={(e) => update({ interState: e.target.checked })} />
            Inter-state supply (charge IGST instead of CGST + SGST)
          </label>
        </div>
      </div>

      {/* Items */}
      <div className="card mt-4 p-0">
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 className="font-display text-base font-bold text-text">Items</h2>
          {!locked && (
            <button type="button" onClick={addItem} className={`${btn} bg-primary-soft text-primary hover:bg-primary/15`}>
              <Icon name="plus" size={15} />
              Add Item
            </button>
          )}
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[1080px] text-sm">
            <thead>
              <tr className="border-y border-border bg-bg text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="w-8 px-3 py-2">#</th>
                <th className="px-2 py-2">Product / Item Name</th>
                <th className="w-24 px-2 py-2">HSN</th>
                <th className="w-20 px-2 py-2 text-right">Qty</th>
                <th className="w-20 px-2 py-2">Unit</th>
                <th className="w-24 px-2 py-2 text-right">Rate</th>
                <th className="w-20 px-2 py-2 text-right">Disc %</th>
                <th className="w-20 px-2 py-2">GST %</th>
                <th className="w-24 px-2 py-2 text-right">Taxable</th>
                {form.interState ? (
                  <th className="w-24 px-2 py-2 text-right">IGST</th>
                ) : (
                  <>
                    <th className="w-20 px-2 py-2 text-right">CGST</th>
                    <th className="w-20 px-2 py-2 text-right">SGST</th>
                  </>
                )}
                <th className="w-28 px-2 py-2 text-right">Amount</th>
                {!locked && <th className="w-10" />}
              </tr>
            </thead>
            <tbody>
              {form.items.map((it, i) => {
                const l = lineCalc.get(it.key);
                const blank = isBlankRow(it);
                const show = (n) => (blank ? "" : fmt(n));
                return (
                  <tr key={it.key} className="border-b border-border/70 align-middle" onKeyDown={(e) => rowKeyDown(e, i)}>
                    <td className="px-3 py-1 text-xs text-muted">{i + 1}</td>
                    <td className="px-1 py-1">
                      <Suggest
                        value={it.name}
                        disabled={locked}
                        onChange={(name) => updateItem(it.key, { name, product: null })}
                        fetcher={fetchProducts}
                        onPick={(p) => pickProduct(it.key, p)}
                        renderItem={(p) => (
                          <>
                            <span className="font-medium text-text">{p.name}</span>
                            <span className="ml-2 text-xs text-muted">
                              ₹{fmt(p.packRate)} / {p.packUnit} · GST {p.gstPercent}%{p.hsnCode ? ` · HSN ${p.hsnCode}` : ""}
                            </span>
                          </>
                        )}
                        inputProps={{
                          className: cellCls,
                          placeholder: "Type to search products, or any item name",
                          maxLength: 200,
                          ref: (el) => (nameRefs.current[it.key] = el),
                        }}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input className={cellCls} maxLength={20} value={it.hsnCode} disabled={locked} onChange={(e) => updateItem(it.key, { hsnCode: e.target.value })} />
                    </td>
                    <td className="px-1 py-1">
                      <input className={`${cellCls} text-right`} inputMode="decimal" value={it.qty} disabled={locked} onChange={(e) => updateItem(it.key, { qty: e.target.value.replace(/[^\d.]/g, "") })} />
                    </td>
                    <td className="px-1 py-1">
                      <input className={cellCls} maxLength={30} value={it.unit} disabled={locked} onChange={(e) => updateItem(it.key, { unit: e.target.value })} />
                    </td>
                    <td className="px-1 py-1">
                      <input className={`${cellCls} text-right`} inputMode="decimal" placeholder="0.00" value={it.rate} disabled={locked} onChange={(e) => updateItem(it.key, { rate: e.target.value.replace(/[^\d.]/g, "") })} />
                    </td>
                    <td className="px-1 py-1">
                      <input className={`${cellCls} text-right`} inputMode="decimal" placeholder="0" value={it.discountPercent} disabled={locked} onChange={(e) => updateItem(it.key, { discountPercent: e.target.value.replace(/[^\d.]/g, "") })} />
                    </td>
                    <td className="px-1 py-1">
                      <select className={cellCls} value={it.gstPercent} disabled={locked} onChange={(e) => updateItem(it.key, { gstPercent: Number(e.target.value) })}>
                        {GST_RATES.map((r) => (
                          <option key={r} value={r}>
                            {r}%
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1 text-right font-mono text-[13px] tabular-nums">{show(l.taxableAmount)}</td>
                    {form.interState ? (
                      <td className="px-2 py-1 text-right font-mono text-[13px] tabular-nums">{show(l.igst)}</td>
                    ) : (
                      <>
                        <td className="px-2 py-1 text-right font-mono text-[13px] tabular-nums">{show(l.cgst)}</td>
                        <td className="px-2 py-1 text-right font-mono text-[13px] tabular-nums">{show(l.sgst)}</td>
                      </>
                    )}
                    <td className="px-2 py-1 text-right font-mono text-[13px] font-semibold tabular-nums">{show(l.total)}</td>
                    {!locked && (
                      <td className="px-1 py-1 text-center">
                        <button type="button" onClick={() => removeItem(it.key)} title="Remove item" aria-label={`Remove item ${i + 1}`} className="rounded-md p-1.5 text-muted hover:bg-danger/10 hover:text-danger">
                          <Icon name="trash" size={15} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!locked && (
          <button type="button" onClick={addItem} className="m-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary-soft">
            <Icon name="plus" size={15} />
            Add another item
          </button>
        )}
      </div>

      {/* Notes + totals */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="card p-5">
          <span className={labelCls}>Amount in Words</span>
          <p className="font-display text-base font-semibold text-text">{calc.amountInWords}</p>
          <label className="mt-4 block">
            <span className={labelCls}>Notes (optional)</span>
            <textarea className={inputCls} rows={2} maxLength={500} value={form.notes} disabled={locked} onChange={(e) => update({ notes: e.target.value })} />
          </label>
        </div>
        <div className="card p-5">
          <dl className="space-y-1.5 text-sm">
            {[
              ["Sub Total (Qty × Rate)", calc.subtotal],
              ["Discount", -calc.discountTotal],
              ["Taxable Amount", calc.taxableTotal],
              ["CGST", calc.cgstTotal],
              ["SGST", calc.sgstTotal],
              ["IGST", calc.igstTotal],
              ["Round Off", calc.roundOff],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <dt className="text-muted">{k}</dt>
                <dd className="font-mono tabular-nums text-text">{fmt(v)}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 flex items-baseline justify-between rounded-xl bg-primary-soft px-4 py-3">
            <span className="text-sm font-bold uppercase tracking-wide text-primary">Grand Total</span>
            <span className="font-mono text-2xl font-bold tabular-nums text-primary">₹{fmt(calc.grandTotal)}</span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="sticky bottom-0 z-20 -mx-4 mt-5 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
        <div className="flex flex-wrap items-center gap-2">
          {locked ? (
            admin && (
              <button type="button" onClick={() => setEditing(true)} className={`${btn} bg-primary text-white hover:bg-primary-dark`}>
                <Icon name="edit" size={16} />
                Edit Entry
              </button>
            )
          ) : (
            <button type="button" onClick={save} disabled={Boolean(busy)} className={`${btn} bg-secondary text-white hover:bg-secondary-dark`}>
              <Icon name="check" size={16} />
              {busy === "save" ? "Saving…" : entry ? "Save Changes" : "Save Sales Entry"}
            </button>
          )}
          <button type="button" disabled={Boolean(busy)} onClick={withSaved("pdf", (e) => downloadSalesEntryFile(e, "pdf"))} className={ghost}>
            <Icon name="download" size={16} />
            {busy === "pdf" ? "Preparing…" : "Generate Invoice PDF"}
          </button>
          <button type="button" disabled={Boolean(busy)} onClick={withSaved("xlsx", (e) => downloadSalesEntryFile(e, "xlsx"))} className={ghost}>
            <Icon name="download" size={16} />
            {busy === "xlsx" ? "Preparing…" : "Export to Excel"}
          </button>
          <button type="button" disabled={Boolean(busy)} onClick={withSaved("print", printSalesEntry)} className={ghost}>
            <Icon name="receipt" size={16} />
            {busy === "print" ? "Preparing…" : "Print Invoice"}
          </button>
          {entry && editing && (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => {
                setForm(formFromEntry(entry));
                setEditing(false);
                setDirty(false);
              }}
              className={ghost}
            >
              Cancel Edit
            </button>
          )}
          <button type="button" disabled={Boolean(busy)} onClick={clearForm} className={`${ghost} ml-auto`}>
            <Icon name={entry ? "plus" : "close"} size={16} />
            {entry ? "New Entry" : "Clear Form"}
          </button>
        </div>
        {!locked && <p className="mt-1.5 text-[11px] text-muted">PDF, Excel and Print save the entry first. The Invoice Saver on the shop PC also files {invoiceNo}.pdf and .xlsx in the sales folder automatically.</p>}
      </div>
    </Layout>
  );
}
