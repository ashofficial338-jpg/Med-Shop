import { toast } from "react-toastify";
import { useCart } from "../context/CartContext";
import { resolveAssetUrl } from "../api/client";
import Icon from "./Icon";

function availability(product) {
  if (product.qty <= 0) return { label: "Out of Stock", className: "bg-danger/10 text-danger ring-1 ring-danger/15", dot: "bg-danger" };
  if (product.qty <= product.lowStockThreshold) return { label: "Low Stock", className: "bg-warning/10 text-warning ring-1 ring-warning/15", dot: "bg-warning" };
  return { label: "Available", className: "bg-success/10 text-success ring-1 ring-success/15", dot: "bg-success" };
}

export default function ProductTile({ product, canEdit, onEdit, onOpen }) {
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
      className="card group flex h-full cursor-pointer flex-col overflow-hidden transition duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-1 hover:border-primary/25 hover:shadow-[var(--shadow-lift)]"
    >
      <div className="relative flex h-28 items-center justify-center overflow-hidden bg-gradient-to-br from-primary-soft via-[#F1F7FA] to-info-soft">
        {product.image ? (
          <img
            src={resolveAssetUrl(product.image)}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover transition duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.06]"
          />
        ) : (
          <>
            <div className="absolute -right-6 -top-10 h-28 w-28 rounded-full bg-white/70 blur-2xl" />
            <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-white/80 text-primary shadow-[0_10px_24px_-12px_rgba(14,124,116,0.6)] ring-1 ring-white transition duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:-rotate-12 group-hover:scale-110">
              <Icon name="pill" size={26} strokeWidth={1.6} />
            </span>
          </>
        )}
        <span className={`absolute left-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-semibold backdrop-blur ${avail.className}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${avail.dot}`} />
          {avail.label}
        </span>
        {product.rack && (
          <span className="absolute right-2.5 top-2.5 rounded-lg bg-primary px-2 py-0.5 text-[11px] font-bold text-white shadow-sm">
            Rack ID: {product.rack}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-display font-semibold leading-tight text-text transition-colors group-hover:text-primary">{product.name}</p>
            <p className="font-mono text-xs text-muted">{product.productCode}</p>
          </div>
          {canEdit && (
            <button
              onClick={handleEdit}
              aria-label="Edit product"
              className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-primary opacity-70 hover:bg-primary-soft hover:opacity-100"
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

        <span className="font-display text-base font-bold tracking-tight text-text tnum">
          ₹{Number(product.packRate).toFixed(2)}
          {isPackAndLoose && (
            <span className="ml-1 text-xs font-normal text-muted">/ ₹{Number(product.looseRate).toFixed(2)} {product.looseUnitName}</span>
          )}
        </span>

        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted transition-colors group-hover:text-primary">
          View details
          <Icon name="arrowRight" size={12} className="transition-transform duration-300 group-hover:translate-x-0.5" />
        </span>

        <button
          onClick={handleAddPack}
          disabled={isOut}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl bg-accent py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon name={isOut ? "close" : "cart"} size={14} strokeWidth={2} />
          {isOut ? "Unavailable" : isPackAndLoose ? `Add 1 ${product.packUnit}` : "Add to Cart"}
        </button>
      </div>
    </div>
  );
}
