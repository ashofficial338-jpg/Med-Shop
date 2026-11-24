import ProductPicker from "../ProductPicker";
import PurchaseRateHint from "../PurchaseRateHint";
import RackInput from "../RackInput";
import { ScannedLineHint } from "../ScannedBillNotes";
import { GST_VALUES, LOOSE_UNITS, PACK_UNITS, isNewProduct, lineFigures } from "../../utils/purchaseLine";

// One product on a purchase. Product and quantity are all that's needed; the
// rate fills itself in from the last purchase, the rest is there when the
// supplier's bill has it. A name that isn't in the Product List yet shows the
// few details needed to add it - there is no separate trip to Products.
export default function PurchaseLine({ line, index, product, products, categories, vendorId, supplierName, preferred, onChange, onPick, onTypeName, onSuggestRate, onRemove, inputCls, labelCls }) {
  const set = (key) => (e) => onChange({ [key]: e.target.value });
  const isNew = isNewProduct(line);
  const empty = !line.product && !line.name.trim();
  const f = lineFigures(line, product);
  const unit = product?.packUnit || (isNew ? line.packUnit : "Packs");
  const id = (k) => `purchase-${index}-${k}`;

  return (
    <li className="p-3 sm:p-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-[minmax(200px,2.2fr)_.7fr_.9fr_.7fr_.9fr_1fr_1.1fr_auto]">
        <div className="col-span-2 sm:col-span-4 xl:col-span-1">
          <label className={labelCls}>Product</label>
          <ProductPicker
            value={line.name || product?.name || ""}
            productId={line.product}
            products={products}
            preferred={preferred}
            className={inputCls}
            onChange={onTypeName}
            onPick={onPick}
          />
        </div>
        <div>
          <label htmlFor={id("qty")} className={labelCls}>Qty ({unit})</label>
          <input id={id("qty")} type="number" min="1" step="1" value={line.qtyPacks} onChange={set("qtyPacks")} className={inputCls} />
        </div>
        <div>
          <label htmlFor={id("rate")} className={labelCls}>Purchase rate</label>
          <input id={id("rate")} type="number" min="0" step="0.01" value={line.costPrice} onChange={(e) => onChange({ costPrice: e.target.value, costTouched: true })} className={inputCls} />
        </div>
        <div>
          <label htmlFor={id("disc")} className={labelCls}>Disc %</label>
          <input id={id("disc")} type="number" min="0" max="100" step="0.01" value={line.discountPercent} onChange={set("discountPercent")} placeholder="0" className={inputCls} />
        </div>
        <div>
          <label htmlFor={id("sell")} className={labelCls}>Selling price</label>
          <input id={id("sell")} type="number" min="0" step="0.01" value={line.sellingPrice} onChange={(e) => onChange({ sellingPrice: e.target.value, sellTouched: true })} className={inputCls} />
        </div>
        <div>
          <label htmlFor={id("batch")} className={labelCls}>Batch no</label>
          <input id={id("batch")} type="text" maxLength={30} value={line.batchNo} onChange={set("batchNo")} placeholder="Invoice no" className={inputCls} />
        </div>
        <div>
          <label htmlFor={id("exp")} className={labelCls}>Expiry date</label>
          <input id={id("exp")} type="date" value={line.expiryDate} onChange={set("expiryDate")} className={inputCls} />
        </div>
        <div className="col-span-2 flex items-end justify-between gap-2 sm:col-span-1 xl:justify-end">
          <p className="pb-1.5 text-right text-sm font-semibold tabular-nums text-text xl:min-w-[84px]" title="Amount with GST, after discount">
            ₹{(f.amount + f.gst).toFixed(2)}
          </p>
          <button type="button" tabIndex={-1} onClick={onRemove} aria-label="Remove this line" className={`rounded-lg px-2 py-1.5 text-muted hover:bg-danger/10 hover:text-danger ${empty ? "invisible" : ""}`}>
            ✕
          </button>
        </div>
      </div>

      {isNew && (
        <div className="mt-2 rounded-xl bg-secondary-soft/60 p-3">
          <p className="mb-2 text-xs font-semibold text-secondary-dark">New product details – check the GST and unit</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <div>
              <label htmlFor={id("gst")} className={labelCls}>GST</label>
              <select id={id("gst")} value={line.gst} onChange={set("gst")} className={inputCls}>
                {GST_VALUES.map((g) => (
                  <option key={g} value={String(g)}>{g}%</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={id("unit")} className={labelCls}>Unit</label>
              <select id={id("unit")} value={line.packUnit} onChange={set("packUnit")} className={inputCls}>
                {PACK_UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={id("upp")} className={labelCls}>Units in a {line.packUnit}</label>
              <input id={id("upp")} type="number" min="1" step="1" value={line.unitsPerPack} onChange={set("unitsPerPack")} placeholder="e.g. 10" className={inputCls} />
            </div>
            {Number(line.unitsPerPack) > 1 && (
              <div>
                <label htmlFor={id("loose")} className={labelCls}>Sold loose as</label>
                <select id={id("loose")} value={line.looseUnitName} onChange={set("looseUnitName")} className={inputCls}>
                  {LOOSE_UNITS.map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor={id("cat")} className={labelCls}>Category</label>
              <input id={id("cat")} type="text" list="purchase-categories" value={line.category} onChange={set("category")} placeholder="Optional" className={inputCls} />
            </div>
            <div>
              <label htmlFor={id("hsn")} className={labelCls}>HSN code</label>
              <input id={id("hsn")} type="text" maxLength={20} value={line.hsn} onChange={set("hsn")} placeholder="Optional" className={inputCls} />
            </div>
          </div>
          {categories.length > 0 && (
            <datalist id="purchase-categories">
              {categories.map((c) => (
                <option key={c._id} value={c.name} />
              ))}
            </datalist>
          )}
        </div>
      )}

      {!empty && (
        <>
          <PurchaseRateHint productId={line.product} vendorId={vendorId} supplierName={supplierName} noSupplier={!vendorId && !supplierName} costPrice={line.costPrice} onSuggest={onSuggestRate} />
          <ScannedLineHint line={line} productGst={product?.gstPercent} />
          <div className="mt-2 flex flex-wrap items-end justify-between gap-2 text-xs text-muted">
            <span className="tabular-nums">
              ₹{f.gross.toFixed(2)}
              {f.discount > 0 && ` − discount ₹${f.discount.toFixed(2)}`} + GST {f.gstPercent}% ₹{f.gst.toFixed(2)}
              {f.margin !== null && <span className={f.margin < 0 ? "font-semibold text-danger" : ""}> · margin {f.margin.toFixed(1)}%</span>}
            </span>
            {!line.showRack && (
              <button type="button" tabIndex={-1} onClick={() => onChange({ showRack: true })} className="font-semibold text-primary hover:underline">
                📍 Rack: {line.rack && line.rack !== "NONE" ? line.rack : "none"} – change
              </button>
            )}
          </div>
          {line.showRack && <RackInput id={id("rack")} className="mt-2 max-w-md" value={line.rack} onChange={(rack) => onChange({ rack })} invalid={false} labelClassName={labelCls} />}
        </>
      )}
    </li>
  );
}
