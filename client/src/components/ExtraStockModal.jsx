import { useEffect, useMemo, useState } from "react";
import { listProducts, getProductBatches } from "../api/products";
import { addExtraStock } from "../api/stock";
import RequiredMark from "./RequiredMark";
import RackInput from "./RackInput";
import { validPosition } from "../utils/rack";
import { todayLocal } from "../utils/date";
import { EXTRA_STOCK_REASONS } from "../utils/stock";

const NEW_BATCH = "__new__";

// Extra Stock Addition: add stock to an existing item without a purchase
// entry. Nothing here touches purchases, suppliers or invoices - the server
// only raises the item's stock and records the addition in its own history.
export default function ExtraStockModal({ onClose, onSaved }) {
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [product, setProduct] = useState("");
  const [batches, setBatches] = useState([]);
  const [batchChoice, setBatchChoice] = useState(NEW_BATCH);
  const [qty, setQty] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [reason, setReason] = useState("");
  const [remarks, setRemarks] = useState("");
  const [newBatchNo, setNewBatchNo] = useState("");
  const [newExpiryDate, setNewExpiryDate] = useState("");
  const [newCostPrice, setNewCostPrice] = useState("");
  const [rack, setRack] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listProducts().then(setProducts);
  }, []);

  useEffect(() => {
    setBatches([]);
    setBatchChoice(NEW_BATCH);
    if (!product) return;
    getProductBatches(product).then((data) => {
      setBatches(data);
      // Most additions top up the lot already on the shelf.
      const open = data.find((b) => b.qtyRemaining > 0);
      if (open) setBatchChoice(open._id);
    });
  }, [product]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => `${p.name} ${p.productCode || ""}`.toLowerCase().includes(q));
  }, [products, search]);

  const selected = products.find((p) => p._id === product);
  const isNewBatch = batchChoice === NEW_BATCH;
  const qtyOk = Number(qty) > 0 && Number.isInteger(Number(qty));
  const isValid = product && qtyOk && date && reason && (reason !== "Other" || remarks.trim());

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isValid || saving) return;
    setSaving(true);
    setError("");
    try {
      await addExtraStock({
        product,
        qty: Number(qty),
        date,
        reason,
        remarks: remarks.trim(),
        batchId: isNewBatch ? undefined : batchChoice,
        batchNo: isNewBatch ? newBatchNo.trim() : undefined,
        expiryDate: isNewBatch && newExpiryDate ? newExpiryDate : undefined,
        costPrice: isNewBatch && newCostPrice !== "" ? newCostPrice : undefined,
        rack: rack.trim(),
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
  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8">
      <form onSubmit={handleSubmit} className="w-full max-w-md space-y-3 rounded-2xl bg-surface p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-text">Extra Stock Addition</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-text" aria-label="Close">✕</button>
        </div>
        <p className="text-xs text-muted">Adds stock without a purchase entry. Purchases, suppliers and invoices are not changed.</p>

        <div>
          <label className={labelCls} htmlFor="extra-item">Item<RequiredMark /></label>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={inputCls}
            placeholder="Search by name or code"
            aria-label="Search items"
          />
          <select
            id="extra-item"
            value={product}
            onChange={(e) => {
              setProduct(e.target.value);
              setRack(validPosition(products.find((p) => p._id === e.target.value)?.rack));
            }}
            className={inputCls}
          >
            <option value="">Select item…</option>
            {shown.map((p) => (
              <option key={p._id} value={p._id}>{p.name} ({p.productCode})</option>
            ))}
          </select>
          {selected && <p className="mt-1 text-xs text-muted">Current stock: {selected.qty}</p>}
        </div>

        {product && (
          <div>
            <label className={labelCls} htmlFor="extra-batch">Batch</label>
            <select id="extra-batch" value={batchChoice} onChange={(e) => setBatchChoice(e.target.value)} className={inputCls}>
              {batches.map((b) => (
                <option key={b._id} value={b._id}>
                  {b.batchNo} — {b.qtyRemaining} in stock, expires {fmtDate(b.expiryDate)}
                </option>
              ))}
              <option value={NEW_BATCH}>+ New batch…</option>
            </select>
          </div>
        )}

        {product && isNewBatch && (
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-border p-3">
            <div className="col-span-2">
              <label className={labelCls}>Batch No</label>
              <input type="text" maxLength={30} value={newBatchNo} onChange={(e) => setNewBatchNo(e.target.value)} className={inputCls} placeholder="Auto if left blank" />
            </div>
            <div>
              <label className={labelCls}>Expiry Date</label>
              <input type="date" value={newExpiryDate} onChange={(e) => setNewExpiryDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Cost Price (₹)</label>
              <input type="number" step="0.01" min="0" value={newCostPrice} onChange={(e) => setNewCostPrice(e.target.value)} className={inputCls} placeholder="Latest cost" />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls} htmlFor="extra-qty">Quantity<RequiredMark /></label>
            <input id="extra-qty" type="number" min="1" step="1" value={qty} onChange={(e) => setQty(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="extra-date">Date<RequiredMark /></label>
            <input id="extra-date" type="date" max={todayLocal()} value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>
        </div>
        {qty !== "" && !qtyOk && <p className="text-xs text-danger">Enter a whole quantity greater than 0.</p>}

        <div>
          <label className={labelCls} htmlFor="extra-reason">Reason<RequiredMark /></label>
          <select id="extra-reason" value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls}>
            <option value="">Select reason…</option>
            {EXTRA_STOCK_REASONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls} htmlFor="extra-remarks">Remarks{reason === "Other" && <RequiredMark />}</label>
          <textarea id="extra-remarks" rows={2} maxLength={500} value={remarks} onChange={(e) => setRemarks(e.target.value)} className={inputCls} placeholder="Any notes about this addition" />
        </div>

        {product && (
          <RackInput
            id="extra-rack"
            value={rack}
            onChange={setRack}
            invalid={false}
            label="Rack (where this stock is shelved)"
            labelClassName={labelCls}
          />
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            disabled={!isValid || saving}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-primary-dark"
          >
            {saving ? "Saving…" : "Add Stock"}
          </button>
          <button type="button" onClick={onClose} className="rounded-lg px-5 py-2 text-sm font-semibold text-muted hover:bg-bg">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
