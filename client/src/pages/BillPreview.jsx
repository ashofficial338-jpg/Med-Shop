import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Layout from "../components/Layout";
import { getSale, openSalePdf, voidSale } from "../api/sales";
import { useAuth } from "../context/AuthContext";
import RequiredMark from "../components/RequiredMark";

export default function BillPreview() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [sale, setSale] = useState(null);
  const [showVoidForm, setShowVoidForm] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    getSale(id).then(setSale);
  }, [id]);

  if (!sale) {
    return (
      <Layout>
        <p className="text-sm text-muted">Loading…</p>
      </Layout>
    );
  }

  const handleVoid = async () => {
    if (!voidReason.trim()) return;
    try {
      const updated = await voidSale(sale._id, voidReason);
      setSale(updated);
      setShowVoidForm(false);
    } catch (err) {
      setError(err.response?.data?.message || "Something went wrong. Please try again.");
    }
  };

  return (
    <Layout>
      <div className="mx-auto max-w-sm rounded-2xl bg-surface p-6 shadow-sm">
        {sale.paymentStatus === "void" && (
          <p className="mb-3 text-center text-lg font-bold text-danger">VOID</p>
        )}
        <h1 className="font-display text-xl font-semibold text-text">{sale.billNo}</h1>
        <p className="text-sm text-muted">{new Date(sale.createdAt).toLocaleString()}</p>
        <p className="mt-1 text-sm text-text">{sale.customer ? `${sale.customer.name} · ${sale.customer.phone}` : "Walk-in"}</p>

        <div className="mt-4 space-y-1 border-t border-border pt-3 text-sm">
          {sale.items.map((item, i) => (
            <div key={i} className="flex justify-between">
              <span className="text-text">{item.name} ({item.qty} {item.unitLabel})</span>
              <span className="font-mono text-text">₹{(item.amount + item.gstAmount).toFixed(2)}</span>
            </div>
          ))}
        </div>

        <div className="mt-3 space-y-1 border-t border-border pt-3 text-sm text-text">
          <div className="flex justify-between"><span>Subtotal</span><span>₹{sale.subtotal.toFixed(2)}</span></div>
          <div className="flex justify-between"><span>GST</span><span>₹{sale.gstAmount.toFixed(2)}</span></div>
          {sale.discount > 0 && <div className="flex justify-between"><span>Discount</span><span>-₹{sale.discount.toFixed(2)}</span></div>}
          <div className="flex justify-between font-semibold"><span>Total</span><span>₹{sale.total.toFixed(2)}</span></div>
        </div>

        {sale.paymentStatus === "void" && (
          <p className="mt-3 text-xs text-danger">Voided: {sale.voidReason}</p>
        )}
      </div>

      {error && <p className="mx-auto mt-3 max-w-sm text-sm text-danger">{error}</p>}

      <div className="mx-auto mt-4 flex max-w-sm flex-col gap-2">
        <button
          onClick={() => openSalePdf(sale._id)}
          className="rounded-lg bg-primary py-2.5 text-sm font-semibold text-white hover:bg-primary-dark"
        >
          Print
        </button>
        <button
          onClick={() => navigate("/products")}
          className="rounded-lg border border-border py-2.5 text-sm font-semibold text-text hover:bg-surface"
        >
          Done / New Bill
        </button>

        {user.role === "admin" && sale.paymentStatus !== "void" && !showVoidForm && (
          <button
            onClick={() => setShowVoidForm(true)}
            className="rounded-lg py-2.5 text-sm font-semibold text-danger hover:bg-danger/10"
          >
            Void Bill
          </button>
        )}

        {showVoidForm && (
          <div className="rounded-lg border border-danger/40 bg-danger/5 p-3">
            <label className="block text-sm font-medium text-text">Reason for voiding<RequiredMark /></label>
            <input
              type="text"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
            />
            <button
              onClick={handleVoid}
              disabled={!voidReason.trim()}
              className="mt-2 w-full rounded-lg bg-danger py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Confirm Void
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
}
