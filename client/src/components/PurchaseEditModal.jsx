import { useEffect, useState } from "react";
import { listProducts } from "../api/products";
import { listVendors } from "../api/vendors";
import { getPurchase, updatePurchase } from "../api/purchases";
import RackInput from "./RackInput";

const DIRECT_MODES = ["Cash", "UPI", "Bank Transfer", "Cheque", "Other"];
const emptyLine = { product: "", qtyPacks: "", costPrice: "", batchNo: "", expiryDate: "", rack: "" };
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");

// Corrects a saved purchase (supplier or direct). Stock is reconciled on the
// server: each lot goes up or down by the difference, and a quantity can't be
// cut below what has already been sold from it.
export default function PurchaseEditModal({ purchaseId, onClose, onSaved }) {
  const [purchase, setPurchase] = useState(null);
  const [products, setProducts] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [vendor, setVendor] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [date, setDate] = useState("");
  const [tdsAmount, setTdsAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState("Cash");
  const [amountPaid, setAmountPaid] = useState("");
  const [lines, setLines] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([getPurchase(purchaseId), listProducts(), listVendors()])
      .then(([p, prods, vends]) => {
        setPurchase(p);
        setProducts(prods);
        setVendors(vends);
        setVendor(p.vendor?._id || "");
        setSupplierName(p.supplierName || "");
        setInvoiceNo(p.invoiceNo);
        setDate(day(p.date));
        setTdsAmount(p.tdsAmount ? String(p.tdsAmount) : "");
        setPaymentMode(p.paymentMode);
        setAmountPaid(p.paidAtPurchase ? String(p.paidAtPurchase) : "");
        setLines(
          p.items.map((i) => ({
            product: i.product?._id || i.product,
            productName: i.product?.name,
            qtyPacks: String(i.qtyPacks),
            costPrice: String(i.costPrice),
            batchNo: i.batchNo || "",
            expiryDate: day(i.expiryDate),
            rack: i.rack || "",
          }))
        );
      })
      .catch((err) => setError(err.response?.data?.message || "Could not load this purchase."));
  }, [purchaseId]);

  const isDirect = purchase && !purchase.vendor;
  const paidLater = purchase?.paidLater || 0;
  const productById = (id) => products.find((p) => p._id === id);
  // Inactive products still on this purchase stay selectable.
  const choices = [
    ...products,
    ...lines.filter((l) => l.product && !productById(l.product)).map((l) => ({ _id: l.product, name: l.productName || "Product", productCode: "inactive" })),
  ];

  const setLine = (idx, key, value) => setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, [key]: value } : l)));
  const lineAmount = (l) => (Number(l.qtyPacks) || 0) * (Number(l.costPrice) || 0);
  const lineGst = (l) => Number(((lineAmount(l) * (productById(l.product)?.gstPercent || 0)) / 100).toFixed(2));
  const subtotal = lines.reduce((s, l) => s + lineAmount(l), 0);
  const gstTotal = lines.reduce((s, l) => s + lineGst(l), 0);
  const total = subtotal + gstTotal;
  const isCredit = paymentMode === "Credit";
  const paidNow = isCredit ? Math.max(Number(amountPaid) || 0, 0) : total;
  const balance = isCredit ? Number((total - paidLater - paidNow).toFixed(2)) : 0;

  const isValid =
    lines.length > 0 &&
    lines.every((l) => l.product && Number(l.qtyPacks) > 0 && Number.isInteger(Number(l.qtyPacks)) && (l.costPrice === "" || Number(l.costPrice) >= 0));

  const submit = async (e) => {
    e.preventDefault();
    if (!isValid || saving) return;
    setSaving(true);
    setError("");
    try {
      const saved = await updatePurchase(purchaseId, {
        ...(isDirect ? { supplierName } : { vendor, tdsAmount: Number(tdsAmount) || 0 }),
        invoiceNo,
        date,
        paymentMode,
        amountPaid: isCredit ? paidNow : undefined,
        items: lines.map((l) => ({
          product: l.product,
          qtyPacks: Number(l.qtyPacks),
          costPrice: l.costPrice,
          batchNo: l.batchNo,
          expiryDate: l.expiryDate,
          rack: l.rack.trim(),
        })),
      });
      onSaved(saved);
    } catch (err) {
      setError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text focus:border-primary focus:outline-none disabled:opacity-60";
  const labelCls = "block text-xs font-medium text-muted";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8">
      <form onSubmit={submit} className="w-full max-w-2xl space-y-4 rounded-2xl bg-surface p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-text">Edit Purchase{purchase ? ` — ${purchase.invoiceNo}` : ""}</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-text" aria-label="Close">✕</button>
        </div>

        {!purchase && !error && <p className="text-sm text-muted">Loading…</p>}

        {purchase && (
          <>
            <p className="rounded-lg bg-bg px-3 py-2 text-xs text-muted">
              Stock is adjusted by the difference. A quantity can't go below what has already been sold from that batch.
            </p>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <label className={labelCls}>{isDirect ? "Supplier name (optional)" : "Supplier"}</label>
                {isDirect ? (
                  <input type="text" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="No supplier" className={inputCls} />
                ) : (
                  <select value={vendor} onChange={(e) => setVendor(e.target.value)} disabled={paidLater > 0} className={inputCls}>
                    {vendors.filter((v) => v.isActive !== false || v._id === vendor).map((v) => (
                      <option key={v._id} value={v._id}>{v.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className={labelCls}>Invoice No</label>
                <input type="text" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
              </div>
            </div>

            <div className="space-y-3">
              {lines.map((line, idx) => (
                <div key={idx} className="rounded-xl border border-border p-3">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <div className="col-span-2 sm:col-span-1">
                      <label className={labelCls}>Product</label>
                      <select value={line.product} onChange={(e) => setLine(idx, "product", e.target.value)} className={inputCls}>
                        <option value="">Select…</option>
                        {choices.map((p) => (
                          <option key={p._id} value={p._id}>{p.name} ({p.productCode})</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Qty ({productById(line.product)?.packUnit || "Packs"})</label>
                      <input type="number" min="1" value={line.qtyPacks} onChange={(e) => setLine(idx, "qtyPacks", e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Purchase Rate</label>
                      <input type="number" min="0" step="0.01" value={line.costPrice} onChange={(e) => setLine(idx, "costPrice", e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Batch No</label>
                      <input type="text" value={line.batchNo} onChange={(e) => setLine(idx, "batchNo", e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Expiry Date</label>
                      <input type="date" value={line.expiryDate} onChange={(e) => setLine(idx, "expiryDate", e.target.value)} className={inputCls} />
                    </div>
                    <RackInput
                      id={`edit-purchase-rack-${idx}`}
                      className="col-span-2"
                      value={line.rack}
                      onChange={(v) => setLine(idx, "rack", v)}
                      invalid={false}
                      labelClassName={labelCls}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted">
                    <span>Line: ₹{lineAmount(line).toFixed(2)} + GST ₹{lineGst(line).toFixed(2)}</span>
                    {lines.length > 1 && (
                      <button type="button" onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))} className="text-danger hover:underline">
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <button type="button" onClick={() => setLines((ls) => [...ls, { ...emptyLine }])} className="text-sm font-semibold text-primary hover:underline">
              + Add Line
            </button>

            <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
              <div className="space-y-3">
                {!isDirect && (
                  <div>
                    <label className={labelCls}>TDS Amount (optional)</label>
                    <input type="number" min="0" step="0.01" value={tdsAmount} onChange={(e) => setTdsAmount(e.target.value)} className={inputCls} />
                  </div>
                )}
                <div>
                  <label className={labelCls}>Payment Mode</label>
                  <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} disabled={paidLater > 0} className={inputCls}>
                    {!isDirect && <option value="Credit">Credit</option>}
                    {DIRECT_MODES.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                {isCredit && (
                  <div>
                    <label className={labelCls}>Amount Paid at Purchase (optional)</label>
                    <input type="number" min="0" step="0.01" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} className={inputCls} />
                  </div>
                )}
                {paidLater > 0 && (
                  <p className="text-xs text-muted">
                    ₹{paidLater.toFixed(2)} was paid later from the supplier ledger, so the supplier and payment mode stay as they are.
                  </p>
                )}
              </div>
              <div className="text-right text-sm text-text">
                <p>Subtotal: ₹{subtotal.toFixed(2)}</p>
                <p>GST: ₹{gstTotal.toFixed(2)}</p>
                <p className="font-semibold">Total: ₹{total.toFixed(2)}</p>
                {isCredit && (
                  <>
                    {paidLater > 0 && <p className="text-muted">Paid later: ₹{paidLater.toFixed(2)}</p>}
                    <p className="text-muted">Paid at purchase: ₹{paidNow.toFixed(2)}</p>
                    <p className="font-semibold text-danger">
                      {balance < 0 ? `Paid ₹${(-balance).toFixed(2)} more than the total` : `Balance Payable: ₹${balance.toFixed(2)}`}
                    </p>
                  </>
                )}
              </div>
            </div>
          </>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={!purchase || !isValid || saving}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-primary-dark"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
          <button type="button" onClick={onClose} className="rounded-lg px-5 py-2 text-sm font-semibold text-muted hover:bg-bg">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
