import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { getProduct, getProductBatches } from "../api/products";
import { useCart } from "../context/CartContext";
import ProductFormModal from "./ProductFormModal";

function batchStatus(expiryDate) {
  const now = new Date();
  const soonCutoff = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const d = new Date(expiryDate);
  if (d < now) return { label: "Expired", className: "text-danger" };
  if (d <= soonCutoff) return { label: "Expiring Soon", className: "text-warning" };
  return { label: "OK", className: "text-success" };
}

function availability(product) {
  if (product.qty <= 0) return { label: "Out of Stock", className: "bg-danger/15 text-danger" };
  if (product.qty <= product.lowStockThreshold) return { label: "Low Stock", className: "bg-warning/15 text-warning" };
  return { label: "Available", className: "bg-success/15 text-success" };
}

function stockDisplay(product) {
  if (product.soldAs === "pack-and-loose" && product.unitsPerPack) {
    const packs = Math.floor(product.qty / product.unitsPerPack);
    const loose = product.qty % product.unitsPerPack;
    return `${packs} ${product.packUnit}${packs === 1 ? "" : "s"}${loose ? ` + ${loose} ${product.looseUnitName}${loose === 1 ? "" : "s"}` : ""}`;
  }
  return `${product.qty} ${product.packUnit}${product.qty === 1 ? "" : "s"}`;
}

// Right-side detail drawer for a product. Lives inline (flex sibling of the
// product grid) on md+ screens so the grid narrows to make room for it; on
// small screens it becomes a full-screen overlay instead since there's no
// spare width to share. Switching the product being viewed just changes
// `productId` and this re-fetches in place - the drawer itself never unmounts.
export default function ProductDetailPanel({ productId, isAdmin, onClose, onChanged }) {
  const { addToCart } = useCart();
  const [product, setProduct] = useState(null);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [packQty, setPackQty] = useState(1);
  const [looseQty, setLooseQty] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getProduct(productId).then((data) => {
      if (cancelled) return;
      setProduct(data);
      setLoading(false);
      setPackQty(1);
      setLooseQty(1);
    });
    if (isAdmin) {
      getProductBatches(productId).then((data) => {
        if (!cancelled) setBatches(data);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [productId, isAdmin]);

  const handleSaved = (updated) => {
    setProduct(updated);
    setShowEdit(false);
    onChanged?.();
  };

  const isOut = product ? product.qty <= 0 : true;
  const isPackAndLoose = product?.soldAs === "pack-and-loose";
  const avail = product ? availability(product) : null;

  const handleAddPack = () => {
    if (isOut || packQty < 1) return;
    addToCart(product, "pack", packQty);
    toast.success(`Added ${packQty} ${product.packUnit}${packQty === 1 ? "" : "s"} of ${product.name}`);
    setPackQty(1);
  };

  const handleAddLoose = () => {
    if (isOut || looseQty < 1) return;
    addToCart(product, "loose", looseQty);
    toast.success(`Added ${looseQty} ${product.looseUnitName}${looseQty === 1 ? "" : "s"} of ${product.name}`);
    setLooseQty(1);
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={onClose} />

      <aside className="fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-y-auto bg-surface shadow-xl sm:w-[420px] md:sticky md:inset-auto md:top-6 md:z-auto md:w-[380px] md:max-h-[calc(100vh-3rem)] md:shrink-0 md:rounded-2xl md:shadow-sm lg:w-[420px]">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-display text-lg font-semibold text-text">Product Details</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-bg hover:text-text">
            ✕
          </button>
        </div>

        {loading && <p className="p-4 text-sm text-muted">Loading…</p>}

        {!loading && product && (
          <div className="flex flex-1 flex-col gap-4 p-4">
            <div className="flex h-40 items-center justify-center rounded-xl bg-bg">
              {product.image ? (
                <img src={product.image} alt={product.name} className="h-full w-full rounded-xl object-cover" />
              ) : (
                <span className="text-5xl">💊</span>
              )}
            </div>

            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-display text-xl font-semibold text-text">{product.name}</h3>
                <p className="font-mono text-xs text-muted">{product.productCode}</p>
              </div>
              {isAdmin && (
                <button
                  onClick={() => setShowEdit(true)}
                  className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-primary hover:bg-bg"
                >
                  Edit
                </button>
              )}
            </div>

            <span className={`w-fit rounded-full px-2 py-0.5 text-xs font-semibold ${avail.className}`}>{avail.label}</span>

            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <div>
                <dt className="text-xs text-muted">Category</dt>
                <dd className="text-text">{product.category?.name || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Strength</dt>
                <dd className="text-text">{product.strengthValue ? `${product.strengthValue} ${product.strengthUnit}` : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Pack Rate</dt>
                <dd className="font-mono text-text">₹{Number(product.packRate).toFixed(2)} / {product.packUnit}</dd>
              </div>
              {isPackAndLoose && (
                <div>
                  <dt className="text-xs text-muted">Loose Rate</dt>
                  <dd className="font-mono text-text">₹{Number(product.looseRate).toFixed(2)} / {product.looseUnitName}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-muted">GST</dt>
                <dd className="text-text">{product.gstPercent}%</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">HSN Code</dt>
                <dd className="text-text">{product.hsnCode || "—"}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-muted">Stock on Hand</dt>
                <dd className="text-text">
                  {stockDisplay(product)}{" "}
                  <span className="text-xs text-muted">(low stock alert below {product.lowStockThreshold})</span>
                </dd>
              </div>
            </dl>

            {isAdmin && (
              <div>
                <p className="mb-1.5 text-xs font-semibold text-muted">Batches on Hand</p>
                {batches.length === 0 && <p className="text-xs text-muted">No batches recorded yet.</p>}
                {batches.length > 0 && (
                  <div className="space-y-1.5">
                    {batches.map((b) => {
                      const status = batchStatus(b.expiryDate);
                      return (
                        <div key={b._id} className="rounded-lg bg-bg px-2.5 py-1.5 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-text">{b.batchNo}</span>
                            <span className={`font-semibold ${status.className}`}>{status.label}</span>
                          </div>
                          <div className="mt-0.5 flex items-center justify-between text-muted">
                            <span>
                              Expires{" "}
                              {new Date(b.expiryDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                              {" · Received "}
                              {new Date(b.receivedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                            </span>
                            <span>Qty {b.qtyRemaining}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="mt-auto space-y-3 border-t border-border pt-4">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  value={packQty}
                  onChange={(e) => setPackQty(Math.max(1, Number(e.target.value)))}
                  className="w-16 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text"
                />
                <button
                  onClick={handleAddPack}
                  disabled={isOut}
                  className="flex-1 rounded-lg bg-accent py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 hover:brightness-95"
                >
                  Add {product.packUnit}{packQty > 1 ? "s" : ""} to Cart
                </button>
              </div>

              {isPackAndLoose && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    value={looseQty}
                    onChange={(e) => setLooseQty(Math.max(1, Number(e.target.value)))}
                    className="w-16 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text"
                  />
                  <button
                    onClick={handleAddLoose}
                    disabled={isOut}
                    className="flex-1 rounded-lg border border-primary py-2 text-sm font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-40 hover:bg-bg"
                  >
                    Add {product.looseUnitName}{looseQty > 1 ? "s" : ""} to Cart
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </aside>

      {showEdit && product && <ProductFormModal product={product} onClose={() => setShowEdit(false)} onSaved={handleSaved} />}
    </>
  );
}
