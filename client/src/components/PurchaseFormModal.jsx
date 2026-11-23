import { useEffect, useState } from "react";
import { listProducts } from "../api/products";
import { createPurchase } from "../api/purchases";
import RequiredMark from "./RequiredMark";
import ProductPicker from "./ProductPicker";
import RackInput from "./RackInput";
import PurchaseRateHint from "./PurchaseRateHint";
import { validPosition } from "../utils/rack";
import { ScannedBillBanner, ScannedLineHint } from "./ScannedBillNotes";

// `name` is what's typed in the product box. A name not in the Product List
// is added to it on Save, with the new-product GST / HSN / unit below.
const emptyLine = { product: "", name: "", newGst: "0", newHsn: "", newUnit: "Strip", qtyPacks: "", costPrice: "", batchNo: "", expiryDate: "", rack: "" };
const PACK_UNITS = ["Strip", "Bottle", "Box", "Tube", "Vial", "Jar", "Piece"];

// `initialData` (optional) pre-fills the form from a scanned bill - see
// InvoiceUploadModal. Without it the form starts empty as before.
export default function PurchaseFormModal({ vendor, onClose, onSaved, initialData }) {
  const [products, setProducts] = useState([]);
  const [invoiceNo, setInvoiceNo] = useState(initialData?.invoiceNo || "");
  const [date, setDate] = useState(initialData?.date || new Date().toISOString().slice(0, 10));
  const [tdsAmount, setTdsAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState("Credit");
  const [amountPaid, setAmountPaid] = useState("");
  const [lines, setLines] = useState(() =>
    initialData?.lines?.length
      ? initialData.lines.map((l) => ({ ...emptyLine, name: l.product ? "" : l.scan?.name || "", newGst: l.scan?.gstPercent != null ? String(l.scan.gstPercent) : "0", ...l }))
      : [{ ...emptyLine }]
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listProducts().then(setProducts);
  }, []);

  const productById = (id) => products.find((p) => p._id === id);
  const isVendorProduct = (p) => p.vendor?._id === vendor._id || p.vendor === vendor._id;
  const lineName = (line) => line.name || productById(line.product)?.name || "";
  const isNewLine = (line) => !line.product && line.name.trim() !== "";

  // This vendor's own products are listed first in the product box (see
  // isVendorProduct) since a purchase is almost always against them.

  // Typing a purchase price marks it as the user's own rate, so a looked-up
  // previous rate never overwrites it.
  const setLine = (idx, key, value) => {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, [key]: value, ...(key === "costPrice" ? { costTouched: true } : {}) } : l)));
  };

  // Pre-fill with the previous purchase rate unless a rate was typed already.
  const suggestCost = (idx, productId, rate) => {
    setLines((ls) => ls.map((l, i) => (i === idx && l.product === productId && !l.costTouched ? { ...l, costPrice: String(rate) } : l)));
  };

  // Picking a product pre-fills the rack it already lives on. A rate read
  // off a scanned bill is kept rather than cleared.
  const selectProduct = (idx, product) => {
    setLines((ls) =>
      ls.map((l, i) => {
        if (i !== idx) return l;
        const keepRate = Boolean(l.scan) && l.costPrice !== "";
        return { ...l, product: product._id, name: product.name, costPrice: keepRate ? l.costPrice : "", costTouched: keepRate, rack: validPosition(product.rack) || l.rack };
      })
    );
  };
  // Typing a name un-links any picked product (a new name = a new product).
  const typeProductName = (idx, name) => setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, name, product: "" } : l)));

  const addLine = () => setLines((ls) => [...ls, { ...emptyLine }]);
  const removeLine = (idx) => setLines((ls) => ls.filter((_, i) => i !== idx));

  const lineAmount = (line) => {
    const qty = Number(line.qtyPacks) || 0;
    const cost = Number(line.costPrice) || 0;
    return qty * cost;
  };
  const gstOf = (line) => (line.product ? productById(line.product)?.gstPercent || 0 : Number(line.newGst) || 0);
  const lineGst = (line) => Number(((lineAmount(line) * gstOf(line)) / 100).toFixed(2));

  const subtotal = lines.reduce((sum, l) => sum + lineAmount(l), 0);
  const gstTotal = lines.reduce((sum, l) => sum + lineGst(l), 0);
  const tds = Number(tdsAmount) || 0;
  const total = subtotal + gstTotal;
  const isCredit = paymentMode === "Credit";
  const paidNow = isCredit ? Math.min(Math.max(Number(amountPaid) || 0, 0), total) : total;
  const balancePayable = Number((total - paidNow).toFixed(2));

  const validLines = lines.filter(
    (l) => (l.product || isNewLine(l)) && Number(l.qtyPacks) > 0 && (l.costPrice === "" || Number(l.costPrice) >= 0)
  );
  // Only a product and quantity per line are needed; invoice no, batch no,
  // expiry, rack and rate are optional (auto invoice / batch numbers).
  const isValid = validLines.length === lines.length && lines.length > 0;

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
        paymentMode,
        amountPaid: paidNow,
        items: lines.map((l) => ({
          product: l.product || undefined,
          newProduct: l.product ? undefined : { name: l.name.trim(), gstPercent: Number(l.newGst) || 0, hsnCode: l.newHsn.trim(), unit: l.newUnit },
          qtyPacks: Number(l.qtyPacks),
          costPrice: Number(l.costPrice),
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

        <ScannedBillBanner scan={initialData} computedTotal={total} />

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
                <div className="col-span-2">
                  <label className={labelCls}>Product<RequiredMark /></label>
                  <ProductPicker
                    value={lineName(line)}
                    productId={line.product}
                    products={products}
                    preferred={isVendorProduct}
                    className={inputCls}
                    onChange={(name) => typeProductName(idx, name)}
                    onPick={(p) => selectProduct(idx, p)}
                  />
                </div>
                <div>
                  <label className={labelCls}>Qty ({line.product ? productById(line.product)?.packUnit || "Packs" : isNewLine(line) ? line.newUnit : "Packs"})<RequiredMark /></label>
                  <input type="number" min="1" value={line.qtyPacks} onChange={(e) => setLine(idx, "qtyPacks", e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Purchase Rate<RequiredMark /></label>
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
                <RackInput
                  id={`purchase-rack-${idx}`}
                  className="col-span-2"
                  value={line.rack}
                  onChange={(v) => setLine(idx, "rack", v)}
                  invalid={false}
                  labelClassName={labelCls}
                />
              </div>
              {isNewLine(line) && (
                <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg bg-secondary-soft/60 p-2">
                  <div>
                    <label className={labelCls}>New product GST</label>
                    <select value={line.newGst} onChange={(e) => setLine(idx, "newGst", e.target.value)} className={inputCls}>
                      {[0, 5, 12, 18, 28].map((g) => (
                        <option key={g} value={g}>{g}%</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>HSN Code</label>
                    <input type="text" maxLength={20} value={line.newHsn} onChange={(e) => setLine(idx, "newHsn", e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Unit</label>
                    <select value={line.newUnit} onChange={(e) => setLine(idx, "newUnit", e.target.value)} className={inputCls}>
                      {PACK_UNITS.map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
              <PurchaseRateHint
                productId={line.product}
                vendorId={vendor._id}
                costPrice={line.costPrice}
                onSuggest={(rate) => suggestCost(idx, line.product, rate)}
              />
              <ScannedLineHint line={line} productGst={line.product ? productById(line.product)?.gstPercent : undefined} />
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
          <div className="space-y-3">
            <div>
              <label className={labelCls}>TDS Amount (optional)</label>
              <input type="number" min="0" step="0.01" value={tdsAmount} onChange={(e) => setTdsAmount(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Payment Mode</label>
              <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} className={inputCls}>
                <option value="Credit">Credit</option>
                <option value="Cash">Cash</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="Cheque">Cheque</option>
                <option value="UPI">UPI</option>
                <option value="Other">Other</option>
              </select>
            </div>
            {isCredit && (
              <div>
                <label className={labelCls}>Amount Paid Now (optional)</label>
                <input type="number" min="0" max={total} step="0.01" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} className={inputCls} />
              </div>
            )}
          </div>
          <div className="text-right text-sm text-text">
            <p>Subtotal: ₹{subtotal.toFixed(2)}</p>
            <p>GST: ₹{gstTotal.toFixed(2)}</p>
            <p className="text-muted">TDS (tracked separately): ₹{tds.toFixed(2)}</p>
            <p className="font-semibold">Total: ₹{total.toFixed(2)}</p>
            {isCredit && (
              <>
                <p className="text-muted">Paid Now: ₹{paidNow.toFixed(2)}</p>
                <p className="font-semibold text-danger">Balance Payable: ₹{balancePayable.toFixed(2)}</p>
              </>
            )}
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
