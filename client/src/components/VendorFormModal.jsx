import { useState } from "react";
import { createVendor, updateVendor } from "../api/vendors";
import RequiredMark from "./RequiredMark";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function VendorFormModal({ vendor, onClose, onSaved }) {
  const isEdit = Boolean(vendor);
  const [form, setForm] = useState({
    name: vendor?.name || "",
    contactPerson: vendor?.contactPerson || "",
    phone: vendor?.phone || "",
    email: vendor?.email || "",
    address: vendor?.address || "",
    gstNumber: vendor?.gstNumber || "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const isValid =
    form.name.trim().length > 0 &&
    /^\d{10}$/.test(form.phone) &&
    form.gstNumber.trim().length === 15 &&
    (!form.email || EMAIL_RE.test(form.email));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isValid || saving) return;
    setSaving(true);
    setError("");
    try {
      const saved = isEdit ? await updateVendor(vendor._id, form) : await createVendor(form);
      onSaved(saved);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-md space-y-3 rounded-2xl bg-surface p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-text">{isEdit ? "Edit Vendor" : "Add Vendor"}</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-text" aria-label="Close">✕</button>
        </div>

        <div>
          <label className={labelCls}>Vendor Name<RequiredMark /></label>
          <input type="text" maxLength={150} value={form.name} onChange={set("name")} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Contact Person</label>
          <input type="text" value={form.contactPerson} onChange={set("contactPerson")} className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Phone<RequiredMark /></label>
            <input
              type="tel"
              maxLength={10}
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value.replace(/\D/g, "") }))}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Email</label>
            <input type="email" value={form.email} onChange={set("email")} className={inputCls} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Address</label>
          <input type="text" value={form.address} onChange={set("address")} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>GSTIN<RequiredMark /></label>
          <input
            type="text"
            maxLength={15}
            value={form.gstNumber}
            onChange={(e) => setForm((f) => ({ ...f, gstNumber: e.target.value.toUpperCase() }))}
            className={inputCls}
          />
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
