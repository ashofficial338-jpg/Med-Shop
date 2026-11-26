import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import Layout from "../components/Layout";
import DocumentViewer from "../components/DocumentViewer";
import { useLiveRefresh } from "../context/LiveSync";
import { getPurchaseOrder, purchaseOrderPdf, raisePurchaseOrder, cancelPurchaseOrder, deletePurchaseOrder } from "../api/purchaseOrders";
import { purchaseInvoicePdf } from "../api/purchases";
import { StatusBadge, ProgressBar, inr, showDate } from "../components/purchase/poCommon";

// One Purchase Order: its lines with ordered / received / pending, the
// invoices received against it, and every action that applies.
export default function PurchaseOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [po, setPo] = useState(null);
  const [error, setError] = useState("");
  const [doc, setDoc] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => getPurchaseOrder(id).then(setPo).catch((err) => setError(err.response?.data?.message || "Could not load this order."));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useLiveRefresh(["purchase-orders", "purchases"], load);

  const act = async (fn, done) => {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!po) return <Layout><p className={`text-sm ${error ? "text-danger" : "text-muted"}`}>{error || "Loading…"}</p></Layout>;

  const openOrder = ["Pending", "Partially Received"].includes(po.status);
  const btn = "rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-primary hover:bg-bg disabled:opacity-50";
  const cancel = () => {
    const reason = window.prompt(po.progress.received > 0 ? `Close ${po.poNo}? Nothing more can be received against it. Reason (optional):` : `Cancel ${po.poNo}? Reason (optional):`);
    if (reason === null) return;
    act(() => cancelPurchaseOrder(po._id, reason), `${po.poNo} cancelled.`);
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${po.poNo}? This cannot be undone.`)) return;
    try {
      await deletePurchaseOrder(po._id);
      toast.success(`${po.poNo} deleted.`);
      navigate("/purchase-orders");
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not delete.");
    }
  };

  return (
    <Layout>
      <Link to="/purchase-orders" className="text-sm font-semibold text-primary hover:underline">← Purchase Orders</Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">
            {po.poNo} <StatusBadge status={po.status} />
          </h1>
          <p className="mt-0.5 text-sm text-muted">
            {po.vendor?.name} · {showDate(po.date)}{po.expectedDate ? ` · expected ${showDate(po.expectedDate)}` : ""} · by {po.createdBy?.username}
          </p>
          {po.status === "Cancelled" && <p className="mt-1 text-sm text-danger">Cancelled {showDate(po.cancelledAt)}{po.cancelReason ? ` – ${po.cancelReason}` : ""}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setDoc({ title: `Purchase Order ${po.poNo}`, filename: `${po.poNo}.pdf`, load: () => purchaseOrderPdf(po._id) })} className={btn}>Print / Download PDF</button>
          {["Draft", "Pending", "Partially Received"].includes(po.status) && <Link to={`/purchase-orders/${po._id}/edit`} className={btn}>Edit</Link>}
          {po.status === "Draft" && <button disabled={busy} onClick={() => act(() => raisePurchaseOrder(po._id), `${po.poNo} raised.`)} className={btn}>Raise Order</button>}
          {openOrder && <Link to={`/purchases/new?po=${po._id}`} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-95">Receive (Create Invoice)</Link>}
          {["Draft", "Pending", "Partially Received"].includes(po.status) && <button disabled={busy} onClick={cancel} className="rounded-lg border border-danger/40 px-4 py-2 text-sm font-semibold text-danger hover:bg-danger/10">{po.progress.received > 0 ? "Close Order" : "Cancel Order"}</button>}
          {["Draft", "Cancelled", "Pending"].includes(po.status) && po.invoices.length === 0 && po.cancelledInvoices.length === 0 && <button onClick={remove} className="rounded-lg px-3 py-2 text-sm font-semibold text-danger hover:bg-danger/10">Delete</button>}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        {[["Order value", inr(po.total)], ["Qty ordered", po.progress.ordered], ["Received", po.progress.received], ["Pending", po.status === "Cancelled" ? "—" : po.progress.pending]].map(([l, v]) => (
          <div key={l} className="rounded-2xl bg-surface p-4 shadow-sm">
            <p className="text-xs font-medium text-muted">{l}</p>
            <p className="mt-1 font-mono text-lg font-semibold text-text">{v}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl bg-surface shadow-sm">
        <table className="w-full min-w-[720px] text-left text-sm text-text">
          <thead className="border-b border-border text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2">Item</th><th className="px-3 py-2 text-right">Ordered</th><th className="px-3 py-2 text-right">Received</th><th className="px-3 py-2 text-right">Pending</th>
              <th className="px-3 py-2 text-right">Rate</th><th className="px-3 py-2 text-right">Disc %</th><th className="px-3 py-2 text-right">GST %</th><th className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {po.items.map((i, k) => (
              <tr key={k} className="border-b border-border last:border-0">
                <td className="px-3 py-2">{i.product?.name} <span className="font-mono text-xs text-muted">({i.product?.productCode})</span></td>
                <td className="px-3 py-2 text-right">{i.ordered}</td>
                <td className="px-3 py-2 text-right text-success">{i.received}</td>
                <td className={`px-3 py-2 text-right ${i.pending > 0 ? "font-semibold text-warning" : "text-muted"}`}>{i.pending}</td>
                <td className="px-3 py-2 text-right font-mono">{inr(i.rate)}</td>
                <td className="px-3 py-2 text-right">{i.discountPercent || "—"}</td>
                <td className="px-3 py-2 text-right">{i.gstPercent}%</td>
                <td className="px-3 py-2 text-right font-mono">{inr(i.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border text-sm">
            <tr><td colSpan={7} className="px-3 py-1.5 text-right text-muted">Subtotal</td><td className="px-3 py-1.5 text-right font-mono">{inr(po.subtotal)}</td></tr>
            {po.discountAmount > 0 && <tr><td colSpan={7} className="px-3 py-1.5 text-right text-muted">Discount given</td><td className="px-3 py-1.5 text-right font-mono">−{inr(po.discountAmount)}</td></tr>}
            <tr><td colSpan={7} className="px-3 py-1.5 text-right text-muted">GST</td><td className="px-3 py-1.5 text-right font-mono">{inr(po.gstAmount)}</td></tr>
            <tr><td colSpan={7} className="px-3 py-2 text-right font-semibold">Grand Total</td><td className="px-3 py-2 text-right font-mono font-bold">{inr(po.total)}</td></tr>
          </tfoot>
        </table>
      </div>
      <div className="mt-2"><ProgressBar received={po.progress.received} ordered={po.progress.ordered} /></div>
      {po.notes && <p className="mt-3 whitespace-pre-wrap rounded-xl bg-surface p-3 text-sm text-text shadow-sm"><span className="text-xs font-semibold text-muted">Notes: </span>{po.notes}</p>}

      <h2 className="mt-6 font-display text-lg font-semibold text-text">Purchase Invoices against this order</h2>
      <div className="mt-2 space-y-2">
        {po.invoices.length === 0 && <p className="text-sm text-muted">Nothing received yet.</p>}
        {po.invoices.map((inv) => (
          <div key={inv._id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface p-3 text-sm shadow-sm">
            <span>
              <span className="font-mono font-semibold text-text">{inv.piNo}</span> · Supplier inv {inv.invoiceNo} · {showDate(inv.date)} · {inv.items.reduce((s, i) => s + i.qtyPacks, 0)} received
            </span>
            <span className="flex items-center gap-2">
              <span className="font-mono font-semibold">{inr(inv.total)}</span>
              <button onClick={() => setDoc({ title: `Purchase Invoice ${inv.piNo}`, filename: `${inv.piNo}.pdf`, load: () => purchaseInvoicePdf(inv._id) })} className="rounded-lg border border-border px-3 py-1 text-xs font-semibold text-primary hover:bg-bg">Print / PDF</button>
              <Link to={`/purchases/${inv._id}/edit`} className="rounded-lg border border-border px-3 py-1 text-xs font-semibold text-primary hover:bg-bg">Edit</Link>
            </span>
          </div>
        ))}
        {po.cancelledInvoices.map((inv) => (
          <p key={inv._id} className="rounded-xl bg-danger/5 p-3 text-xs text-muted">
            Cancelled invoice {inv.piNo || inv.invoiceNo} · {inr(inv.total)} · {showDate(inv.createdAt)}{inv.reason ? ` – ${inv.reason}` : ""}
          </p>
        ))}
      </div>

      {doc && <DocumentViewer {...doc} onClose={() => setDoc(null)} />}
    </Layout>
  );
}
