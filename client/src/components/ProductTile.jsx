import { toast } from "react-toastify";
import { useCart } from "../context/CartContext";
import { resolveAssetUrl } from "../api/client";

function availability(product) {
  if (product.qty <= 0) return { label: "Out of Stock", className: "bg-danger/15 text-danger" };
  if (product.qty <= product.lowStockThreshold) return { label: "Low Stock", className: "bg-warning/15 text-warning" };
  return { label: "Available", className: "bg-success/15 text-success" };
}

export default function ProductTile({ product, isAdmin, onEdit, onOpen }) {
  const { addToCart } = useCart();
  const avail = availability(product);
  const isOut = product.qty <= 0;
  const isPackAndLoose = product.soldAs === "pack-and-loose";

  const handleAddPack = (e) => {
    e.stopPropagation();
    if (isOut) return;
    addToCart(product, "pack", 1);
    toast.success(`Added 1 ${product.packUnit} of ${product.name}`);
  };

  const handleEdit = (e) => {
    e.stopPropagation();
    onEdit(product);
  };

  const handleOpen = () => onOpen(product._id);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleOpen();
        }
      }}
      className="flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-transparent transition hover:shadow-md hover:ring-primary/20"
    >
      <div className="flex h-28 items-center justify-center bg-bg">
        {product.image ? (
          <img src={resolveAssetUrl(product.image)} alt={product.name} className="h-full w-full object-cover" />
        ) : (
          <span className="text-3xl">💊</span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium leading-tight text-text">{product.name}</p>
            <p className="font-mono text-xs text-muted">{product.productCode}</p>
          </div>
          {isAdmin && (
            <button
              onClick={handleEdit}
              aria-label="Edit product"
              className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-primary hover:bg-bg"
            >
              Edit
            </button>
          )}
        </div>

        <p className="truncate text-xs text-muted">
          {product.category?.name}
          {product.strengthValue ? ` · ${product.strengthValue} ${product.strengthUnit}` : ""}
        </p>

        {/* Spacer keeps the price/stock/button block pinned to the bottom of the
            card, so every card in a row lines up regardless of name length. */}
        <div className="flex-1" />

        <span className="font-mono text-sm font-semibold text-text">
          ₹{Number(product.packRate).toFixed(2)}
          {isPackAndLoose && (
            <span className="ml-1 text-xs font-normal text-muted">/ ₹{Number(product.looseRate).toFixed(2)} {product.looseUnitName}</span>
          )}
        </span>

        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-xs text-muted">Tap for details</span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${avail.className}`}>{avail.label}</span>
        </div>

        <button
          onClick={handleAddPack}
          disabled={isOut}
          className="mt-2 w-full rounded-lg bg-accent py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 hover:brightness-95"
        >
          {isPackAndLoose ? `Add 1 ${product.packUnit}` : "Add to Cart"}
        </button>
      </div>
    </div>
  );
}
