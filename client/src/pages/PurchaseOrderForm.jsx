import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import Layout from "../components/Layout";
import { listProducts } from "../api/products";
import { listVendors } from "../api/vendors";
import { getLastPurchaseRate } from "../api/purchases";
import { createPurchaseOrder, getPurchaseOrder, updatePurchaseOrder } from "../api/purchaseOrders";
import { ItemSelect, GST_RATES, inr } from "../components/purchase/poCommon";
import RequiredMark from "../components/RequiredMark";
import { todayLocal } from "../utils/date";
import { newEntryRef } from "../utils/entryRef";

const round2 = (n) => Number(Number(n || 0).toFixed(2));
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");
let seq = 0;
const blankLine = (patch = {}) => ({ key: `l${++seq}`, product: "", qty: "", rate: "", discountPercent: "", gstPercent: "", received: 0, ...patch });

function figures(l) {
  const qty = Number(l.qty) || 0;
  const gross = qty * (Number(l.rate) || 0);
  const taxable = round2(gross * (1 - (Number(l.discountPercent) || 0) / 100));
  const gst = round2((taxable * (Number(l.gstPercent) || 0)) / 100);
  return { gross: round2(gross), discount: round2(gross - taxable), taxable, gst, total: round2(taxable + gst) };
}

// Raise or edit a Purchase Order. Saving it never changes stock.
export default function PurchaseOrderForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const [vendors, setVendors] = useState([]);
  const [products, setProducts] = useState([]);
  const [original, setOriginal] = useState(null);
  const [vendor, setVendor] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([blankLine()]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const entryRef = useRef(newEntryRef());

  useEffect(() => {
    listVendors().then((v) => setVendors(v.filter((x) => x.isActive !== false))).catch(() => {});
    listProducts().then(setProducts).catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    getPurchaseOrder(id)
      .then((po) => {
        setOriginal(po);
        setVendor(po.vendor?._id || "");
        setDate(day(po.date));
        setExpectedDate(day(po.expectedDate));
        setNotes(po.notes || "");
        setLines([
          ...po.items.map((i) =>
            blankLine({ product: i.product?._id, qty: String(i.qty), rate: String(i.rate), discountPercent: i.discountPercent ? String(i.discountPercent) : "", gstPercent: String(i.gstPercent), received: i.received || 0 })
          ),
          blankLine(),
        ]);
      })
      .catch((err) => setError(err.response?.data?.message || "Could not load this order."));
  }, [id]);

  const setLine = (key, patch) =>
    setLines((ls) => {
      const next = ls.map((l) => (l.key === key ? { ...l, ...patch } : l));
      return next[next.length - 1].product ? [...next, blankLine()] : next;
    });

  const pick = (key, p) => {
    setLine(key, { product: p._id, gstPercent: String(p.gstPercent ?? 0), rate: "" });
    getLastPurchaseRate({ product: p._id, vendor: vendor || undefined })
      .then((r) => r.suggested != null && setLines((ls) => ls.map((l) => (l.key === key && l.product === p._id && l.rate === "" ? { ...l, rate: String(r.suggested) } : l))))
      .catch(() => {});
  };

  const filled = lines.filter((l) => l.product);
  const f = filled.map(figures);
  const sum = (k) => round2(f.reduce((s, x) => s + x[k], 0));
  const lineProblem = (l) => {
    const name = products.find((p) => p._id === l.product)?.name || "an item";
    if (!(Number.isInteger(Number(l.qty)) && Number(l.qty) > 0)) return `Enter a whole quantity for ${name}.`;
    if (Number(l.qty) < l.received) return `${l.received} of ${name} have already been received, so the quantity can't be lower.`;
    if (l.rate !== "" && !(Number(l.rate) >= 0)) return `Enter a valid rate for ${name}.`;
    if (l.discountPercent !== "" && !(Number(l.discountPercent) >= 0 && Number(l.discountPercent) <= 100)) return `The discount on ${name} must be 0–100%.`;
    return "";
  };
  const problem = !vendor ? "Choose the supplier." : filled.length === 0 ? "Add at least one item." : filled.map(lineProblem).find(Boolean) || "";

  const save = async (status) => {
    if (saving) return;
    if (problem) return setError(problem);
    setSaving(true);
    setError("");
    const body = {
      vendor,
      date,
      expectedDate: expectedDate || null,
      notes: notes.trim(),
      status,
      items: filled.map((l) => ({ product: l.product, qty: Number(l.qty), rate: l.rate === "" ? 0 : Number(l.rate), discountPercent: l.discountPercent === "" ? 0 : Number(l.discountPercent), gstPercent: Number(l.gstPercent) || 0 })),
    };
    try {
      const po = editing ? await updatePurchaseOrder(id, body) : await createPurchaseOrder({ ...body, clientRef: entryRef.current });
      toast.success(`Purchase order ${po.poNo} ${editing ? "updated" : status === "Draft" ? "saved as draft" : "raised"}. Stock is not changed.`);
      navigate(`/purchase-orders/${po._id}`);
    } catch (err) {
      setError(err.response?.data?.message || "Could not save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full min-w-0 rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-text focus:border-primary focus:outline-none disabled:opacity-60";
  const labelCls = "mb-1 block text-xs font-medium text-muted";
  const anyReceived = lines.some((l) => l.received > 0);

  if (editing && !original) {
    return <Layout><p className={`text-sm ${error ? "text-danger" : "text-muted"}`}>{error || "Loading…"}</p></Layout>;
  }

  return (
    <Layout>
      <form onSubmit={(e) => (e.preventDefault(), save(editing ? original.status : "Pending"))}>
        <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">{editing ? `Edit ${original.poNo}` : "New Purchase Order"}</h1>
        <p className="mt-0.5 text-sm text-muted">An order to the supplier. Stock is added only when goods are received on a Purchase Invoice.</p>

        <section className="mt-4 grid gap-3 rounded-2xl bg-surface p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label htmlFor="po-vendor" className={labelCls}>Supplier<RequiredMark /></label>
            <select id="po-vendor" value={vendor} disabled={anyReceived} onChange={(e) => setVendor(e.target.value)} className={inputCls}>
              <option value="">Select supplier…</option>
              {vendors.map((v) => <option key={v._id} value={v._id}>{v.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="po-date" className={labelCls}>PO Date</label>
            <input id="po-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label htmlFor="po-expected" className={labelCls}>Expected By</label>
            <input id="po-expected" type="date" min={date} value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className={inputCls} />
          </div>
        </section>

        <section className="mt-4 rounded-2xl bg-surface shadow-sm">
          <div className="hidden grid-cols-[minmax(0,3fr)_repeat(4,minmax(0,1fr))_minmax(0,1.2fr)_2rem] gap-2 border-b border-border px-4 py-2 text-xs font-semibold uppercase text-muted md:grid">
            <span>Item</span><span>Qty</span><span>Rate (₹)</span><span>Disc %</span><span>GST %</span><span className="text-right">Amount</span><span />
          </div>
          <ul className="divide-y divide-border">
            {lines.map((l) => {
              const x = figures(l);
              return (
                <li key={l.key} className="grid grid-cols-2 gap-2 px-4 py-3 md:grid-cols-[minmax(0,3fr)_repeat(4,minmax(0,1fr))_minmax(0,1.2fr)_2rem] md:items-center">
                  <div className="col-span-2 md:col-span-1">
                    <ItemSelect products={products} value={l.product} onPick={(p) => pick(l.key, p)} inputCls={inputCls} />
                    {l.received > 0 && <p className="mt-0.5 text-xs text-muted">{l.received} received already</p>}
                  </div>
                  <label className="text-xs text-muted md:contents"><span className="md:hidden">Qty</span>
                    <input type="number" min={Math.max(1, l.received)} step="1" aria-label="Quantity" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} className={inputCls} />
                  </label>
                  <label className="text-xs text-muted md:contents"><span className="md:hidden">Rate (₹)</span>
                    <input type="number" min="0" step="0.01" aria-label="Rate" value={l.rate} onChange={(e) => setLine(l.key, { rate: e.target.value })} className={inputCls} />
                  </label>
                  <label className="text-xs text-muted md:contents"><span className="md:hidden">Disc %</span>
                    <input type="number" min="0" max="100" step="0.01" aria-label="Discount percent" value={l.discountPercent} onChange={(e) => setLine(l.key, { discountPercent: e.target.value })} className={inputCls} />
                  </label>
                  <label className="text-xs text-muted md:contents"><span className="md:hidden">GST %</span>
                    <select aria-label="GST percent" value={l.gstPercent} onChange={(e) => setLine(l.key, { gstPercent: e.target.value })} className={inputCls}>
                      <option value="">—</option>
                      {GST_RATES.map((g) => <option key={g} value={g}>{g}%</option>)}
                    </select>
                  </label>
                  <p className="self-center text-right font-mono text-sm text-text">{l.product ? inr(x.total) : ""}</p>
                  <button type="button" disabled={!l.product || l.received > 0} onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((y) => y.key !== l.key) : ls))} className="justify-self-end text-muted hover:text-danger disabled:opacity-30" aria-label="Remove line">✕</button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="mt-4 grid gap-4 rounded-2xl bg-surface p-4 shadow-sm md:grid-cols-[1fr_280px]">
          <div>
            <label htmlFor="po-notes" className={labelCls}>Terms & notes for the supplier</label>
            <textarea id="po-notes" rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="Delivery address, payment terms, etc." />
          </div>
          <dl className="space-y-1 text-sm text-text">
            {sum("discount") > 0 && (
              <>
                <div className="flex justify-between"><dt className="text-muted">Gross</dt><dd className="tabular-nums">{inr(sum("gross"))}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Discount</dt><dd className="tabular-nums">−{inr(sum("discount"))}</dd></div>
              </>
            )}
            <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="tabular-nums">{inr(sum("taxable"))}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">GST</dt><dd className="tabular-nums">{inr(sum("gst"))}</dd></div>
            <div className="flex items-baseline justify-between border-t border-border pt-2">
              <dt className="font-display text-base font-semibold">Grand Total</dt>
              <dd className="font-display text-2xl font-bold tabular-nums">{inr(sum("total"))}</dd>
            </div>
          </dl>
        </section>

        {error && <p className="mt-4 text-sm text-danger" role="alert">{error}</p>}
        <div className="mt-4 flex flex-wrap gap-2 pb-6">
          {editing ? (
            <>
              <button type="submit" disabled={saving} className="rounded-xl bg-accent px-8 py-3 text-base font-semibold text-white hover:brightness-95 disabled:opacity-50">{saving ? "Saving…" : "Save Changes"}</button>
              {original.status === "Draft" && (
                <button type="button" disabled={saving} onClick={() => save("Pending")} className="rounded-xl border border-border bg-surface px-6 py-3 text-sm font-semibold text-primary hover:bg-bg disabled:opacity-50">Save & Raise</button>
              )}
            </>
          ) : (
            <>
              <button type="submit" disabled={saving} className="rounded-xl bg-accent px-8 py-3 text-base font-semibold text-white hover:brightness-95 disabled:opacity-50">{saving ? "Saving…" : "Raise Order"}</button>
              <button type="button" disabled={saving} onClick={() => save("Draft")} className="rounded-xl border border-border bg-surface px-6 py-3 text-sm font-semibold text-primary hover:bg-bg disabled:opacity-50">Save as Draft</button>
            </>
          )}
          <button type="button" onClick={() => navigate(-1)} className="rounded-xl px-5 py-3 text-sm font-semibold text-muted hover:bg-surface">Cancel</button>
        </div>
      </form>
    </Layout>
  );
}
