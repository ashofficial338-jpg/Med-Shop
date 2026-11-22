import { useEffect, useState } from "react";
import { listProducts } from "../api/products";
import { updateSale } from "../api/sales";
import CustomerPicker from "./CustomerPicker";

const MODES = ["Cash", "Card", "UPI", "Other", "Credit"];
const emptyLine = { product: "", unitType: "pack", qty: "1", rate: "" };

// Corrects a completed bill (admin). The bill keeps its number and date; the
// server puts the original stock back and takes the corrected lines again.
export default function SaleEditModal({ sale, onClose, onSaved }) {
  const [products, setProducts] = useState([]);
  const [lines, setLines] = useState(() =>
    sale.items.map((i) => ({ product: String(i.product), name: i.name, unitType: i.unitType, qty: String(i.qty), rate: String(i.rate) }))
  );
  const [customer, setCustomer] = useState(sale.customer || null);
  const [paymentMode, setPaymentMode] = useState(sale.paymentMode);
  const [discount, setDiscount] = useState(sale.discount ? String(sale.discount) : "");
  const [amountReceived, setAmountReceived] = useState(sale.receivedAtBilling ? String(sale.receivedAtBilling) : "");
  const [allowExpired, setAllowExpired] = useState(false);
  const [needsExpiredOk, setNeedsExpiredOk] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listProducts().then(setProducts).catch(() => {});
  }, []);

  const collectedLater = sale.collectedLater || 0;
  const productById = (id) => products.find((p) => p._id === id);
  const choices = [
    ...products,
    ...lines.filter((l) => l.product && !productById(l.product)).map((l) => ({ _id: l.product, name: l.name || "Product", productCode: "inactive" })),
  ];
  const original = (l) => sale.items.find((i) => String(i.product) === l.product && i.unitType === l.unitType);
  const currentRate = (productId, unitType) => {
    const p = productById(productId);
    if (!p) return "";
    return String(unitType === "loose" ? p.looseRate ?? 0 : p.packRate ?? 0);
  };

  const setLine = (idx, patch) => setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  // A new product or unit starts at the bill's own rate if it had that line, else today's price.
  const pickProduct = (idx, id) => {
    const o = sale.items.find((i) => String(i.product) === id && i.unitType === "pack");
    setLine(idx, { product: id, unitType: "pack", rate: o ? String(o.rate) : currentRate(id, "pack") });
  };
  const pickUnit = (idx, line, unitType) => {
    const o = sale.items.find((i) => String(i.product) === line.product && i.unitType === unitType);
    setLine(idx, { unitType, rate: o ? String(o.rate) : currentRate(line.product, unitType) });
  };

  const gstOf = (l) => original(l)?.gstPercent ?? productById(l.product)?.gstPercent ?? 0;
  const amountOf = (l) => (Number(l.qty) || 0) * (Number(l.rate) || 0);
  const subtotal = lines.reduce((s, l) => s + amountOf(l), 0);
  const gstTotal = lines.reduce((s, l) => s + Number(((amountOf(l) * gstOf(l)) / 100).toFixed(2)), 0);
  const appliedDiscount = Number(discount) || 0;
  const total = subtotal + gstTotal - appliedDiscount;
  const isCredit = paymentMode === "Credit";
  const receivedNow = isCredit ? Math.max(Number(amountReceived) || 0, 0) : total;
  const balanceDue = isCredit ? Number((total - collectedLater - receivedNow).toFixed(2)) : 0;

  const isValid =
    lines.length > 0 &&
    lines.every((l) => l.product && Number(l.qty) > 0 && l.rate !== "" && Number(l.rate) >= 0) &&
    (!isCredit || Boolean(customer));

  const submit = async () => {
    if (!isValid || saving) return;
    setSaving(true);
    setError("");
    try {
      const updated = await updateSale(sale._id, {
        customer: customer?._id || null,
        paymentMode,
        discount: appliedDiscount,
        amountReceived: isCredit ? receivedNow : undefined,
        overrideExpired: allowExpired,
        items: lines.map((l) => ({ product: l.product, unitType: l.unitType, qty: Number(l.qty), rate: Number(l.rate) })),
      });
      onSaved(updated);
    } catch (err) {
      setError(err.response?.data?.message || "Something went wrong. Please try again.");
      if (err.response?.data?.expired) setNeedsExpiredOk(true);
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text focus:border-primary focus:outline-none disabled:opacity-60";
  const labelCls = "block text-xs font-medium text-muted";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8">
      <div className="w-full max-w-2xl space-y-4 rounded-2xl bg-surface p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-text">Edit Bill — {sale.billNo}</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-text" aria-label="Close">✕</button>
        </div>
        <p className="rounded-lg bg-bg px-3 py-2 text-xs text-muted">
          The bill keeps its number and date. Stock from the original lines goes back, and the corrected lines are taken from the same batches first.
        </p>

        <div className="space-y-2">
          {lines.map((line, idx) => {
            const p = productById(line.product);
            const canLoose = p?.soldAs === "pack-and-loose";
            return (
              <div key={idx} className="grid grid-cols-2 items-end gap-2 rounded-xl border border-border p-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
                <div className="col-span-2 sm:col-span-1">
                  <label className={labelCls}>Product</label>
                  <select value={line.product} onChange={(e) => pickProduct(idx, e.target.value)} className={inputCls}>
                    <option value="">Select…</option>
                    {choices.map((c) => (
                      <option key={c._id} value={c._id}>{c.name} ({c.productCode})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Unit</label>
                  <select value={line.unitType} onChange={(e) => pickUnit(idx, line, e.target.value)} disabled={!canLoose && line.unitType === "pack"} className={inputCls}>
                    <option value="pack">{p?.packUnit || "Pack"}</option>
                    {(canLoose || line.unitType === "loose") && <option value="loose">{p?.looseUnitName || "Loose"}</option>}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Qty</label>
                  <input type="number" min="1" value={line.qty} onChange={(e) => setLine(idx, { qty: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Rate (₹)</label>
                  <input type="number" min="0" step="0.01" value={line.rate} onChange={(e) => setLine(idx, { rate: e.target.value })} className={inputCls} />
                </div>
                <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-end">
                  <span className="font-mono text-xs text-text">₹{amountOf(line).toFixed(2)}</span>
                  {lines.length > 1 && (
                    <button type="button" onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))} className="text-xs text-danger hover:underline">
                      Remove
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <button type="button" onClick={() => setLines((ls) => [...ls, { ...emptyLine }])} className="text-sm font-semibold text-primary hover:underline">
          + Add Product
        </button>

        <div>
          <label className="mb-1 block text-sm font-medium text-text">Customer</label>
          {collectedLater > 0 ? (
            <p className="text-sm text-text">{sale.customer?.name} <span className="text-xs text-muted">(payments already recorded, can't change)</span></p>
          ) : (
            <CustomerPicker selected={customer} onSelect={setCustomer} isAdmin />
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <label className={labelCls}>Payment Mode</label>
            <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} disabled={collectedLater > 0} className={inputCls}>
              {MODES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Discount (₹)</label>
            <input type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} className={inputCls} />
          </div>
          {isCredit && (
            <div>
              <label className={labelCls}>Received at Billing (₹)</label>
              <input type="number" min="0" step="0.01" value={amountReceived} onChange={(e) => setAmountReceived(e.target.value)} className={inputCls} />
            </div>
          )}
        </div>
        {isCredit && !customer && <p className="text-xs text-danger">Select a customer to keep this bill on credit.</p>}

        <div className="rounded-xl bg-bg p-4 text-sm text-text">
          <div className="flex justify-between"><span>Subtotal</span><span>₹{subtotal.toFixed(2)}</span></div>
          <div className="flex justify-between"><span>GST</span><span>₹{gstTotal.toFixed(2)}</span></div>
          {appliedDiscount > 0 && <div className="flex justify-between"><span>Discount</span><span>-₹{appliedDiscount.toFixed(2)}</span></div>}
          <div className="mt-1 flex justify-between border-t border-border pt-1 font-semibold"><span>Total</span><span>₹{total.toFixed(2)}</span></div>
          {isCredit && (
            <>
              {collectedLater > 0 && <div className="flex justify-between text-muted"><span>Collected later</span><span>₹{collectedLater.toFixed(2)}</span></div>}
              <div className="flex justify-between text-muted"><span>Received at billing</span><span>₹{receivedNow.toFixed(2)}</span></div>
              <div className="flex justify-between font-semibold text-danger"><span>Balance Due</span><span>₹{balanceDue.toFixed(2)}</span></div>
            </>
          )}
        </div>

        {needsExpiredOk && (
          <label className="flex items-center gap-2 text-sm text-text">
            <input type="checkbox" checked={allowExpired} onChange={(e) => setAllowExpired(e.target.checked)} />
            Allow expired stock
          </label>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={!isValid || saving}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-primary-dark"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
          <button type="button" onClick={onClose} className="rounded-lg px-5 py-2 text-sm font-semibold text-muted hover:bg-bg">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
