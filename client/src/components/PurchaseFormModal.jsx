import { useEffect, useState } from "react";
import { listProducts } from "../api/products";
import { createPurchase } from "../api/purchases";
import RequiredMark from "./RequiredMark";

const emptyLine = { product: "", qtyPacks: "", costPrice: "", batchNo: "", expiryDate: "" };

export default function PurchaseFormModal({ vendor, onClose, onSaved }) {
  const [products, setProducts] = useState([]);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [tdsAmount, setTdsAmount] = useState("");
  const [lines, setLines] = useState([{ ...emptyLine }]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listProducts().then(setProducts);
  }, []);

  const productById = (id) => products.find((p) => p._id === id);

  // This vendor's own products surface first (own optgroup) since a purchase
  // is almost always against them - the rest of the catalog stays searchable
  // right below instead of disappearing.
  const vendorProducts = products.filter((p) => p.vendor?._id === vendor._id || p.vendor === vendor._id);
  const otherProducts = products.filter((p) => !(p.vendor?._id === vendor._id || p.vendor === vendor._id));

  const setLine = (idx, key, value) => {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, [key]: value } : l)));
  };

  const addLine = () => setLines((ls) => [...ls, { ...emptyLine }]);
  const removeLine = (idx) => setLines((ls) => ls.filter((_, i) => i !== idx));

  const lineAmount = (line) => {
    const qty = Number(line.qtyPacks) || 0;
    const cost = Number(line.costPrice) || 0;
    return qty * cost;
  };
  const lineGst = (line) => {
    const product = productById(line.product);
    if (!product) return 0;
    return Number(((lineAmount(line) * product.gstPercent) / 100).toFixed(2));
  };

  const subtotal = lines.reduce((sum, l) => sum + lineAmount(l), 0);
  const gstTotal = lines.reduce((sum, l) => sum + lineGst(l), 0);
  const tds = Number(tdsAmount) || 0;
  const total = subtotal + gstTotal;

  const validLines = lines.filter(
    (l) => l.product && Number(l.qtyPacks) > 0 && Number(l.costPrice) >= 0 && l.batchNo.trim() && l.expiryDate
  );
  const isValid = invoiceNo.trim().length > 0 && date && validLines.length === lines.length && lines.length > 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isValid || saving) return;
    setSaving(true);
    setError("");
    try {
      const saved = await createPurchase({
        vendor: vendor._id,
        invoiceNo,
        date,
        tdsAmount: tds,
        items: lines.map((l) => ({
          product: l.product,
          qtyPacks: Number(l.qtyPacks),
          costPrice: Number(l.costPrice),
          batchNo: l.batchNo,
          expiryDate: l.expiryDate,
        })),
      });
      onSaved(saved);
    } catch (err) {
      setError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text focus:border-primary focus:outline-none";
  const labelCls = "block text-xs font-medium text-muted";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8">
      <form onSubmit={handleSubmit} className="w-full max-w-2xl space-y-4 rounded-2xl bg-surface p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-text">New Purchase — {vendor.name}</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-text" aria-label="Close">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Invoice No<RequiredMark /></label>
            <input type="text" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Date<RequiredMark /></label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>
        </div>

        <div className="space-y-3">
          {lines.map((line, idx) => (
            <div key={idx} className="rounded-xl border border-border p-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <div className="col-span-2 sm:col-span-1">
                  <label className={labelCls}>Product<RequiredMark /></label>
                  <select value={line.product} onChange={(e) => setLine(idx, "product", e.target.value)} className={inputCls}>
                    <option value="">Select…</option>
                    {vendorProducts.length > 0 && (
                      <optgroup label={`${vendor.name}'s products`}>
                        {vendorProducts.map((p) => (
                          <option key={p._id} value={p._id}>{p.name} ({p.productCode})</option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label={vendorProducts.length > 0 ? "Other products" : "All products"}>
                      {otherProducts.map((p) => (
                        <option key={p._id} value={p._id}>{p.name} ({p.productCode})</option>
                      ))}
                    </optgroup>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Qty ({productById(line.product)?.packUnit || "Packs"})<RequiredMark /></label>
                  <input type="number" min="1" value={line.qtyPacks} onChange={(e) => setLine(idx, "qtyPacks", e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Cost Price<RequiredMark /></label>
                  <input type="number" min="0" step="0.01" value={line.costPrice} onChange={(e) => setLine(idx, "costPrice", e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Batch No<RequiredMark /></label>
                  <input type="text" value={line.batchNo} onChange={(e) => setLine(idx, "batchNo", e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Expiry Date<RequiredMark /></label>
                  <input type="date" value={line.expiryDate} onChange={(e) => setLine(idx, "expiryDate", e.target.value)} className={inputCls} />
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-muted">
                <span>Line: ₹{lineAmount(line).toFixed(2)} + GST ₹{lineGst(line).toFixed(2)}</span>
                {lines.length > 1 && (
                  <button type="button" onClick={() => removeLine(idx)} className="text-danger hover:underline">
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <button type="button" onClick={addLine} className="text-sm font-semibold text-primary hover:underline">
          + Add Line
        </button>

        <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
          <div>
            <label className={labelCls}>TDS Amount (optional)</label>
            <input type="number" min="0" step="0.01" value={tdsAmount} onChange={(e) => setTdsAmount(e.target.value)} className={inputCls} />
          </div>
          <div className="text-right text-sm text-text">
            <p>Subtotal: ₹{subtotal.toFixed(2)}</p>
            <p>GST: ₹{gstTotal.toFixed(2)}</p>
            <p className="text-muted">TDS (tracked separately): ₹{tds.toFixed(2)}</p>
            <p className="font-semibold">Total: ₹{total.toFixed(2)}</p>
          </div>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={!isValid || saving}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-primary-dark"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={onClose} className="rounded-lg px-5 py-2 text-sm font-semibold text-muted hover:bg-bg">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
