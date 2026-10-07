import { useState } from "react";
import { updateBatch } from "../api/products";
import RackInput from "./RackInput";
import RequiredMark from "./RequiredMark";
import { NO_RACK, isRackChoice } from "../utils/rack";

// Edit one stock entry (batch). Quantity is in the product's stock unit -
// loose units (e.g. Tablets) for products sold loose, whole packs otherwise.
// Cost price is only shown to admins.
export default function BatchEditModal({ product, batch, isAdmin, onClose, onSaved }) {
  const unit = product.soldAs === "pack-and-loose" ? `${product.looseUnitName}s` : `${product.packUnit}s`;
  const [form, setForm] = useState({
    batchNo: batch.batchNo,
    expiryDate: String(batch.expiryDate).slice(0, 10),
    qtyRemaining: String(batch.qtyRemaining),
    rack: batch.rack || NO_RACK,
    costPrice: batch.costPrice ?? "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const qty = Number(form.qtyRemaining);
  const qtyValid = form.qtyRemaining !== "" && Number.isInteger(qty) && qty >= 0;
  const isValid = form.batchNo.trim() && form.expiryDate && qtyValid && isRackChoice(form.rack) && (!isAdmin || Number(form.costPrice) >= 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isValid || saving) return;
    setSaving(true);
    setError("");
    try {
      const data = {
        batchNo: form.batchNo.trim(),
        expiryDate: form.expiryDate,
        qtyRemaining: qty,
        rack: form.rack,
        ...(isAdmin ? { costPrice: Number(form.costPrice) } : {}),
      };
      await updateBatch(product._id, batch._id, data);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.message || "Something went wrong. Please try again.");
      setSaving(false);
    }
  };

  const inputCls = "mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none";
  const labelCls = "block text-sm font-medium text-text";
  const change = qtyValid ? qty - batch.qtyRemaining : 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8" onClick={onClose}>
      <form onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()} className="w-full max-w-md space-y-4 rounded-2xl bg-surface p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold text-text">Edit Stock</h2>
            <p className="mt-0.5 text-sm text-muted">{product.name}</p>
          </div>
          <button type="button" onClick={onClose} className="text-muted hover:text-text" aria-label="Close">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Batch No<RequiredMark /></label>
            <input type="text" maxLength={30} value={form.batchNo} onChange={set("batchNo")} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Expiry Date<RequiredMark /></label>
            <input type="date" value={form.expiryDate} onChange={set("expiryDate")} className={inputCls} />
          </div>
          <div className={isAdmin ? "" : "col-span-2"}>
            <label className={labelCls}>Qty on hand ({unit})<RequiredMark /></label>
            <input type="number" min="0" step="1" value={form.qtyRemaining} onChange={set("qtyRemaining")} className={inputCls} />
          </div>
          {isAdmin && (
            <div>
              <label className={labelCls}>Cost Price (₹, per pack)<RequiredMark /></label>
              <input type="number" min="0" step="0.01" value={form.costPrice} onChange={set("costPrice")} className={inputCls} />
            </div>
          )}
          <RackInput
            id="batch-rack"
            className="col-span-2"
            labelClassName={labelCls}
            value={form.rack}
            onChange={(v) => setForm((f) => ({ ...f, rack: v }))}
            invalid={!isRackChoice(form.rack)}
          />
        </div>

        {change !== 0 && (
          <p className={`rounded-lg px-3 py-2 text-xs ${change > 0 ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
            Stock will {change > 0 ? "increase" : "decrease"} by {Math.abs(change)} {unit}. This is recorded in the stock ledger.
          </p>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={!isValid || saving}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
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
