import { useState } from "react";
import { createCustomer, updateCustomer } from "../api/customers";
import { getErrorMessage } from "../api/client";

// Add or edit a customer. A name or a phone is enough.
export default function CustomerFormModal({ customer, onClose, onSaved }) {
  const [form, setForm] = useState({ name: customer?.name || "", phone: customer?.phone || "", email: customer?.email || "", address: customer?.address || "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: key === "phone" ? e.target.value.replace(/\D/g, "") : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (form.phone && form.phone.length !== 10) return setError("Enter a 10-digit phone number, or leave it blank.");
    if (!form.name.trim() && !form.phone) return setError("Enter the customer's name or phone number.");
    setSaving(true);
    setError("");
    try {
      const body = { name: form.name.trim(), phone: form.phone, email: form.email.trim(), address: form.address.trim() };
      onSaved(customer ? await updateCustomer(customer._id, body) : await createCustomer(body));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <form onSubmit={submit} className="w-full max-w-md space-y-3 rounded-2xl bg-surface p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-text">{customer ? "Edit Customer" : "Add Customer"}</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-text" aria-label="Close">✕</button>
        </div>
        {[
          ["name", "Name", "text", 100],
          ["phone", "Phone", "tel", 10],
          ["email", "Email", "email", 100],
          ["address", "Address", "text", 200],
        ].map(([key, label, type, max]) => (
          <label key={key} className="block text-sm font-medium text-text">
            {label}
            <input type={type} maxLength={max} value={form[key]} onChange={set(key)} autoFocus={key === "name"} className={inputCls} />
          </label>
        ))}
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <div className="flex gap-2 pt-2">
          <button type="submit" disabled={saving} className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50">
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
