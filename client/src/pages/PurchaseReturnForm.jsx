import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import Layout from "../components/Layout";
import RequiredMark from "../components/RequiredMark";
import { listPurchases } from "../api/purchases";
import { getReturnableInvoice, getReturnReasons, createPurchaseReturn } from "../api/purchaseReturns";
import { inr, showDate } from "../components/purchase/poCommon";
import { todayLocal } from "../utils/date";
import { newEntryRef } from "../utils/entryRef";

const round2 = (n) => Number(Number(n || 0).toFixed(2));

// New Purchase Return: pick the original invoice, enter what goes back per
// batch (never more than is still eligible), confirm - stock comes off at once.
export default function PurchaseReturnForm() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const purchaseId = searchParams.get("purchase") || "";
  const [search, setSearch] = useState("");
  const [found, setFound] = useState([]);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [qty, setQty] = useState({});
  const [reasons, setReasons] = useState([]);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const entryRef = useRef(newEntryRef());

  useEffect(() => {
    getReturnReasons().then(setReasons).catch(() => {});
  }, []);

  useEffect(() => {
    setData(null);
    setQty({});
    setLoadError("");
    if (!purchaseId) return;
    getReturnableInvoice(purchaseId).then(setData).catch((err) => setLoadError(err.response?.data?.message || "Could not load the invoice."));
  }, [purchaseId]);

  useEffect(() => {
    if (purchaseId) return undefined;
    const t = setTimeout(() => listPurchases(search.trim() ? { q: search.trim() } : {}).then((list) => setFound(list.slice(0, 20))).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [search, purchaseId]);

  const lines = data?.lines || [];
  const chosen = lines.filter((l) => Number(qty[l.batch]) > 0);
  const figures = chosen.map((l) => {
    const amount = round2(Number(qty[l.batch]) * l.rate);
    return { amount, gst: round2((amount * l.gstPercent) / 100) };
  });
  const subtotal = round2(figures.reduce((s, f) => s + f.amount, 0));
  const gst = round2(figures.reduce((s, f) => s + f.gst, 0));
  const overLine = lines.find((l) => qty[l.batch] !== undefined && qty[l.batch] !== "" && (!Number.isInteger(Number(qty[l.batch])) || Number(qty[l.batch]) < 0 || Number(qty[l.batch]) > l.eligiblePacks));
  const problem = overLine
    ? `${overLine.product.name} (batch ${overLine.batchNo}): enter a whole number up to ${overLine.eligiblePacks}.`
    : chosen.length === 0
      ? "Enter the quantity to return for at least one item."
      : !reason
        ? "Choose the reason for the return."
        : "";

  const save = async () => {
    if (saving) return;
    if (problem) return setError(problem);
    if (!window.confirm(`Confirm return of ${chosen.reduce((s, l) => s + Number(qty[l.batch]), 0)} pack(s), ${inr(subtotal + gst)}? Stock is reduced now.`)) return;
    setSaving(true);
    setError("");
    try {
      const ret = await createPurchaseReturn({
        purchase: purchaseId,
        date,
        reason,
        notes: notes.trim(),
        clientRef: entryRef.current,
        items: chosen.map((l) => ({ batch: l.batch, qtyPacks: Number(qty[l.batch]) })),
      });
      toast.success(`Purchase return ${ret.returnNo} confirmed. Stock reduced.`);
      navigate("/purchase-returns", { state: { view: ret } });
    } catch (err) {
      setError(err.response?.data?.message || "Could not save. Check your connection and try again - it won't be saved twice.");
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full min-w-0 rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-text focus:border-primary focus:outline-none";
  const labelCls = "mb-1 block text-xs font-medium text-muted";

  return (
    <Layout>
      <Link to="/purchase-returns" className="text-sm font-semibold text-primary hover:underline">← Purchase Returns</Link>
      <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">New Purchase Return</h1>
      <p className="mt-0.5 text-sm text-muted">Goods sent back to the supplier from one purchase invoice. Confirming reduces stock on the same batches.</p>

      {!purchaseId && (
        <section className="mt-4 rounded-2xl bg-surface p-4 shadow-sm">
          <label htmlFor="pr-search" className={labelCls}>Original purchase invoice<RequiredMark /></label>
          <input id="pr-search" type="search" autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search PI no, supplier invoice no or supplier" className={inputCls} />
          <ul className="mt-2 divide-y divide-border">
            {found.map((p) => (
              <li key={p._id}>
                <button type="button" onClick={() => setSearchParams({ purchase: p._id })} className="flex w-full flex-wrap items-center justify-between gap-2 px-2 py-2 text-left text-sm hover:bg-bg">
                  <span><span className="font-mono font-semibold text-primary">{p.piNo}</span> · {p.vendor?.name || p.supplierName || "No supplier"} · inv {p.invoiceNo} · {showDate(p.date)}</span>
                  <span className="font-mono">{inr(p.total)}</span>
                </button>
              </li>
            ))}
            {found.length === 0 && <li className="py-2 text-sm text-muted">No invoices found.</li>}
          </ul>
        </section>
      )}

      {purchaseId && !data && <p className={`mt-4 text-sm ${loadError ? "text-danger" : "text-muted"}`}>{loadError || "Loading invoice…"}</p>}

      {data && (
        <>
          <section className="mt-4 grid gap-3 rounded-2xl bg-surface p-4 shadow-sm sm:grid-cols-4">
            <div className="sm:col-span-2">
              <p className={labelCls}>Invoice</p>
              <p className="text-sm text-text">
                <span className="font-mono font-semibold">{data.purchase.piNo}</span> · supplier inv {data.purchase.invoiceNo} · {showDate(data.purchase.date)}
                {data.purchase.poNo ? ` · ${data.purchase.poNo}` : ""}
              </p>
              <p className="text-sm font-semibold text-text">{data.purchase.supplier}</p>
              <button type="button" onClick={() => setSearchParams({})} className="mt-1 text-xs font-semibold text-primary hover:underline">Choose another invoice</button>
            </div>
            <div>
              <label htmlFor="pr-date" className={labelCls}>Return date</label>
              <input id="pr-date" type="date" max={todayLocal()} value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label htmlFor="pr-reason" className={labelCls}>Reason<RequiredMark /></label>
              <select id="pr-reason" value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls}>
                <option value="">Select…</option>
                {reasons.map((r) => <option key={r}>{r}</option>)}
              </select>
            </div>
            {data.previous.length > 0 && (
              <p className="text-xs text-muted sm:col-span-4">Earlier returns: {data.previous.map((r) => `${r.returnNo} (${r.status}, ${inr(r.total)})`).join(" · ")}</p>
            )}
          </section>

          <div className="mt-4 overflow-x-auto rounded-xl bg-surface shadow-sm">
            <table className="w-full min-w-[760px] text-left text-sm text-text">
              <thead className="border-b border-border text-xs uppercase text-muted">
                <tr>
                  <th className="px-3 py-2">Item / Batch</th><th className="px-3 py-2 text-right">Received</th><th className="px-3 py-2 text-right">Returned</th><th className="px-3 py-2 text-right">In stock</th>
                  <th className="px-3 py-2 text-right">Can return</th><th className="px-3 py-2 text-right">Rate</th><th className="px-3 py-2">Return qty</th><th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const q = Number(qty[l.batch]) || 0;
                  return (
                    <tr key={l.batch} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">
                        {l.product.name}
                        <p className="text-xs text-muted">Batch {l.batchNo}{l.expiryDate ? ` · exp ${showDate(l.expiryDate)}` : ""} · GST {l.gstPercent}%</p>
                      </td>
                      <td className="px-3 py-2 text-right">{l.receivedPacks}</td>
                      <td className="px-3 py-2 text-right">{l.returnedPacks || "—"}</td>
                      <td className="px-3 py-2 text-right">{l.onHandPacks}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${l.eligiblePacks ? "text-success" : "text-muted"}`}>{l.eligiblePacks}</td>
                      <td className="px-3 py-2 text-right font-mono">{inr(l.rate)}</td>
                      <td className="px-3 py-2">
                        <input type="number" min="0" max={l.eligiblePacks} step="1" disabled={!l.eligiblePacks} aria-label={`Return quantity for ${l.product.name}`} value={qty[l.batch] ?? ""} onChange={(e) => setQty((x) => ({ ...x, [l.batch]: e.target.value }))} className={`${inputCls} w-24 disabled:opacity-40`} />
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{q ? inr(round2(q * l.rate * (1 + l.gstPercent / 100))) : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-muted">Quantities are in packs. "Can return" is received, less returned already, and never more than is still in stock.</p>

          <section className="mt-4 grid gap-4 rounded-2xl bg-surface p-4 shadow-sm md:grid-cols-[1fr_260px]">
            <div>
              <label htmlFor="pr-notes" className={labelCls}>Notes</label>
              <textarea id="pr-notes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="Debit note no, courier, etc." />
            </div>
            <dl className="space-y-1 text-sm text-text">
              <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="tabular-nums">{inr(subtotal)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">GST</dt><dd className="tabular-nums">{inr(gst)}</dd></div>
              <div className="flex items-baseline justify-between border-t border-border pt-2">
                <dt className="font-display text-base font-semibold">Return value</dt>
                <dd className="font-display text-2xl font-bold tabular-nums">{inr(subtotal + gst)}</dd>
              </div>
            </dl>
          </section>

          {error && <p className="mt-4 text-sm text-danger" role="alert">{error}</p>}
          <div className="mt-4 flex flex-wrap gap-2 pb-6">
            <button type="button" onClick={save} disabled={saving || chosen.length === 0} className="rounded-xl bg-accent px-8 py-3 text-base font-semibold text-white hover:brightness-95 disabled:opacity-50">
              {saving ? "Saving…" : "Confirm Return & Reduce Stock"}
            </button>
            <button type="button" onClick={() => navigate(-1)} className="rounded-xl px-5 py-3 text-sm font-semibold text-muted hover:bg-surface">Cancel</button>
          </div>
        </>
      )}
    </Layout>
  );
}
