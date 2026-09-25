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
      {/* billText is the exact same fixed-width layout the printed PDF uses
          (built once, server-side, in saleHelpers.buildBillText) - shown
          verbatim here in a monospace block so the on-screen preview and
          the print-out always match. */}
      <div className="mx-auto max-w-3xl overflow-x-auto rounded-2xl bg-surface p-6 shadow-sm">
        <pre className="whitespace-pre font-mono text-[11px] leading-snug text-text">{sale.billText}</pre>
      </div>

      {error && <p className="mx-auto mt-3 max-w-3xl text-sm text-danger">{error}</p>}

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
