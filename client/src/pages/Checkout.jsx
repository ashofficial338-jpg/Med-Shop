import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import CustomerPicker from "../components/CustomerPicker";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";
import { createSale } from "../api/sales";
import RequiredMark from "../components/RequiredMark";

export default function Checkout() {
  const { lines, updateQty, removeLine, clearCart, lineTotal } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user.role === "admin";

  const [customer, setCustomer] = useState(null);
  const [discount, setDiscount] = useState("");
  const [paymentMode, setPaymentMode] = useState("Cash");
  const [error, setError] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [needsOverride, setNeedsOverride] = useState(false);
  const [saving, setSaving] = useState(false);

  if (lines.length === 0) {
    return <Navigate to="/products" replace />;
  }

  const lineGst = (line) => Number(((lineTotal(line) * line.product.gstPercent) / 100).toFixed(2));

  const subtotal = lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const gstTotal = lines.reduce((sum, l) => sum + lineGst(l), 0);
  const appliedDiscount = isAdmin ? Number(discount) || 0 : 0;
  const total = subtotal + gstTotal - appliedDiscount;

  const submit = async (withOverride = false) => {
    setSaving(true);
    setError("");
    try {
      const sale = await createSale({
        customer: customer?._id || null,
        paymentMode,
        discount: appliedDiscount,
        items: lines.map((l) => ({ product: l.product._id, unitType: l.unitType, qty: l.qty })),
        ...(withOverride ? { overrideExpiredReason: overrideReason } : {}),
      });
      clearCart();
      navigate(`/bills/${sale._id}`, { replace: true });
    } catch (err) {
      const message = err.response?.data?.message || "Something went wrong. Please try again.";
      setError(message);
      setNeedsOverride(isAdmin && message === "This batch has expired and cannot be sold.");
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none";

  return (
    <Layout>
      <h1 className="font-display text-2xl font-semibold text-text">Checkout</h1>

      <div className="mt-4 space-y-2">
        {lines.map((line) => (
          <div key={`${line.product._id}:${line.unitType}`} className="flex items-center justify-between gap-2 rounded-xl bg-surface p-3 shadow-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-text">{line.product.name}</p>
              <p className="text-xs text-muted">
                ₹{(line.unitType === "pack" ? line.product.packRate : line.product.looseRate).toFixed(2)} / {line.unitType === "pack" ? line.product.packUnit : line.product.looseUnitName}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => updateQty(line.product, line.unitType, line.qty - 1)}
                className="h-7 w-7 rounded-lg bg-bg text-text hover:bg-border"
              >
                −
              </button>
              <span className="w-8 text-center text-sm text-text">{line.qty}</span>
              <button
                onClick={() => updateQty(line.product, line.unitType, line.qty + 1)}
                className="h-7 w-7 rounded-lg bg-bg text-text hover:bg-border"
              >
                +
              </button>
            </div>
            <p className="w-16 text-right font-mono text-sm text-text">₹{lineTotal(line).toFixed(2)}</p>
            <button onClick={() => removeLine(line.product, line.unitType)} className="text-danger hover:underline" aria-label="Remove">
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <label className="mb-1 block text-sm font-medium text-text">Customer</label>
        <CustomerPicker selected={customer} onSelect={setCustomer} isAdmin={isAdmin} />
      </div>

      {isAdmin && (
        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium text-text">Discount (₹)</label>
          <input type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} className={`${inputCls} w-32`} />
        </div>
      )}

      <div className="mt-4">
        <label className="mb-1 block text-sm font-medium text-text">Payment Mode</label>
        <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} className={inputCls}>
          <option>Cash</option>
          <option>Card</option>
          <option>UPI</option>
          <option>Other</option>
        </select>
      </div>

      <div className="mt-4 rounded-xl bg-surface p-4 text-sm text-text shadow-sm">
        <div className="flex justify-between"><span>Subtotal</span><span>₹{subtotal.toFixed(2)}</span></div>
        <div className="flex justify-between"><span>GST</span><span>₹{gstTotal.toFixed(2)}</span></div>
        {appliedDiscount > 0 && <div className="flex justify-between"><span>Discount</span><span>-₹{appliedDiscount.toFixed(2)}</span></div>}
        <div className="mt-1 flex justify-between border-t border-border pt-1 font-semibold"><span>Total</span><span>₹{total.toFixed(2)}</span></div>
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      {needsOverride && (
        <div className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
          <label className="block text-sm font-medium text-text">Override reason<RequiredMark /></label>
          <input
            type="text"
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            className={`${inputCls} mt-1 w-full`}
          />
          <button
            onClick={() => submit(true)}
            disabled={!overrideReason.trim() || saving}
            className="mt-2 rounded-lg bg-warning px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Override & Complete Payment
          </button>
        </div>
      )}

      <button
        onClick={() => submit(false)}
        disabled={saving}
        className="mt-4 w-full rounded-lg bg-accent py-3 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:brightness-95"
      >
        {saving ? "Processing…" : "Payment Completed"}
      </button>
    </Layout>
  );
}
