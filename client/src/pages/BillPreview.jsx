import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Layout from "../components/Layout";
import { getSale, openSalePdf, voidSale } from "../api/sales";
import { useAuth } from "../context/AuthContext";
import RequiredMark from "../components/RequiredMark";

// TODO: replace with the real registered business name, GSTIN and address -
// mirrors the SHOP constant in server/src/utils/billPdf.js.
const SHOP = {
  name: "GHM Medical Shop",
  gstin: "",
  address: "",
};

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

  // Falls back to computing the tax breakup client-side for a void response
  // (voidSale returns the raw sale, without the taxBreakup the GET /:id
  // endpoint adds) - mirrors server/src/utils/saleHelpers.js billTaxBreakup.
  const breakup =
    sale.taxBreakup ||
    (() => {
      const grossTotal = Number((sale.subtotal + sale.gstAmount).toFixed(2));
      const discountPercent = grossTotal > 0 ? (sale.discount / grossTotal) * 100 : 0;
      const postDiscountTotal = Number((sale.subtotal + sale.gstAmount - sale.discount).toFixed(2));
      const avgGstRate = sale.subtotal > 0 ? sale.gstAmount / sale.subtotal : 0;
      const base = Number((postDiscountTotal / (1 + avgGstRate)).toFixed(2));
      const gstAfterDiscount = Number((postDiscountTotal - base).toFixed(2));
      return {
        grossTotal,
        discountPercent,
        base,
        cgst: Number((gstAfterDiscount / 2).toFixed(2)),
        sgst: Number((gstAfterDiscount / 2).toFixed(2)),
        roundedOff: Math.round(postDiscountTotal),
      };
    })();

  const itemBatch = (item) =>
    item.batchBreakdown?.map((b) => b.batchNo).filter(Boolean).join(",") || "";
  const itemExpiry = (item) => {
    const exp = item.batchBreakdown?.[0]?.expiryDate;
    if (!exp) return "";
    const d = new Date(exp);
    return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(-2)}`;
  };

  return (
    <Layout>
      <div className="mx-auto max-w-lg rounded-2xl bg-surface p-6 font-mono shadow-sm">
        <div className="text-center">
          <p className="text-base font-bold text-text">{SHOP.name}</p>
          {SHOP.gstin && <p className="text-xs text-muted">GSTIN: {SHOP.gstin}</p>}
          {SHOP.address && <p className="text-xs text-muted">{SHOP.address}</p>}
        </div>

        <div className="mt-3 space-y-0.5 text-xs text-text">
          <p>NO TAX Bill : {sale.billNo}</p>

          {sale.paymentStatus === "void" && (
            <p className="text-center text-lg font-bold text-danger">VOID</p>
          )}

          <p>Date: {new Date(sale.createdAt).toLocaleString()}</p>
          <p>Name: {sale.customer?.name || "Walk-in"}</p>
          <p>Dr.:</p>
          <p>Cus Phone: {sale.customer?.phone || ""}</p>
        </div>

        <div className="mt-3 overflow-x-auto border-t border-dashed border-border pt-2">
          <table className="w-full min-w-[560px] text-left text-[11px] text-text">
            <thead>
              <tr className="border-b border-dashed border-border text-muted">
                <th className="pr-2 font-normal">Qty</th>
                <th className="pr-2 font-normal">Product Name</th>
                <th className="pr-2 font-normal">Mfr</th>
                <th className="pr-2 font-normal">MRP</th>
                <th className="pr-2 font-normal">Batch</th>
                <th className="pr-2 font-normal">Loc</th>
                <th className="pr-2 font-normal">Exp</th>
                <th className="pr-2 font-normal">GST</th>
                <th className="font-normal">Amount</th>
              </tr>
            </thead>
            <tbody>
              {sale.items.map((item, i) => (
                <tr key={i}>
                  <td className="pr-2">{item.qty} {item.unitLabel}</td>
                  <td className="pr-2">{item.name}</td>
                  <td className="pr-2"></td>
                  <td className="pr-2">{item.rate.toFixed(2)}</td>
                  <td className="pr-2">{itemBatch(item)}</td>
                  <td className="pr-2"></td>
                  <td className="pr-2">{itemExpiry(item)}</td>
                  <td className="pr-2">{item.gstPercent}%</td>
                  <td>{(item.amount + item.gstAmount).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 space-y-1 border-t border-dashed border-border pt-3 text-xs text-text">
          <div className="flex justify-between"><span>Gross Total</span><span>{breakup.grossTotal.toFixed(2)}</span></div>
          {sale.discount > 0 && (
            <div className="flex justify-between"><span>Discount {breakup.discountPercent.toFixed(2)}%</span><span>{sale.discount.toFixed(2)}</span></div>
          )}
          <div className="flex justify-between"><span>Base</span><span>{breakup.base.toFixed(2)}</span></div>
          <div className="flex justify-between"><span>CGST</span><span>{breakup.cgst.toFixed(2)}</span></div>
          <div className="flex justify-between"><span>SGST</span><span>{breakup.sgst.toFixed(2)}</span></div>
          <div className="flex justify-between font-semibold"><span>Rounded Off to Rs</span><span>{breakup.roundedOff.toFixed(2)}</span></div>
        </div>

        {sale.paymentStatus === "void" && (
          <p className="mt-3 text-xs text-danger">Voided: {sale.voidReason}</p>
        )}

        <div className="mt-3 space-y-0.5 border-t border-dashed border-border pt-2 text-xs text-text">
          <p>Billed By: {sale.createdBy?.username || ""}</p>
          <p>SMAN:</p>
        </div>

        <div className="mt-3 space-y-0.5 text-center text-[10px] text-muted">
          <p>Goods Once Sold Can't be Taken Back</p>
          <p>** PRODUCTS HAVE NO DISCOUNT</p>
        </div>
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
