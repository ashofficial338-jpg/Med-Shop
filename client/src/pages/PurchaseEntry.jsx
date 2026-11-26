import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import Layout from "../components/Layout";
import Icon from "../components/Icon";
import SupplierPicker from "../components/purchase/SupplierPicker";
import PurchaseLine from "../components/purchase/PurchaseLine";
import InvoiceUploadModal from "../components/InvoiceUploadModal";
import { ScannedBillBanner } from "../components/ScannedBillNotes";
import { useLiveRefresh } from "../context/LiveSync";
import { listCategories, listProducts } from "../api/products";
import { createPurchase, getPurchase, updatePurchase } from "../api/purchases";
import { listVendors } from "../api/vendors";
import { getPurchaseOrder } from "../api/purchaseOrders";
import { todayLocal } from "../utils/date";
import { enterMovesToNextField } from "../utils/formKeys";
import { newEntryRef } from "../utils/entryRef";
import { emptyLine, isBlank, lineFigures, lineProblem, toItem } from "../utils/purchaseLine";
import { validPosition } from "../utils/rack";

const PAID_MODES = ["Cash", "UPI", "Bank Transfer", "Cheque", "Other"];
const round2 = (n) => Number(Number(n).toFixed(2));
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");

// The one Purchase Entry, for new purchases and corrections: any supplier (or
// none), existing and new products together. Saving it adds the stock and
// updates the supplier's balance, rates, stock value, dashboard and reports.
export default function PurchaseEntry() {
  const { id } = useParams();
  // A different purchase (or a new one) is a fresh form.
  return <PurchaseForm key={id || "new"} purchaseId={id || null} />;
}

function PurchaseForm({ purchaseId }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const presetVendor = searchParams.get("vendor");
  const presetPo = !purchaseId ? searchParams.get("po") : null;
  const editing = Boolean(purchaseId);

  const [original, setOriginal] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);

  const [vendor, setVendor] = useState(null);
  const [supplierName, setSupplierName] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [paymentMode, setPaymentMode] = useState("Cash");
  const [modeTouched, setModeTouched] = useState(false);
  const [amountPaid, setAmountPaid] = useState("");
  const [paidMode, setPaidMode] = useState("Cash");
  const [tdsAmount, setTdsAmount] = useState("");
  const [showTds, setShowTds] = useState(false);
  const [lines, setLines] = useState(() => [emptyLine()]);
  const [scan, setScan] = useState(null);
  const [scanOpen, setScanOpen] = useState(Boolean(location.state?.upload));

  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  // The Purchase Order these goods are received against (fixed supplier).
  const [po, setPo] = useState(null);
  const entryRef = useRef(newEntryRef());
  const formRef = useRef(null);

  const loadProducts = () => listProducts().then(setProducts).catch(() => {});
  useEffect(() => {
    loadProducts();
    listVendors()
      .then((list) => {
        setVendors(list);
        const preset = !purchaseId && presetVendor ? list.find((v) => v._id === presetVendor) : null;
        if (preset) {
          setVendor(preset);
          setPaymentMode("Credit");
        }
      })
      .catch(() => {});
    listCategories().then(setCategories).catch(() => {});
  }, [purchaseId, presetVendor]);
  // Products and suppliers added or changed by anyone are usable right away.
  useLiveRefresh(["products"], loadProducts);
  useLiveRefresh(["vendors"], () => listVendors().then(setVendors).catch(() => {}));

  useEffect(() => {
    if (!purchaseId) return;
    getPurchase(purchaseId)
      .then((p) => {
        setOriginal(p);
        setVendor(p.vendor || null);
        setSupplierName(p.supplierName || "");
        setInvoiceNo(p.invoiceNo);
        setDate(day(p.date));
        setPaymentMode(p.paymentMode);
        setModeTouched(true);
        setAmountPaid(p.paidAtPurchase ? String(p.paidAtPurchase) : "");
        setPaidMode(p.paidMode || "Cash");
        setTdsAmount(p.tdsAmount ? String(p.tdsAmount) : "");
        setShowTds(Boolean(p.tdsAmount));
        setLines([
          ...p.items.map((i) =>
            emptyLine({
              product: i.product?._id || i.product,
              name: i.product?.name || "",
              qtyPacks: String(i.qtyPacks),
              costPrice: String(i.costPrice),
              costTouched: true,
              discountPercent: i.discountPercent ? String(i.discountPercent) : "",
              batchNo: i.batchNo || "",
              expiryDate: day(i.expiryDate),
              rack: i.rack || "",
            })
          ),
          emptyLine(),
        ]);
      })
      .catch((err) => setLoadError(err.response?.data?.message || "Could not load this purchase."));
  }, [purchaseId]);

  // Receiving against a PO: supplier, items, pending quantities and rates come from the order.
  useEffect(() => {
    if (!presetPo) return;
    getPurchaseOrder(presetPo)
      .then((o) => {
        if (!["Pending", "Partially Received"].includes(o.status)) {
          setLoadError(`Purchase order ${o.poNo} is ${o.status.toLowerCase()} - goods can only be received against a pending order.`);
          return;
        }
        setPo(o);
        setVendor(o.vendor);
        setSupplierName("");
        setPaymentMode("Credit");
        const pending = o.items.filter((i) => i.pending > 0);
        setLines([
          ...pending.map((i) =>
            emptyLine({
              product: i.product?._id,
              name: i.product?.name || "",
              qtyPacks: String(i.pending),
              costPrice: String(i.rate),
              costTouched: true,
              discountPercent: i.discountPercent ? String(i.discountPercent) : "",
            })
          ),
          emptyLine(),
        ]);
      })
      .catch((err) => setLoadError(err.response?.data?.message || "Could not load the purchase order."));
  }, [presetPo]);

  // Current selling prices, once the products are here (edit form).
  const productById = (pid) => products.find((p) => p._id === pid);
  const sellingOf = (l) => (l.sellTouched || l.sellingPrice !== "" || !l.product ? l.sellingPrice : String(productById(l.product)?.packRate ?? ""));

  // Named (picked or typed) suppliers have an account; only a purchase with no
  // supplier at all has to be paid up front.
  const isDirect = !vendor && !supplierName.trim() && !(editing && original?.vendor);
  const paidLater = original?.paidLater || 0;
  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  // There is always one empty line at the end, ready for the next product.
  const withSpare = (ls) => (ls.length === 0 || !isBlank(ls[ls.length - 1]) ? [...ls, emptyLine()] : ls);

  const pickProduct = (key, p) =>
    setLines((ls) =>
      withSpare(
        ls.map((l) => {
          if (l.key !== key) return l;
          const keepRate = (Boolean(l.scan) || l.costTouched) && l.costPrice !== "";
          const keepSell = l.sellTouched && l.sellingPrice !== "";
          return {
            ...l,
            product: p._id,
            name: p.name,
            costPrice: keepRate ? l.costPrice : "",
            costTouched: keepRate,
            sellingPrice: keepSell ? l.sellingPrice : String(p.packRate ?? ""),
            rack: validPosition(p.rack) || l.rack,
          };
        })
      )
    );
  // Typing a name un-links any picked product (a new name = a new product).
  const typeName = (key, name) =>
    setLines((ls) => withSpare(ls.map((l) => (l.key === key ? { ...l, name, ...(l.product ? { product: "", sellingPrice: l.sellTouched ? l.sellingPrice : "" } : {}) } : l))));
  // The last purchase rate fills in unless a rate was typed already.
  const suggestRate = (key, productId, rate) =>
    setLines((ls) => ls.map((l) => (l.key === key && l.product === productId && !l.costTouched ? { ...l, costPrice: String(rate) } : l)));

  const chooseVendor = (v) => {
    setVendor(v);
    setSupplierName("");
    if (!modeTouched) setPaymentMode(v ? "Credit" : "Cash");
    else if (!v && paymentMode === "Credit") setPaymentMode("Cash");
  };
  const typeSupplier = (name) => {
    setSupplierName(name);
    if (!modeTouched) setPaymentMode(name.trim() ? "Credit" : "Cash");
    else if (!name.trim() && paymentMode === "Credit" && !(editing && original?.vendor)) setPaymentMode("Cash");
  };
  const chooseMode = (m) => {
    setPaymentMode(m);
    setModeTouched(true);
  };

  const applyScan = ({ vendor: v, initialData }) => {
    setScanOpen(false);
    setScan(initialData);
    chooseVendor(v || null);
    if (!v) typeSupplier(initialData.supplierName || "");
    setInvoiceNo(initialData.invoiceNo || "");
    if (initialData.date) setDate(initialData.date);
    setLines([...initialData.lines.map((l) => emptyLine(l)), emptyLine()]);
  };

  const filled = lines.filter((l) => !isBlank(l));
  const figures = filled.map((l) => lineFigures({ ...l, sellingPrice: sellingOf(l) }, productById(l.product)));
  const sum = (k) => round2(figures.reduce((s, f) => s + f[k], 0));
  const subtotal = sum("amount");
  const discount = sum("discount");
  const gst = sum("gst");
  const total = round2(subtotal + gst);
  const isCredit = paymentMode === "Credit";
  const paidNow = isCredit ? round2(Math.max(Number(amountPaid) || 0, 0)) : total;
  const balance = isCredit ? round2(total - paidLater - paidNow) : 0;

  const problem =
    filled.length === 0
      ? "Add at least one product."
      : filled.map(lineProblem).find(Boolean) || (isCredit && balance < 0 ? `The amount paid is ₹${(-balance).toFixed(2)} more than the total.` : "");

  const reset = () => {
    entryRef.current = newEntryRef();
    setVendor(null);
    setSupplierName("");
    setInvoiceNo("");
    setDate(todayLocal());
    setPaymentMode("Cash");
    setModeTouched(false);
    setAmountPaid("");
    setPaidMode("Cash");
    setTdsAmount("");
    setShowTds(false);
    setLines([emptyLine()]);
    setScan(null);
    setError("");
    listVendors().then(setVendors).catch(() => {});
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const save = async (then) => {
    if (saving) return;
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError("");
    const body = {
      invoiceNo: invoiceNo.trim(),
      date,
      paymentMode,
      tdsAmount: isDirect ? 0 : Number(tdsAmount) || 0,
      amountPaid: isCredit ? paidNow : undefined,
      paidMode: isCredit ? paidMode : undefined,
      ...(vendor ? { vendor: vendor._id } : { supplierName: supplierName.trim() }),
      ...(po && !editing ? { purchaseOrder: po._id } : {}),
      items: filled.map(toItem),
    };
    try {
      if (editing) {
        const p = await updatePurchase(purchaseId, body);
        toast.success(`Purchase invoice ${p.piNo || p.invoiceNo} updated.`);
        navigate("/purchases");
        return;
      }
      const p = await createPurchase({ ...body, clientRef: entryRef.current });
      if (p.alreadySaved && Math.abs(p.total - total) > 0.01) {
        // An earlier attempt had gone through, and the form was changed since.
        entryRef.current = newEntryRef();
        setError(`Your earlier attempt was saved as ${p.invoiceNo} (₹${p.total.toFixed(2)}). What's on screen is different - correct that purchase from Purchases, or save again to record a second one.`);
        return;
      }
      toast.success(`Purchase invoice ${p.piNo || p.invoiceNo} saved. Stock and balances are updated.`);
      if (po) {
        navigate(`/purchase-orders/${po._id}`);
        return;
      }
      if (then === "new") {
        setLastSaved(p);
        reset();
      } else navigate("/purchases");
    } catch (err) {
      setError(err.response?.data?.message || "No answer from the server. Check your connection and press Save again - the purchase will not be saved twice.");
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full min-w-0 rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-text focus:border-primary focus:outline-none disabled:opacity-60";
  const labelCls = "mb-1 block text-xs font-medium text-muted";
  const pill = (active) =>
    `rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50 ${active ? "border-primary bg-primary text-white" : "border-border bg-surface text-text hover:border-primary/40"}`;

  if (presetPo && !po) {
    return (
      <Layout>
        <p className={`text-sm ${loadError ? "text-danger" : "text-muted"}`}>{loadError || "Loading purchase order…"}</p>
      </Layout>
    );
  }

  if (editing && !original) {
    return (
      <Layout>
        <p className={`text-sm ${loadError ? "text-danger" : "text-muted"}`}>{loadError || "Loading…"}</p>
      </Layout>
    );
  }

  return (
    <Layout>
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        onKeyDown={enterMovesToNextField}
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">{editing ? `Edit Purchase Invoice ${original.piNo || original.invoiceNo}` : po ? `Receive against ${po.poNo}` : "New Purchase Invoice"}</h1>
            <p className="mt-0.5 text-sm text-muted">
              {editing
                ? "Stock and balances move by the difference. A quantity can't go below what has already been sold."
                : "Saving it adds the stock and updates the supplier's balance and every report."}
            </p>
          </div>
          {!editing && !po && (
            <button type="button" onClick={() => setScanOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-primary hover:bg-bg">
              <Icon name="download" size={16} className="rotate-180" />
              Fill from a bill photo / PDF
            </button>
          )}
        </div>

        {lastSaved && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-text" role="status">
            <span className="flex items-center gap-2">
              <Icon name="check" size={18} className="text-success" />
              <span>
                <strong>{lastSaved.piNo || lastSaved.invoiceNo}</strong> saved · ₹{lastSaved.total.toFixed(2)} · {lastSaved.vendor?.name || lastSaved.supplierName || "No supplier"}
              </span>
            </span>
            <span className="flex gap-2">
              <Link to={`/purchases/${lastSaved._id}/edit`} className="rounded-lg border border-border bg-surface px-3 py-1.5 font-semibold text-primary hover:bg-bg">
                View / edit
              </Link>
              <button type="button" onClick={() => setLastSaved(null)} aria-label="Dismiss" className="px-2 text-muted hover:text-text">
                ✕
              </button>
            </span>
          </div>
        )}

        <div className="mt-4 space-y-4">
          <ScannedBillBanner scan={scan} computedTotal={total} />
          {(po || original?.purchaseOrder) && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-text" role="status">
              {po ? (
                <>
                  Receiving goods against <Link to={`/purchase-orders/${po._id}`} className="font-semibold text-primary hover:underline">{po.poNo}</Link> from <strong>{po.vendor?.name}</strong>.
                  Quantities show what is still pending - change them to what actually arrived (remove lines that didn't come). Anything not received stays pending on the order.
                </>
              ) : (
                <>
                  Received against purchase order <Link to={`/purchase-orders/${original.purchaseOrder._id}`} className="font-semibold text-primary hover:underline">{original.purchaseOrder.poNo}</Link>. Quantities can't exceed what was ordered.
                </>
              )}
            </div>
          )}
          {original?.returns?.some((r) => r.status === "Confirmed") && (
            <p className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-2 text-xs text-text">
              Goods were returned from this invoice ({original.returns.filter((r) => r.status === "Confirmed").map((r) => r.returnNo).join(", ")}). A quantity can't go below what was returned.
            </p>
          )}

          <section aria-label="Supplier" className="grid gap-3 rounded-2xl bg-surface p-4 shadow-sm sm:grid-cols-[2fr_1fr_1fr]">
            <div>
              <label className={labelCls}>Supplier</label>
              <SupplierPicker
                vendors={vendors}
                vendor={vendor}
                name={supplierName}
                locked={paidLater > 0 || Boolean(po) || Boolean(original?.purchaseOrder)}
                onPick={chooseVendor}
                onType={typeSupplier}
                inputClassName={inputCls}
                autoFocus={!editing && !presetVendor}
              />
              {editing && original.vendor && !vendor && !supplierName.trim() && <p className="mt-1 text-xs text-warning">Choose a supplier – otherwise it stays with {original.vendor.name}.</p>}
            </div>
            <div>
              <label htmlFor="purchase-invoice" className={labelCls}>Supplier invoice no{editing && original.piNo ? ` · ${original.piNo}` : ""}</label>
              <input id="purchase-invoice" type="text" maxLength={60} value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="Automatic if blank" className={inputCls} />
            </div>
            <div>
              <label htmlFor="purchase-date" className={labelCls}>Date</label>
              <input id="purchase-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            </div>
          </section>

          <section aria-label="Products" className="rounded-2xl bg-surface shadow-sm">
            <ul className="divide-y divide-border">
              {lines.map((line, i) => (
                <PurchaseLine
                  key={line.key}
                  index={i}
                  line={{ ...line, sellingPrice: sellingOf(line) }}
                  product={productById(line.product)}
                  products={products}
                  categories={categories}
                  vendorId={vendor?._id}
                  supplierName={supplierName}
                  preferred={(p) => Boolean(vendor) && (p.vendor?._id || p.vendor) === vendor._id}
                  onChange={(patch) => setLine(line.key, patch)}
                  onPick={(p) => pickProduct(line.key, p)}
                  onTypeName={(name) => typeName(line.key, name)}
                  onSuggestRate={(rate) => suggestRate(line.key, line.product, rate)}
                  onRemove={() => setLines((ls) => withSpare(ls.filter((l) => l.key !== line.key)))}
                  inputCls={inputCls}
                  labelCls={labelCls}
                />
              ))}
            </ul>
            <p className="border-t border-border px-4 py-2.5 text-xs text-muted">
              {filled.length} product{filled.length === 1 ? "" : "s"} · Enter moves to the next box · Ctrl + Enter saves. Only the product and quantity are required.
            </p>
          </section>

          <section aria-label="Payment" className="grid gap-5 rounded-2xl bg-surface p-4 shadow-sm md:grid-cols-[1fr_280px]">
            <div className="space-y-4">
              <div>
                <span className={labelCls}>Payment</span>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Payment mode">
                  {(isDirect ? PAID_MODES : ["Credit", ...PAID_MODES]).map((m) => (
                    <button key={m} type="button" aria-pressed={paymentMode === m} disabled={paidLater > 0} onClick={() => chooseMode(m)} className={pill(paymentMode === m)}>
                      {m === "Credit" ? "Credit (pay later)" : m}
                    </button>
                  ))}
                </div>
                {isDirect && <p className="mt-1.5 text-xs text-muted">Enter the supplier above to buy on credit.</p>}
                {paidLater > 0 && (
                  <p className="mt-1.5 text-xs text-muted">₹{paidLater.toFixed(2)} was paid later from the supplier's account, so the supplier and payment mode stay as they are.</p>
                )}
              </div>
              {isCredit && (
                <div className="max-w-sm">
                  <label htmlFor="purchase-paid" className={labelCls}>{editing ? "Paid with this purchase" : "Paid now (optional)"}</label>
                  <div className="flex gap-2">
                    <input id="purchase-paid" type="number" min="0" step="0.01" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} placeholder="0.00" className={inputCls} />
                    <select aria-label="Paid by" value={paidMode} onChange={(e) => setPaidMode(e.target.value)} className={`${inputCls} w-auto`}>
                      {PAID_MODES.map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
              {!isDirect &&
                (showTds ? (
                  <div className="max-w-[10rem]">
                    <label htmlFor="purchase-tds" className={labelCls}>TDS (tracked separately)</label>
                    <input id="purchase-tds" type="number" min="0" step="0.01" value={tdsAmount} onChange={(e) => setTdsAmount(e.target.value)} className={inputCls} />
                  </div>
                ) : (
                  <button type="button" onClick={() => setShowTds(true)} className="text-xs font-semibold text-primary hover:underline">
                    + Add TDS
                  </button>
                ))}
            </div>

            <dl className="space-y-1 text-sm text-text">
              {discount > 0 && (
                <>
                  <div className="flex justify-between"><dt className="text-muted">Before discount</dt><dd className="tabular-nums">₹{sum("gross").toFixed(2)}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted">Discount</dt><dd className="tabular-nums">−₹{discount.toFixed(2)}</dd></div>
                </>
              )}
              <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="tabular-nums">₹{subtotal.toFixed(2)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">GST</dt><dd className="tabular-nums">₹{gst.toFixed(2)}</dd></div>
              <div className="flex items-baseline justify-between border-t border-border pt-2">
                <dt className="font-display text-base font-semibold">Total</dt>
                <dd className="font-display text-2xl font-bold tabular-nums">₹{total.toFixed(2)}</dd>
              </div>
              {isCredit && (
                <>
                  {paidLater > 0 && <div className="flex justify-between text-muted"><dt>Paid later</dt><dd className="tabular-nums">₹{paidLater.toFixed(2)}</dd></div>}
                  <div className="flex justify-between font-semibold text-danger"><dt>You will owe</dt><dd className="tabular-nums">₹{Math.max(balance, 0).toFixed(2)}</dd></div>
                </>
              )}
            </dl>
          </section>
        </div>

        {error && (
          <p className="mt-4 text-sm text-danger" role="alert">
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2 pb-6">
          <button type="submit" disabled={saving || filled.length === 0} className="rounded-xl bg-accent px-8 py-3 text-base font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? "Saving…" : editing ? "Save Changes" : po ? "Confirm Invoice & Add Stock" : "Save Purchase"}
          </button>
          {!editing && !po && (
            <button type="button" onClick={() => save("new")} disabled={saving || filled.length === 0} className="rounded-xl border border-border bg-surface px-6 py-3 text-sm font-semibold text-primary hover:bg-bg disabled:opacity-50">
              Save & Enter Another
            </button>
          )}
          <button type="button" onClick={() => navigate("/purchases")} className="rounded-xl px-5 py-3 text-sm font-semibold text-muted hover:bg-surface">
            Cancel
          </button>
        </div>
      </form>

      {scanOpen && <InvoiceUploadModal vendors={vendors} onClose={() => setScanOpen(false)} onContinue={applyScan} />}
    </Layout>
  );
}
