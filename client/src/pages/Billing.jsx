import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import Layout from "../components/Layout";
import Icon from "../components/Icon";
import CustomerPicker from "../components/CustomerPicker";
import BillProductSearch from "../components/billing/BillProductSearch";
import BillLine from "../components/billing/BillLine";
import { lineRate, useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";
import { useLiveRefresh } from "../context/LiveSync";
import { createSale, openSalePdf } from "../api/sales";
import { getProduct, getSaleBatches } from "../api/products";
import { listRacks } from "../api/racks";
import { hasRack, shortLineOf } from "../utils/billLine";
import { todayLocal } from "../utils/date";

const PAYMENT_MODES = ["Cash", "UPI", "Card", "Credit", "Other"];
const RECEIVED_MODES = ["Cash", "UPI", "Card", "Bank Transfer", "Other"];
const round2 = (n) => Number(Number(n).toFixed(2));
const PRODUCT_FIELDS = ["name", "packRate", "looseRate", "gstPercent", "soldAs", "unitsPerPack", "packUnit", "looseUnitName"];

// The Billing screen - and the sales entry. Saving a bill records the sale,
// takes the stock, posts the payment or the customer's balance, and every
// report and the dashboard follow from it. Nothing is entered a second time.
export default function Billing() {
  const { lines, addToCart, updateQty, removeLine, setLineBatch, setLineRate, setLineUnit, refreshProducts, clearCart, billRef, renewBillRef, lineTotal } = useCart();
  const { user } = useAuth();
  const isAdmin = user.role === "admin";

  const [customer, setCustomer] = useState(null);
  const [typedCustomer, setTypedCustomer] = useState(null); // a name / phone typed, not picked
  const [discount, setDiscount] = useState("");
  const [discountType, setDiscountType] = useState("₹");
  const [paymentMode, setPaymentMode] = useState("Cash");
  const [amountReceived, setAmountReceived] = useState("");
  const [receivedMode, setReceivedMode] = useState("Cash");
  const [billDate, setBillDate] = useState(todayLocal());
  const [error, setError] = useState(null); // { message, sale? }
  const [needsOverride, setNeedsOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null); // the bill just saved
  const [batchesByProduct, setBatchesByProduct] = useState({});
  const [racks, setRacks] = useState([]);
  const searchRef = useRef(null);

  useEffect(() => {
    listRacks().then(setRacks).catch(() => {});
  }, []);

  // Live stock, prices and GST of what's on the bill.
  const productIds = [...new Set(lines.map((l) => l.product._id))].sort().join(",");
  const loadStock = useRef(() => {});
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (!productIds) return;
      const ids = productIds.split(",");
      Promise.all(ids.map((id) => getSaleBatches(id).then((b) => [id, b]).catch(() => null))).then((pairs) => {
        if (!cancelled) setBatchesByProduct((prev) => ({ ...prev, ...Object.fromEntries(pairs.filter(Boolean)) }));
      });
      Promise.all(ids.map((id) => getProduct(id).then((p) => [id, p]).catch(() => null))).then((pairs) => {
        if (cancelled) return;
        const fresh = {};
        for (const pair of pairs) {
          if (!pair) continue;
          const [id, p] = pair;
          fresh[id] = Object.fromEntries(PRODUCT_FIELDS.filter((k) => p[k] !== undefined && p[k] !== null).map((k) => [k, p[k]]));
        }
        refreshProducts(fresh);
      });
    };
    loadStock.current = load;
    load();
    return () => {
      cancelled = true;
    };
    // refreshProducts only updates cart state; re-running for it isn't needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productIds]);
  // Someone else's sale or purchase changes what's available here.
  useLiveRefresh(["products", "stock"], () => loadStock.current());

  const lineGst = (line) => round2((lineTotal(line) * line.product.gstPercent) / 100);
  const subtotal = round2(lines.reduce((sum, l) => sum + lineTotal(l), 0));
  const gstTotal = round2(lines.reduce((sum, l) => sum + lineGst(l), 0));
  const gross = round2(subtotal + gstTotal);
  // Never below zero or above the bill amount (the server enforces the same).
  const wanted = Math.max(Number(discount) || 0, 0);
  const appliedDiscount = isAdmin ? round2(Math.min(discountType === "%" ? (gross * Math.min(wanted, 100)) / 100 : wanted, gross)) : 0;
  const total = round2(gross - appliedDiscount);
  const isCredit = paymentMode === "Credit";
  const receivedNow = isCredit ? round2(Math.min(Math.max(Number(amountReceived) || 0, 0), total)) : total;
  const balanceDue = round2(total - receivedNow);
  const shortLine = shortLineOf(lines, batchesByProduct);
  const hasCustomer = Boolean(customer || typedCustomer);
  const canSave = lines.length > 0 && !shortLine && (!isCredit || hasCustomer) && !saving;

  const startNextBill = () => {
    clearCart();
    renewBillRef();
    setCustomer(null);
    setTypedCustomer(null);
    setDiscount("");
    setPaymentMode("Cash");
    setAmountReceived("");
    setReceivedMode("Cash");
    setBillDate(todayLocal());
    setNeedsOverride(false);
    setOverrideReason("");
    setError(null);
    setBatchesByProduct({});
    searchRef.current?.focus();
  };

  const save = async ({ print = false, override = false } = {}) => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const sale = await createSale({
        clientRef: billRef(),
        customer: customer?._id || null,
        ...(!customer && typedCustomer ? { newCustomer: { name: typedCustomer.name, phone: typedCustomer.phone } } : {}),
        paymentMode,
        discount: appliedDiscount,
        items: lines.map((l) => ({
          product: l.product._id,
          unitType: l.unitType,
          qty: l.qty,
          ...(isAdmin ? { rate: lineRate(l) } : {}),
          ...(l.batch ? { batch: l.batch } : {}),
          ...(l.batch && hasRack(l) ? { rack: l.rack || "NONE" } : {}),
        })),
        ...(isAdmin && billDate && billDate !== todayLocal() ? { date: billDate } : {}),
        ...(isCredit ? { amountReceived: receivedNow, receivedMode } : {}),
        ...(override ? { overrideExpired: true, overrideExpiredReason: overrideReason } : {}),
      });
      // An earlier attempt had already gone through, and the bill was changed
      // since: say so rather than losing what's on screen or billing it twice.
      if (sale.alreadySaved && Math.abs(sale.total - total) > 0.01) {
        renewBillRef();
        setError({
          message: `Your earlier attempt was saved as ${sale.billNo} (₹${sale.total.toFixed(2)}). What's on screen is different - open that bill to correct it, or save again to make a second bill.`,
          sale,
        });
        return;
      }
      setSaved(sale);
      toast.success(`Bill ${sale.billNo} saved.`);
      if (print) openSalePdf(sale._id).catch(() => toast.error("The bill is saved, but the print-out couldn't be opened. Use Print above."));
      startNextBill();
    } catch (err) {
      const data = err.response?.data;
      setError({
        message: data?.message || "No answer from the server. Check your connection and press Save again - the bill will not be saved twice.",
      });
      setNeedsOverride(isAdmin && Boolean(data?.expired));
      // Stock may have moved meanwhile: show what's really left.
      loadStock.current();
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      save();
    } else if (e.key === "F2") {
      e.preventDefault();
      searchRef.current?.focus();
    }
  };

  const inputCls = "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none";
  const labelCls = "mb-1.5 block text-sm font-medium text-text";
  const pill = (active) =>
    `rounded-lg border px-3 py-2 text-sm font-semibold ${active ? "border-primary bg-primary text-white" : "border-border bg-surface text-text hover:border-primary/40"}`;

  return (
    <Layout>
      <div onKeyDown={onKeyDown}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">New Bill</h1>
            <p className="mt-0.5 text-sm text-muted">Saving the bill records the sale, reduces stock and updates every balance and report.</p>
          </div>
          {lines.length > 0 && (
            <button
              type="button"
              onClick={() => window.confirm("Clear everything on this bill?") && startNextBill()}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-muted hover:bg-surface hover:text-danger"
            >
              Clear bill
            </button>
          )}
        </div>

        {saved && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-success/30 bg-success/10 px-4 py-3" role="status">
            <p className="flex items-center gap-2 text-sm text-text">
              <Icon name="check" size={18} className="text-success" />
              <span>
                <strong>{saved.billNo}</strong> saved · ₹{saved.total.toFixed(2)} · {saved.customer?.name || "Walk-in"} · {saved.paymentMode}
                {saved.balanceDue > 0 && <span className="font-semibold text-danger"> · ₹{saved.balanceDue.toFixed(2)} due</span>}
              </span>
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => openSalePdf(saved._id).catch(() => toast.error("Couldn't open the print-out."))} className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-white hover:bg-primary-dark">
                Print
              </button>
              <Link to={`/bills/${saved._id}`} className="rounded-lg border border-border bg-surface px-4 py-1.5 text-sm font-semibold text-primary hover:bg-bg">
                View / edit
              </Link>
              <button type="button" onClick={() => setSaved(null)} aria-label="Dismiss" className="px-2 text-muted hover:text-text">
                ✕
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section aria-label="Products on this bill">
            <BillProductSearch
              inputRef={searchRef}
              onAdd={(p) => {
                setSaved(null);
                addToCart(p, "pack", 1);
              }}
            />

            <div className="mt-3 rounded-2xl bg-surface shadow-sm">
              {lines.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                    <Icon name="receipt" size={22} />
                  </span>
                  <p className="font-display font-semibold text-text">Add the first product</p>
                  <p className="max-w-sm text-sm text-muted">
                    Search above or scan a barcode. You can also{" "}
                    <Link to="/products" className="font-semibold text-primary hover:underline">
                      browse products
                    </Link>
                    .
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {lines.map((line) => (
                    <BillLine
                      key={`${line.product._id}:${line.unitType}`}
                      line={line}
                      batches={batchesByProduct[line.product._id]}
                      racks={racks}
                      canEditRate={isAdmin}
                      total={lineTotal(line)}
                      onQty={(qty) => updateQty(line.product, line.unitType, qty)}
                      onUnit={(unit) => setLineUnit(line.product, line.unitType, unit)}
                      onRate={(rate) => setLineRate(line.product, line.unitType, rate)}
                      onBatch={(batchId, rack) => setLineBatch(line.product, line.unitType, batchId, rack)}
                      onRemove={() => removeLine(line.product, line.unitType)}
                    />
                  ))}
                </ul>
              )}
            </div>
            <p className="mt-2 hidden text-xs text-muted sm:block">Keyboard: Enter adds the highlighted product · F2 back to search · Ctrl + Enter saves the bill</p>
          </section>

          <section aria-label="Payment" className="space-y-4 rounded-2xl bg-surface p-4 shadow-sm sm:p-5 lg:sticky lg:top-24">
            <div>
              <label className={labelCls}>Customer</label>
              <CustomerPicker selected={customer} onSelect={setCustomer} typed={typedCustomer} onTyped={setTypedCustomer} isAdmin={isAdmin} />
              {!hasCustomer && !isCredit && <p className="mt-1 text-xs text-muted">Leave blank for a walk-in customer.</p>}
            </div>

            <div>
              <span className={labelCls}>Payment</span>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Payment mode">
                {PAYMENT_MODES.map((m) => (
                  <button key={m} type="button" aria-pressed={paymentMode === m} onClick={() => setPaymentMode(m)} className={pill(paymentMode === m)}>
                    {m === "Credit" ? "Credit (pay later)" : m}
                  </button>
                ))}
              </div>
              {isCredit && !hasCustomer && <p className="mt-1.5 text-xs font-semibold text-danger">Enter the customer above to bill on credit.</p>}
            </div>

            {isCredit && (
              <div>
                <label htmlFor="bill-received" className={labelCls}>Received now (optional)</label>
                <div className="flex gap-2">
                  <input id="bill-received" type="number" min="0" step="0.01" value={amountReceived} onChange={(e) => setAmountReceived(e.target.value)} placeholder="0.00" className={`${inputCls} w-full`} />
                  <select aria-label="Received by" value={receivedMode} onChange={(e) => setReceivedMode(e.target.value)} className={inputCls}>
                    {RECEIVED_MODES.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {isAdmin && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="bill-discount" className={labelCls}>Discount</label>
                  <div className="flex">
                    <input id="bill-discount" type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" className={`${inputCls} w-full min-w-0 rounded-r-none`} />
                    <select aria-label="Discount type" value={discountType} onChange={(e) => setDiscountType(e.target.value)} className={`${inputCls} rounded-l-none border-l-0 px-2`}>
                      <option>₹</option>
                      <option>%</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor="bill-date" className={labelCls}>Bill date</label>
                  <input id="bill-date" type="date" max={todayLocal()} value={billDate} onChange={(e) => setBillDate(e.target.value || todayLocal())} className={`${inputCls} w-full min-w-0 px-2`} />
                </div>
              </div>
            )}

            <dl className="space-y-1 border-t border-border pt-3 text-sm text-text">
              <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="tabular-nums">₹{subtotal.toFixed(2)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">GST</dt><dd className="tabular-nums">₹{gstTotal.toFixed(2)}</dd></div>
              {appliedDiscount > 0 && (
                <div className="flex justify-between"><dt className="text-muted">Discount</dt><dd className="tabular-nums">−₹{appliedDiscount.toFixed(2)}</dd></div>
              )}
              <div className="flex items-baseline justify-between border-t border-border pt-2">
                <dt className="font-display text-base font-semibold">Total</dt>
                <dd className="font-display text-2xl font-bold tabular-nums">₹{total.toFixed(2)}</dd>
              </div>
              {isCredit && (
                <div className="flex justify-between font-semibold text-danger"><dt>Balance due</dt><dd className="tabular-nums">₹{balanceDue.toFixed(2)}</dd></div>
              )}
            </dl>

            {shortLine && (
              <p className="text-sm text-danger" role="alert">
                Not enough stock of {shortLine.product.name}
                {shortLine.batch ? " in the chosen batch" : ""}. Reduce the quantity{shortLine.batch ? " or change the batch" : ""}.
              </p>
            )}
            {error && (
              <p className="text-sm text-danger" role="alert">
                {error.message}
                {error.sale && (
                  <>
                    {" "}
                    <Link to={`/bills/${error.sale._id}`} className="font-semibold underline">
                      Open {error.sale.billNo}
                    </Link>
                  </>
                )}
              </p>
            )}

            {needsOverride && (
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-3">
                <label htmlFor="bill-override" className="block text-sm font-medium text-text">Sell the expired batch anyway? Reason (optional)</label>
                <input id="bill-override" type="text" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} className={`${inputCls} mt-1 w-full`} />
                <button type="button" onClick={() => save({ override: true })} disabled={!canSave} className="mt-2 rounded-lg bg-warning px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  Sell anyway and save
                </button>
              </div>
            )}

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => save()}
                disabled={!canSave}
                className="w-full rounded-xl bg-accent py-3.5 text-base font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save Bill"}
              </button>
              <button
                type="button"
                onClick={() => save({ print: true })}
                disabled={!canSave}
                className="w-full rounded-xl border border-border py-2.5 text-sm font-semibold text-primary hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save & Print
              </button>
            </div>
          </section>
        </div>
      </div>
    </Layout>
  );
}
