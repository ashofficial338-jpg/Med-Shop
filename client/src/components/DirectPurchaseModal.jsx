import { useEffect, useState } from "react";
import { listProducts, listCategories } from "../api/products";
import { createDirectPurchase, listUnregisteredSuppliers } from "../api/purchases";
import RequiredMark from "./RequiredMark";
import RackInput from "./RackInput";
import PurchaseRateHint from "./PurchaseRateHint";
import { RACK_REQUIRED_MESSAGE, validPosition, isRackChoice } from "../utils/rack";

const PACK_UNITS = ["Strip", "Bottle", "Box", "Tube", "Vial", "Jar", "Piece"];
const LOOSE_UNITS = ["Tablet", "Capsule", "ml", "Piece"];
const GST_VALUES = [0, 5, 12, 18, 28];
// No supplier means nobody to owe - these purchases are always paid up front.
const PAYMENT_MODES = ["Cash", "UPI", "Bank Transfer", "Cheque", "Other"];

const emptyLine = {
  isNew: false,
  product: "",
  name: "",
  category: "",
  packUnit: "Strip",
  gstPercent: "12",
  unitsPerPack: "",
  looseUnitName: "",
  qtyPacks: "",
  costPrice: "",
  sellingPrice: "",
  batchNo: "",
  expiryDate: "",
  rack: "",
};

// Purchase from an unregistered supplier (typed in by name) or with no
// supplier at all. Each line is an existing product or a new one entered
// inline; a "new" product whose name already exists gets its stock added to
// that existing product - one master product, many suppliers.
export default function DirectPurchaseModal({ initialMode = "none", onClose, onSaved }) {
  const [mode, setMode] = useState(initialMode); // "unregistered" | "none"
  const [knownSuppliers, setKnownSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMode, setPaymentMode] = useState("Cash");
  const [lines, setLines] = useState([{ ...emptyLine }]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [rackMissing, setRackMissing] = useState(false);

  useEffect(() => {
    listProducts().then(setProducts).catch(() => {});
    listCategories().then(setCategories).catch(() => {});
    listUnregisteredSuppliers().then(setKnownSuppliers).catch(() => {});
  }, []);

  const productByName = (name) => {
    const n = name.trim().toLowerCase();
    return n ? products.find((p) => p.name.toLowerCase() === n) : null;
  };
  const applyExisting = (idx, product) => {
    setLines((ls) =>
      ls.map((l, i) =>
        i === idx ? { ...l, isNew: false, product: product._id, sellingPrice: String(product.packRate ?? ""), rack: validPosition(product.rack) || l.rack } : l
      )
    );
  };

  const productById = (id) => products.find((p) => p._id === id);

  // Typing a purchase price marks it as the user's own rate, so a looked-up
  // previous rate never overwrites it.
  const setLine = (idx, key, value) => {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, [key]: value, ...(key === "costPrice" ? { costTouched: true } : {}) } : l)));
  };

  // Pre-fill with the previous purchase rate unless a rate was typed already.
  const suggestCost = (idx, productId, rate) => {
    setLines((ls) => ls.map((l, i) => (i === idx && l.product === productId && !l.costTouched ? { ...l, costPrice: String(rate) } : l)));
  };

  // Picking an existing product pre-fills its current selling price and rack.
  const selectProduct = (idx, id) => {
    const p = productById(id);
    setLines((ls) =>
      ls.map((l, i) =>
        i === idx
          ? { ...l, product: id, costPrice: "", costTouched: false, sellingPrice: p ? String(p.packRate ?? "") : "", rack: validPosition(p?.rack) || l.rack }
          : l
      )
    );
  };

  const toggleNew = (idx, isNew) => {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...emptyLine, isNew, rack: l.rack } : l)));
  };

  const addLine = () => setLines((ls) => [...ls, { ...emptyLine }]);
  const removeLine = (idx) => setLines((ls) => ls.filter((_, i) => i !== idx));

  const gstOf = (line) => (line.isNew ? Number(line.gstPercent) || 0 : productById(line.product)?.gstPercent || 0);
  const packUnitOf = (line) => (line.isNew ? line.packUnit : productById(line.product)?.packUnit || "Packs");
  const lineAmount = (line) => (Number(line.qtyPacks) || 0) * (Number(line.costPrice) || 0);
  const lineGst = (line) => Number(((lineAmount(line) * gstOf(line)) / 100).toFixed(2));

  const subtotal = lines.reduce((sum, l) => sum + lineAmount(l), 0);
  const gstTotal = lines.reduce((sum, l) => sum + lineGst(l), 0);
  const total = subtotal + gstTotal;

  const lineValid = (l) => {
    const common =
      Number.isInteger(Number(l.qtyPacks)) && Number(l.qtyPacks) > 0 && l.costPrice !== "" && Number(l.costPrice) >= 0 && l.expiryDate;
    if (!common) return false;
    if (!l.isNew) return Boolean(l.product) && (l.sellingPrice === "" || Number(l.sellingPrice) > 0);
    const loose = Number(l.unitsPerPack) > 1;
    return (
      l.name.trim() &&
      l.category.trim() &&
      PACK_UNITS.includes(l.packUnit) &&
      GST_VALUES.includes(Number(l.gstPercent)) &&
      Number(l.sellingPrice) > 0 &&
      (!loose || LOOSE_UNITS.includes(l.looseUnitName))
    );
  };
  const isValid =
    Boolean(date) && lines.length > 0 && lines.every(lineValid) && (mode === "none" || supplierName.trim().length > 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isValid || saving) return;
    if (lines.some((l) => !isRackChoice(l.rack))) {
      setRackMissing(true);
      setError(RACK_REQUIRED_MESSAGE);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const saved = await createDirectPurchase({
        invoiceNo: invoiceNo.trim(),
        supplierName: mode === "unregistered" ? supplierName.trim() : "",
        date,
        paymentMode,
        items: lines.map((l) => ({
          ...(l.isNew
            ? {
                newProduct: {
                  name: l.name.trim(),
                  // An existing category's id, or a typed name (created on save).
                  category: categories.find((c) => c.name.toLowerCase() === l.category.trim().toLowerCase())?._id || l.category.trim(),
                  packUnit: l.packUnit,
                  gstPercent: Number(l.gstPercent),
                  unitsPerPack: Number(l.unitsPerPack) > 1 ? Number(l.unitsPerPack) : undefined,
                  looseUnitName: Number(l.unitsPerPack) > 1 ? l.looseUnitName : "",
                },
              }
            : { product: l.product }),
          qtyPacks: Number(l.qtyPacks),
          costPrice: Number(l.costPrice),
          sellingPrice: l.sellingPrice === "" ? undefined : Number(l.sellingPrice),
          batchNo: l.batchNo.trim(),
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
  const tabCls = (active) =>
    `rounded-md px-3 py-1 text-xs font-semibold ${active ? "bg-primary text-white" : "text-muted hover:text-text"}`;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8">
      <form onSubmit={handleSubmit} className="w-full max-w-2xl space-y-4 rounded-2xl bg-surface p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl font-semibold text-text">
              {mode === "unregistered" ? "Other / Unregistered Supplier" : "Purchase Without Supplier"}
            </h2>
            <p className="text-xs text-muted">Stock is added to the same product inventory. Paid in full at purchase.</p>
          </div>
          <button type="button" onClick={onClose} className="text-muted hover:text-text" aria-label="Close">✕</button>
        </div>

        <div className="inline-flex rounded-lg border border-border p-0.5">
          <button type="button" onClick={() => setMode("unregistered")} className={tabCls(mode === "unregistered")}>Unregistered supplier</button>
          <button type="button" onClick={() => setMode("none")} className={tabCls(mode === "none")}>No supplier</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {mode === "unregistered" && (
            <div className="col-span-2">
              <label className={labelCls}>Supplier Name<RequiredMark /></label>
              <input
                type="text"
                list="unregistered-suppliers"
                maxLength={100}
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder="e.g. City Medical Agencies"
                className={inputCls}
              />
              <datalist id="unregistered-suppliers">
                {knownSuppliers.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </div>
          )}
          <div>
            <label className={labelCls}>Date<RequiredMark /></label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Bill / Ref No (optional)</label>
            <input type="text" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="Auto-generated if blank" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Payment Mode</label>
            <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} className={inputCls}>
              {PAYMENT_MODES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>

        <datalist id="direct-purchase-categories">
          {categories.map((c) => (
            <option key={c._id} value={c.name} />
          ))}
        </datalist>

        <div className="space-y-3">
          {lines.map((line, idx) => (
            <div key={idx} className="rounded-xl border border-border p-3">
              <div className="mb-2 inline-flex rounded-lg border border-border p-0.5">
                <button type="button" onClick={() => toggleNew(idx, false)} className={tabCls(!line.isNew)}>Existing product</button>
                <button type="button" onClick={() => toggleNew(idx, true)} className={tabCls(line.isNew)}>New product</button>
              </div>

              {line.isNew ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="col-span-2">
                    <label className={labelCls}>Product Name<RequiredMark /></label>
                    <input type="text" maxLength={150} value={line.name} onChange={(e) => setLine(idx, "name", e.target.value)} className={inputCls} />
                    {productByName(line.name) && (
                      <p className="mt-1 text-xs text-warning">
                        {productByName(line.name).name} ({productByName(line.name).productCode}) already exists — stock will be added to it, not duplicated.{" "}
                        <button type="button" onClick={() => applyExisting(idx, productByName(line.name))} className="font-semibold text-primary hover:underline">
                          Use existing
                        </button>
                      </p>
                    )}
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>Category<RequiredMark /></label>
                    <input
                      type="text"
                      list="direct-purchase-categories"
                      value={line.category}
                      onChange={(e) => setLine(idx, "category", e.target.value)}
                      placeholder="Type to search or add new"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Pack Unit<RequiredMark /></label>
                    <select value={line.packUnit} onChange={(e) => setLine(idx, "packUnit", e.target.value)} className={inputCls}>
                      {PACK_UNITS.map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>GST %<RequiredMark /></label>
                    <select value={line.gstPercent} onChange={(e) => setLine(idx, "gstPercent", e.target.value)} className={inputCls}>
                      {GST_VALUES.map((g) => (
                        <option key={g} value={String(g)}>{g}%</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Units per {line.packUnit} (optional)</label>
                    <input type="number" min="1" value={line.unitsPerPack} onChange={(e) => setLine(idx, "unitsPerPack", e.target.value)} placeholder="e.g. 10" className={inputCls} />
                  </div>
                  {Number(line.unitsPerPack) > 1 && (
                    <div>
                      <label className={labelCls}>Loose Unit<RequiredMark /></label>
                      <select value={line.looseUnitName} onChange={(e) => setLine(idx, "looseUnitName", e.target.value)} className={inputCls}>
                        <option value="">Select…</option>
                        {LOOSE_UNITS.map((u) => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <label className={labelCls}>Product<RequiredMark /></label>
                  <select value={line.product} onChange={(e) => selectProduct(idx, e.target.value)} className={inputCls}>
                    <option value="">Select…</option>
                    {products.map((p) => (
                      <option key={p._id} value={p._id}>{p.name} ({p.productCode})</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                <div>
                  <label className={labelCls}>Qty ({packUnitOf(line)})<RequiredMark /></label>
                  <input type="number" min="1" step="1" value={line.qtyPacks} onChange={(e) => setLine(idx, "qtyPacks", e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Purchase Price<RequiredMark /></label>
                  <input type="number" min="0" step="0.01" value={line.costPrice} onChange={(e) => setLine(idx, "costPrice", e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Selling Price{line.isNew && <RequiredMark />}</label>
                  <input type="number" min="0.01" step="0.01" value={line.sellingPrice} onChange={(e) => setLine(idx, "sellingPrice", e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Expiry Date<RequiredMark /></label>
                  <input type="date" value={line.expiryDate} onChange={(e) => setLine(idx, "expiryDate", e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Batch No (optional)</label>
                  <input type="text" value={line.batchNo} onChange={(e) => setLine(idx, "batchNo", e.target.value)} placeholder="Uses bill no" className={inputCls} />
                </div>
                <RackInput
                  id={`direct-purchase-rack-${idx}`}
                  className="col-span-2"
                  value={line.rack}
                  onChange={(v) => setLine(idx, "rack", v)}
                  invalid={rackMissing && !isRackChoice(line.rack)}
                  labelClassName={labelCls}
                />
              </div>
              {!line.isNew && (
                <PurchaseRateHint
                  productId={line.product}
                  supplierName={mode === "unregistered" ? supplierName : ""}
                  noSupplier={mode === "none"}
                  costPrice={line.costPrice}
                  onSuggest={(rate) => suggestCost(idx, line.product, rate)}
                />
              )}
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

        <div className="border-t border-border pt-3 text-right text-sm text-text">
          <p>Subtotal: ₹{subtotal.toFixed(2)}</p>
          <p>GST: ₹{gstTotal.toFixed(2)}</p>
          <p className="font-semibold">Total (paid by {paymentMode}): ₹{total.toFixed(2)}</p>
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
