import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import CustomerPicker from "../components/CustomerPicker";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";
import { createSale } from "../api/sales";
import RequiredMark from "../components/RequiredMark";
import { getSaleBatches } from "../api/products";
import { listRacks } from "../api/racks";
import { describePosition, rackLetter } from "../utils/rack";
import { makerOf } from "../utils/medicine";

// Internal stock units one cart line takes (loose units for pack-and-loose products).
const lineUnits = (line) =>
  line.unitType === "pack" && line.product.soldAs === "pack-and-loose" ? line.qty * line.product.unitsPerPack : line.qty;

function unitsLabel(product, units) {
  if (product.soldAs === "pack-and-loose" && product.unitsPerPack) {
    const packs = Math.floor(units / product.unitsPerPack);
    const loose = units % product.unitsPerPack;
    return `${packs} ${product.packUnit}${packs === 1 ? "" : "s"}${loose ? ` + ${loose} ${product.looseUnitName}` : ""}`;
  }
  return `${units} ${product.packUnit}${units === 1 ? "" : "s"}`;
}

const hasRack = (line) => line.rack !== null && line.rack !== undefined;

// Units available for a line: the picked rack position of the picked batch,
// the picked batch, or the whole brand.
function availableFor(line, batches) {
  if (!batches) return null;
  if (!line.batch) return batches.reduce((s, b) => s + b.qtyRemaining, 0);
  const b = batches.find((x) => x._id === line.batch);
  if (!b) return 0;
  if (!hasRack(line)) return b.qtyRemaining;
  return b.locations.find((l) => l.rack === line.rack)?.qty || 0;
}

function where(code, racks) {
  if (!code) return "No Rack";
  const d = describePosition(code, racks.find((r) => r.letter === rackLetter(code)));
  return d.shelf ? `${code} (Shelf ${d.shelf}, Row ${d.row}, Bin ${d.bin})` : code;
}

// The selected brand's live stock, lots and rack positions - picking
// assistance for staff. Stock is only ever taken from this exact product:
// the picked batch + rack, or earliest expiry first from its primary rack.
function BrandStock({ line, batches, racks, onPick }) {
  const { product } = line;
  if (!batches) return <p className="text-xs text-muted">Checking stock…</p>;
  const available = availableFor(line, batches);
  const short = lineUnits(line) > available;
  const exp = (d) => new Date(d).toLocaleDateString(undefined, { month: "short", year: "numeric" });
  const autoFrom = batches[0]?.locations?.[0];
  const picked = batches.find((b) => b._id === line.batch);
  let pickFrom = "—";
  if (line.batch && hasRack(line)) pickFrom = where(line.rack, racks);
  else if (picked) pickFrom = picked.locations.map((l) => where(l.rack, racks)).join(" / ");
  else if (autoFrom) pickFrom = `${where(autoFrom.rack, racks)} · batch ${batches[0].batchNo}`;
  const value = line.batch ? `${line.batch}|${hasRack(line) ? line.rack : "*"}` : "";
  return (
    <div className="mt-1 space-y-1 text-xs">
      <p className={short ? "font-semibold text-danger" : "text-muted"}>
        {short ? "Not enough stock: " : "Available: "}
        {unitsLabel(product, available)}
        {line.batch ? (hasRack(line) ? " at this position" : " in this batch") : ""}
      </p>
      <p className="font-semibold text-primary">📍 Pick from: {pickFrom}</p>
      <select
        aria-label={`Batch and rack for ${product.name}`}
        value={value}
        onChange={(e) => {
          if (!e.target.value) return onPick(null, null);
          const [batchId, rack] = e.target.value.split("|");
          onPick(batchId, rack === "*" ? null : rack);
        }}
        className="max-w-full rounded-md border border-border bg-surface px-1.5 py-0.5 text-xs text-text focus:border-primary focus:outline-none"
      >
        <option value="">Auto: earliest expiry, primary rack</option>
        {batches.map((b) => (
          <optgroup key={b._id} label={`Batch ${b.batchNo} · exp ${b.expiryDate ? exp(b.expiryDate) : "—"} · ${unitsLabel(product, b.qtyRemaining)}`}>
            {b.locations.length > 1 && <option value={`${b._id}|*`}>Batch {b.batchNo} – any rack</option>}
            {b.locations.map((l) => (
              <option key={l.rack || "none"} value={`${b._id}|${l.rack}`}>
                {b.batchNo} @ {where(l.rack, racks)} · {unitsLabel(product, l.qty)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

export default function Checkout() {
  const { lines, updateQty, removeLine, setLineBatch, clearCart, lineTotal } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user.role === "admin";

  const [customer, setCustomer] = useState(null);
  const [discount, setDiscount] = useState("");
  const [paymentMode, setPaymentMode] = useState("Cash");
  const [amountReceived, setAmountReceived] = useState("");
  const [error, setError] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [needsOverride, setNeedsOverride] = useState(false);
  const [saving, setSaving] = useState(false);
  const [batchesByProduct, setBatchesByProduct] = useState({});
  const [racks, setRacks] = useState([]);

  useEffect(() => {
    listRacks().then(setRacks).catch(() => {});
  }, []);

  const productIds = [...new Set(lines.map((l) => l.product._id))].sort().join(",");
  useEffect(() => {
    if (!productIds) return;
    let cancelled = false;
    Promise.all(productIds.split(",").map((id) => getSaleBatches(id).then((b) => [id, b]).catch(() => [id, []]))).then((pairs) => {
      if (!cancelled) setBatchesByProduct(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [productIds]);

  if (lines.length === 0) {
    return <Navigate to="/products" replace />;
  }

  const lineGst = (line) => Number(((lineTotal(line) * line.product.gstPercent) / 100).toFixed(2));

  const subtotal = lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const gstTotal = lines.reduce((sum, l) => sum + lineGst(l), 0);
  const appliedDiscount = isAdmin ? Number(discount) || 0 : 0;
  const total = subtotal + gstTotal - appliedDiscount;
  const isCredit = paymentMode === "Credit";
  const receivedNow = isCredit ? Math.min(Math.max(Number(amountReceived) || 0, 0), total) : total;
  const balanceDue = Number((total - receivedNow).toFixed(2));
  // Block payment while any line asks for more than its brand (or picked batch) has.
  const shortLine = lines.find((l) => {
    const available = availableFor(l, batchesByProduct[l.product._id]);
    return available !== null && lineUnits(l) > available;
  });
  const canSubmit = (!isCredit || Boolean(customer)) && !shortLine;

  const submit = async (withOverride = false) => {
    if (!canSubmit) return;
    setSaving(true);
    setError("");
    try {
      const sale = await createSale({
        customer: customer?._id || null,
        paymentMode,
        discount: appliedDiscount,
        items: lines.map((l) => ({
          product: l.product._id,
          unitType: l.unitType,
          qty: l.qty,
          ...(l.batch ? { batch: l.batch } : {}),
          ...(l.batch && hasRack(l) ? { rack: l.rack || "NONE" } : {}),
        })),
        ...(isCredit ? { amountReceived: receivedNow } : {}),
        ...(withOverride ? { overrideExpired: true, overrideExpiredReason: overrideReason } : {}),
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
      <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">Checkout</h1>

      <div className="mt-4 space-y-2">
        {lines.map((line) => (
          <div key={`${line.product._id}:${line.unitType}`} className="flex items-center justify-between gap-2 rounded-xl bg-surface p-3 shadow-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-text">
                {line.product.name}
                {makerOf(line.product) && <span className="ml-1 text-xs font-normal text-muted">· {makerOf(line.product)}</span>}
              </p>
              <p className="text-xs text-muted">
                ₹{(line.unitType === "pack" ? line.product.packRate : line.product.looseRate).toFixed(2)} / {line.unitType === "pack" ? line.product.packUnit : line.product.looseUnitName}
              </p>
              <BrandStock
                line={line}
                batches={batchesByProduct[line.product._id]}
                racks={racks}
                onPick={(batchId, rack) => setLineBatch(line.product, line.unitType, batchId, rack)}
              />
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
          <option value="Credit">Credit</option>
        </select>
        {isCredit && !customer && (
          <p className="mt-1 text-xs text-danger">Select a customer above to bill this on credit.</p>
        )}
      </div>

      {isCredit && (
        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium text-text">Amount Received Now (₹)</label>
          <input
            type="number"
            min="0"
            max={total}
            step="0.01"
            value={amountReceived}
            onChange={(e) => setAmountReceived(e.target.value)}
            className={`${inputCls} w-32`}
            placeholder="0.00"
          />
        </div>
      )}

      <div className="mt-4 rounded-xl bg-surface p-4 text-sm text-text shadow-sm">
        <div className="flex justify-between"><span>Subtotal</span><span>₹{subtotal.toFixed(2)}</span></div>
        <div className="flex justify-between"><span>GST</span><span>₹{gstTotal.toFixed(2)}</span></div>
        {appliedDiscount > 0 && <div className="flex justify-between"><span>Discount</span><span>-₹{appliedDiscount.toFixed(2)}</span></div>}
        <div className="mt-1 flex justify-between border-t border-border pt-1 font-semibold"><span>Total</span><span>₹{total.toFixed(2)}</span></div>
        {isCredit && (
          <>
            <div className="flex justify-between text-muted"><span>Received Now</span><span>₹{receivedNow.toFixed(2)}</span></div>
            <div className="flex justify-between font-semibold text-danger"><span>Balance Due</span><span>₹{balanceDue.toFixed(2)}</span></div>
          </>
        )}
      </div>

      {shortLine && (
        <p className="mt-3 text-sm text-danger">
          Not enough stock of {shortLine.product.name}
          {shortLine.batch ? " in the selected batch/rack" : ""}. Reduce the quantity{shortLine.batch ? " or choose another batch or rack" : ""}.
        </p>
      )}
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
            disabled={saving}
            className="mt-2 rounded-lg bg-warning px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Override & Complete Payment
          </button>
        </div>
      )}

      <button
        onClick={() => submit(false)}
        disabled={saving || !canSubmit}
        className="mt-4 w-full rounded-lg bg-accent py-3 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:brightness-95"
      >
        {saving ? "Processing…" : "Payment Completed"}
      </button>
    </Layout>
  );
}
