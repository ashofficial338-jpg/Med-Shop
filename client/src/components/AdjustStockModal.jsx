import { useEffect, useState } from "react";
import { listProducts, getProductBatches } from "../api/products";
import { adjustStock } from "../api/stock";
import RequiredMark from "./RequiredMark";

const NEW_BATCH = "__new__";

export default function AdjustStockModal({ onClose, onSaved }) {
  const [products, setProducts] = useState([]);
  const [product, setProduct] = useState("");
  const [batches, setBatches] = useState([]);
  const [batchChoice, setBatchChoice] = useState(""); // an existing batch _id, or NEW_BATCH
  const [adjustmentType, setAdjustmentType] = useState("add");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [newBatchNo, setNewBatchNo] = useState("");
  const [newExpiryDate, setNewExpiryDate] = useState("");
  const [newCostPrice, setNewCostPrice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listProducts().then(setProducts);
  }, []);

  useEffect(() => {
    setBatchChoice("");
    setBatches([]);
    if (!product) return;
    getProductBatches(product).then((data) => setBatches(data.filter((b) => b.qtyRemaining > 0)));
  }, [product]);

  const isNewBatch = adjustmentType === "add" && batchChoice === NEW_BATCH;

  const isValid =
    product &&
    Number(qty) > 0 &&
    reason.trim().length > 0 &&
    (adjustmentType === "reduce"
      ? Boolean(batchChoice)
      : batchChoice === NEW_BATCH
      ? newBatchNo.trim() && newExpiryDate && newCostPrice !== ""
      : Boolean(batchChoice));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isValid || saving) return;
    setSaving(true);
    setError("");
    try {
      await adjustStock({
        product,
        adjustmentType,
        qty: Number(qty),
        reason: reason.trim(),
        batchId: batchChoice && batchChoice !== NEW_BATCH ? batchChoice : undefined,
        batchNo: isNewBatch ? newBatchNo.trim() : undefined,
        expiryDate: isNewBatch ? newExpiryDate : undefined,
        costPrice: isNewBatch ? newCostPrice : undefined,
      });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none";
  const labelCls = "block text-sm font-medium text-text";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-3 rounded-2xl bg-surface p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-text">Adjust Stock</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-text" aria-label="Close">✕</button>
        </div>

        <div>
          <label className={labelCls}>Product<RequiredMark /></label>
          <select value={product} onChange={(e) => setProduct(e.target.value)} className={inputCls}>
            <option value="">Select…</option>
            {products.map((p) => (
              <option key={p._id} value={p._id}>{p.name} ({p.productCode})</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls}>Adjustment Type</label>
          <div className="mt-1 flex gap-4 text-sm text-text">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={adjustmentType === "add"} onChange={() => setAdjustmentType("add")} />
              Add
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={adjustmentType === "reduce"} onChange={() => setAdjustmentType("reduce")} />
              Reduce
            </label>
          </div>
        </div>

        {product && (
          <div>
            <label className={labelCls}>
              {adjustmentType === "add" ? "Batch (top up existing, or start a new one)" : "Which batch was this from?"}
              <RequiredMark />
            </label>
            <select value={batchChoice} onChange={(e) => setBatchChoice(e.target.value)} className={inputCls}>
              <option value="">Select…</option>
              {batches.map((b) => (
                <option key={b._id} value={b._id}>
                  {b.batchNo} — {b.qtyRemaining} left, expires {new Date(b.expiryDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                </option>
              ))}
              {adjustmentType === "add" && <option value={NEW_BATCH}>+ New Batch…</option>}
            </select>
            {adjustmentType === "reduce" && batches.length === 0 && (
              <p className="mt-1 text-xs text-muted">This product has no stock in any batch.</p>
            )}
          </div>
        )}

        {isNewBatch && (
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-border p-3">
            <div className="col-span-2">
              <label className={labelCls}>Batch No<RequiredMark /></label>
              <input type="text" maxLength={30} value={newBatchNo} onChange={(e) => setNewBatchNo(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Expiry Date<RequiredMark /></label>
              <input type="date" value={newExpiryDate} onChange={(e) => setNewExpiryDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Cost Price (₹)<RequiredMark /></label>
              <input type="number" step="0.01" min="0" value={newCostPrice} onChange={(e) => setNewCostPrice(e.target.value)} className={inputCls} />
            </div>
          </div>
        )}

        <div>
          <label className={labelCls}>Quantity<RequiredMark /></label>
          <input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} className={inputCls} />
        </div>

        <div>
          <label className={labelCls}>Reason<RequiredMark /></label>
          <input type="text" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} placeholder="e.g. Physical count correction" />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex gap-2 pt-2">
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
