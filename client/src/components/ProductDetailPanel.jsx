import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { getProduct, getProductBatches, deactivateProduct, deleteBatch } from "../api/products";
import { stockDisplay } from "../utils/stock";
import { resolveAssetUrl } from "../api/client";
import { useCart } from "../context/CartContext";
import ProductFormModal from "./ProductFormModal";
import BatchEditModal from "./BatchEditModal";
import Icon from "./Icon";

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

// Right-side detail drawer for a product. Lives inline (flex sibling of the
// product grid) on md+ screens so the grid narrows to make room for it; on
// small screens it becomes a full-screen overlay instead since there's no
// spare width to share. Switching the product being viewed just changes
// `productId` and this re-fetches in place - the drawer itself never unmounts.
// canEdit / canDelete (product) and canEditStock / canDeleteStock (its batches)
// follow the user's permissions, so staff an Admin trusted can change them too.
// Batches show to admins and to anyone allowed to edit or delete stock.
export default function ProductDetailPanel({
  productId,
  isAdmin,
  canEdit = isAdmin,
  canDelete = isAdmin,
  canEditStock = isAdmin,
  canDeleteStock = isAdmin,
  onClose,
  onChanged,
  onDeleted,
}) {
  const showBatches = isAdmin || canEditStock || canDeleteStock;
  const { addToCart } = useCart();
  const [product, setProduct] = useState(null);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [packQty, setPackQty] = useState(1);
  const [looseQty, setLooseQty] = useState(1);
  const [editingBatch, setEditingBatch] = useState(null);
  const [reloadKey, setReloadKey] = useState(0); // bumped after a stock entry changes

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
    if (showBatches) {
      getProductBatches(productId).then((data) => {
        if (!cancelled) setBatches(data);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [productId, showBatches, reloadKey]);

  const stockChanged = () => {
    setEditingBatch(null);
    setReloadKey((k) => k + 1);
    onChanged?.();
  };

  const handleDeleteBatch = async (b) => {
    const left = b.qtyRemaining ? ` Its remaining ${b.qtyRemaining} will be written off.` : "";
    if (!window.confirm(`Delete stock entry ${b.batchNo}?${left}`)) return;
    try {
      await deleteBatch(product._id, b._id);
      toast.success(`Stock entry ${b.batchNo} deleted.`);
      stockChanged();
    } catch (err) {
      toast.error(err.response?.data?.message || "Something went wrong. Please try again.");
    }
  };

  const handleSaved = (updated) => {
    setProduct(updated);
    setShowEdit(false);
    onChanged?.();
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete "${product.name}"? It will no longer appear in Products or at checkout. Past bills and purchases keep their records.`)) return;
    setDeleting(true);
    try {
      await deactivateProduct(product._id);
      toast.success(`${product.name} deleted.`);
      onDeleted?.();
    } catch (err) {
      toast.error(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setDeleting(false);
    }
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
      <div className="fade-in fixed inset-0 z-40 bg-[#07181E]/45 backdrop-blur-sm md:hidden" onClick={onClose} />

      <aside className="slide-in-right fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-y-auto bg-surface shadow-xl sm:w-[420px] md:sticky md:inset-auto md:top-6 md:z-auto md:w-[380px] md:max-h-[calc(100vh-3rem)] md:shrink-0 md:rounded-2xl md:border md:border-border md:shadow-[var(--shadow-lift)] lg:w-[420px]">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-display text-lg font-semibold text-text">Product Details</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-bg hover:text-text">
            ✕
          </button>
        </div>

        {loading && <p className="p-4 text-sm text-muted">Loading…</p>}

        {!loading && product && (
          <div className="flex flex-1 flex-col gap-4 p-4">
            <div className="flex h-40 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-primary-soft via-[#F1F7FA] to-info-soft">
              {product.image ? (
                <img src={resolveAssetUrl(product.image)} alt={product.name} className="h-full w-full rounded-xl object-cover" />
              ) : (
                <span className="flex h-20 w-20 items-center justify-center rounded-3xl bg-white/80 text-4xl shadow-[0_14px_30px_-14px_rgba(14,124,116,0.6)]">💊</span>
              )}
            </div>

            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-display text-xl font-semibold text-text">{product.name}</h3>
                <p className="font-mono text-xs text-muted">{product.productCode}</p>
                <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">
                  <Icon name="rack" size={13} />
                  {product.rack ? `Rack ID: ${product.rack}` : "No Rack"}
                </p>
              </div>
              {(canEdit || canDelete) && (
                <div className="flex shrink-0 gap-2">
                  {canEdit && (
                    <button
                      onClick={() => setShowEdit(true)}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-primary hover:bg-bg"
                    >
                      Edit
                    </button>
                  )}
                  {canDelete && (
                    <button
                      onClick={handleDelete}
                      disabled={deleting}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
                    >
                      {deleting ? "Deleting…" : "Delete"}
                    </button>
                  )}
                </div>
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

            {showBatches && (
              <div>
                <p className="mb-1.5 text-xs font-semibold text-muted">Stock (batches on hand)</p>
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
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <span className="text-muted">{b.rack ? `Rack ID: ${b.rack}` : "No Rack"}</span>
                            {(canEditStock || canDeleteStock) && (
                              <span className="flex gap-1">
                                {canEditStock && (
                                  <button onClick={() => setEditingBatch(b)} className="rounded-md px-2 py-0.5 font-semibold text-primary hover:bg-primary-soft">
                                    Edit
                                  </button>
                                )}
                                {canDeleteStock && (
                                  <button onClick={() => handleDeleteBatch(b)} className="rounded-md px-2 py-0.5 font-semibold text-danger hover:bg-danger/10">
                                    Delete
                                  </button>
                                )}
                              </span>
                            )}
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
      {editingBatch && product && (
        <BatchEditModal product={product} batch={editingBatch} isAdmin={isAdmin} onClose={() => setEditingBatch(null)} onSaved={stockChanged} />
      )}
    </>
  );
}
