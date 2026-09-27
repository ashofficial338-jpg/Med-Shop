import { useEffect, useState } from "react";
import { createProduct, updateProduct, listCategories, enableLooseSelling } from "../api/products";
import { resolveAssetUrl } from "../api/client";
import { listVendors } from "../api/vendors";
import RequiredMark from "./RequiredMark";

const PACK_UNITS = ["Strip", "Bottle", "Box", "Tube", "Vial", "Jar", "Piece"];
const LOOSE_UNITS = ["Tablet", "Capsule", "ml", "Piece"];
const GST_VALUES = [0, 5, 12, 18, 28];
const STRENGTH_UNITS = ["mg", "mcg", "ml", "g"];

const emptyForm = {
  name: "",
  category: "",
  vendor: "",
  strengthValue: "",
  strengthUnit: "",
  packUnit: "Strip",
  unitsPerPack: "",
  looseUnitName: "",
  qtyPacks: "",
  qtyLooseExtra: "",
  packRate: "",
  gstPercent: "",
  hsnCode: "",
  batchNo: "",
  expiryDate: "",
  costPrice: "",
  lowStockThreshold: "10",
};

export default function ProductFormModal({ product, onClose, onSaved }) {
  const isEdit = Boolean(product);
  const [categories, setCategories] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(product?.image || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [showEnableLoose, setShowEnableLoose] = useState(false);
  const [enableUnitsPerPack, setEnableUnitsPerPack] = useState("");
  const [enableLooseUnitName, setEnableLooseUnitName] = useState("");
  const [enableError, setEnableError] = useState("");
  const [enabling, setEnabling] = useState(false);

  useEffect(() => {
    listCategories().then(setCategories);
    listVendors().then(setVendors);
  }, []);

  useEffect(() => {
    if (product) {
      setForm({
        name: product.name || "",
        category: product.category?._id || "",
        vendor: product.vendor?._id || "",
        strengthValue: product.strengthValue || "",
        strengthUnit: product.strengthUnit || "",
        packUnit: product.packUnit || "Strip",
        unitsPerPack: product.unitsPerPack || "",
        looseUnitName: product.looseUnitName || "",
        qtyPacks: "",
        qtyLooseExtra: "",
        packRate: product.packRate ?? "",
        gstPercent: product.gstPercent ?? "",
        hsnCode: product.hsnCode || "",
        batchNo: "",
        expiryDate: "",
        costPrice: "",
        lowStockThreshold: product.lowStockThreshold ?? "10",
      });
    }
  }, [product]);

  // Whether this can be sold loose is never chosen directly - it's implied
  // by whether a pack actually breaks into more than one unit. Every product
  // still arrives as whole packs either way.
  const hasLooseSplit = Number(form.unitsPerPack) > 1;

  const computedPerUnit =
    hasLooseSplit && Number(form.packRate) > 0
      ? (Number(form.packRate) / Number(form.unitsPerPack)).toFixed(2)
      : null;

  const set = (key) => (e) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setError("Image must be JPG, PNG or WEBP and under 2 MB.");
      return;
    }
    setError("");
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const isValid =
    form.name.trim().length > 0 &&
    form.category &&
    PACK_UNITS.includes(form.packUnit) &&
    GST_VALUES.includes(Number(form.gstPercent)) &&
    Number(form.packRate) > 0 &&
    (isEdit || !hasLooseSplit || LOOSE_UNITS.includes(form.looseUnitName)) &&
    (isEdit || (form.batchNo.trim().length > 0 && form.expiryDate && form.costPrice !== ""));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isValid || saving) return;
    setSaving(true);
    setError("");

    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => {
      if (isEdit && (k === "unitsPerPack" || k === "looseUnitName")) return; // locked after creation
      if (v !== "" && v !== undefined && v !== null) fd.append(k, v);
    });
    if (imageFile) fd.append("image", imageFile);

    try {
      const saved = isEdit ? await updateProduct(product._id, fd) : await createProduct(fd);
      onSaved(saved);
    } catch (err) {
      setError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleEnableLoose = async () => {
    const units = Number(enableUnitsPerPack);
    if (!(units > 1) || !LOOSE_UNITS.includes(enableLooseUnitName) || enabling) return;
    setEnabling(true);
    setEnableError("");
    try {
      const updated = await enableLooseSelling(product._id, { unitsPerPack: units, looseUnitName: enableLooseUnitName });
      onSaved(updated);
    } catch (err) {
      setEnableError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setEnabling(false);
    }
  };

  const inputCls =
    "mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none";
  const labelCls = "block text-sm font-medium text-text";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8">
      <form onSubmit={handleSubmit} className="w-full max-w-lg space-y-4 rounded-2xl bg-surface p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-text">
            {isEdit ? "Edit Product" : "Add Product"}
          </h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-text" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-bg">
            {imagePreview ? (
              <img src={resolveAssetUrl(imagePreview)} alt="Preview" className="h-full w-full object-cover" />
            ) : (
              <span className="text-2xl">💊</span>
            )}
          </div>
          <div>
            <label className="inline-block cursor-pointer rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-primary hover:bg-bg">
              Choose Image
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImageChange} className="hidden" />
            </label>
            <p className="mt-1 text-xs text-muted">JPG, PNG or WEBP, up to 2 MB</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={labelCls}>Product Name<RequiredMark /></label>
            <input type="text" maxLength={150} value={form.name} onChange={set("name")} className={inputCls} />
          </div>

          <div className="col-span-2">
            <label className={labelCls}>Category<RequiredMark /></label>
            <input
              type="text"
              list="category-options"
              value={form.category ? categories.find((c) => c._id === form.category)?.name || form.category : ""}
              onChange={(e) => {
                const match = categories.find((c) => c.name.toLowerCase() === e.target.value.toLowerCase());
                setForm((f) => ({ ...f, category: match ? match._id : e.target.value }));
              }}
              placeholder="Type to search or add a new category"
              className={inputCls}
            />
            <datalist id="category-options">
              {categories.map((c) => (
                <option key={c._id} value={c.name} />
              ))}
            </datalist>
          </div>

          <div className="col-span-2">
            <label className={labelCls}>Primary Vendor</label>
            <select value={form.vendor} onChange={set("vendor")} className={inputCls}>
              <option value="">—</option>
              {vendors.map((v) => (
                <option key={v._id} value={v._id}>{v.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls}>Strength Value</label>
            <input type="number" min="0" value={form.strengthValue} onChange={set("strengthValue")} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Strength Unit</label>
            <select value={form.strengthUnit} onChange={set("strengthUnit")} className={inputCls}>
              <option value="">—</option>
              {STRENGTH_UNITS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls}>Pack Unit<RequiredMark /></label>
            <select value={form.packUnit} onChange={set("packUnit")} className={inputCls}>
              {PACK_UNITS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Pack Rate (₹)<RequiredMark /></label>
            <input type="number" step="0.01" min="0.01" value={form.packRate} onChange={set("packRate")} className={inputCls} />
          </div>

          {/* Everything always arrives as whole packs - whether it CAN also be sold loose
              is just implied by how many units are in a pack, not a separate choice.
              Locked after creation since Product.qty is already stored in whatever unit
              this implies; changing it later would silently reinterpret existing stock. */}
          {!isEdit && (
            <>
              <div>
                <label className={labelCls}>Units per Pack</label>
                <input
                  type="number"
                  min="1"
                  placeholder="e.g. 15 (leave blank if sold as a whole pack only)"
                  value={form.unitsPerPack}
                  onChange={set("unitsPerPack")}
                  className={inputCls}
                />
              </div>
              {hasLooseSplit && (
                <div>
                  <label className={labelCls}>Loose Unit Name<RequiredMark /></label>
                  <select value={form.looseUnitName} onChange={set("looseUnitName")} className={inputCls}>
                    <option value="">—</option>
                    {LOOSE_UNITS.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
          {isEdit && hasLooseSplit && (
            <div className="col-span-2 text-sm text-muted">
              Sold as: whole {form.packUnit} or loose {form.looseUnitName} ({form.unitsPerPack} per {form.packUnit})
            </div>
          )}

          {/* A pack-only product can still be switched to also sell loose later -
              unlike the fields above, this goes through its own endpoint that
              rescales existing stock/batches into the new unit (see enable-loose
              in products.js), rather than silently reinterpreting them. */}
          {isEdit && !hasLooseSplit && (
            <div className="col-span-2 rounded-xl border border-border p-3">
              {!showEnableLoose ? (
                <button
                  type="button"
                  onClick={() => setShowEnableLoose(true)}
                  className="text-sm font-semibold text-primary hover:underline"
                >
                  + Also sell this loose, by the piece
                </button>
              ) : (
                <>
                  <p className="text-sm font-semibold text-text">Enable Loose Selling</p>
                  <p className="mt-0.5 text-xs text-muted">
                    One-time change - existing stock is automatically re-counted into the new unit.
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Units per {form.packUnit}<RequiredMark /></label>
                      <input
                        type="number"
                        min="2"
                        placeholder="e.g. 15"
                        value={enableUnitsPerPack}
                        onChange={(e) => setEnableUnitsPerPack(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Loose Unit Name<RequiredMark /></label>
                      <select value={enableLooseUnitName} onChange={(e) => setEnableLooseUnitName(e.target.value)} className={inputCls}>
                        <option value="">—</option>
                        {LOOSE_UNITS.map((u) => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {Number(enableUnitsPerPack) > 1 && (
                    <p className="mt-2 text-xs text-muted">
                      ≈ ₹{(Number(form.packRate) / Number(enableUnitsPerPack)).toFixed(2)} per {enableLooseUnitName || "unit"}
                    </p>
                  )}
                  {enableError && <p className="mt-2 text-sm text-danger">{enableError}</p>}
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={handleEnableLoose}
                      disabled={!(Number(enableUnitsPerPack) > 1) || !LOOSE_UNITS.includes(enableLooseUnitName) || enabling}
                      className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-primary-dark"
                    >
                      {enabling ? "Saving…" : "Enable"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowEnableLoose(false)}
                      className="rounded-lg px-3 py-1.5 text-xs font-semibold text-muted hover:bg-bg"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {hasLooseSplit && (
            <div className="col-span-2 rounded-lg bg-bg px-3 py-2 text-sm text-text">
              ≈ ₹{computedPerUnit ?? "—"} per {form.looseUnitName || "unit"}{" "}
              <span className="text-xs text-muted">(live: Pack Rate ÷ Units per Pack — this is what Checkout charges for a loose sale)</span>
            </div>
          )}

          <div>
            <label className={labelCls}>GST %<RequiredMark /></label>
            <select value={form.gstPercent} onChange={set("gstPercent")} className={inputCls}>
              <option value="">—</option>
              {GST_VALUES.map((g) => (
                <option key={g} value={g}>{g}%</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>HSN Code</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={8}
              value={form.hsnCode}
              onChange={(e) => set("hsnCode")({ target: { value: e.target.value.replace(/\D/g, "") } })}
              className={inputCls}
            />
          </div>

          <div className="col-span-2">
            <label className={labelCls}>Low Stock Alert Below</label>
            <input type="number" min="0" value={form.lowStockThreshold} onChange={set("lowStockThreshold")} className={inputCls} />
          </div>

          {!isEdit && (
            <div className="col-span-2 rounded-xl border border-border p-3">
              <p className="mb-2 text-sm font-semibold text-text">Opening Stock (first batch)</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Qty ({form.packUnit}s)</label>
                  <input type="number" min="0" value={form.qtyPacks} onChange={set("qtyPacks")} className={inputCls} />
                </div>
                {hasLooseSplit && (
                  <div>
                    <label className={labelCls}>+ Loose {form.looseUnitName || "units"}</label>
                    <input type="number" min="0" value={form.qtyLooseExtra} onChange={set("qtyLooseExtra")} className={inputCls} />
                  </div>
                )}
                <div>
                  <label className={labelCls}>Batch No<RequiredMark /></label>
                  <input type="text" maxLength={30} value={form.batchNo} onChange={set("batchNo")} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Expiry Date<RequiredMark /></label>
                  <input type="date" value={form.expiryDate} onChange={set("expiryDate")} className={inputCls} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Cost Price (₹, per pack)<RequiredMark /></label>
                  <input type="number" step="0.01" min="0" value={form.costPrice} onChange={set("costPrice")} className={inputCls} />
                </div>
              </div>
              <p className="mt-2 text-xs text-muted">
                Adding more stock later (new or repeat batches) is done from Vendors → New Purchase, or Stock Management → Adjust Stock.
              </p>
            </div>
          )}
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
