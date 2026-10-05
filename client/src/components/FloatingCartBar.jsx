import { useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext";
import Icon from "./Icon";

export default function FloatingCartBar() {
  const { cartCount, cartTotal } = useCart();
  const navigate = useNavigate();

  if (cartCount === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4">
      <button
        onClick={() => navigate("/checkout")}
        className="slide-up group flex w-full max-w-md items-center justify-between gap-3 rounded-full border border-white/10 bg-gradient-to-r from-[#0C2A2F] via-[#0A3B3C] to-primary-dark py-2 pl-2 pr-5 text-white shadow-[0_24px_48px_-16px_rgba(7,26,34,0.65)] ring-1 ring-black/5 backdrop-blur hover:-translate-y-0.5"
      >
        <span className="flex items-center gap-3">
          <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#2FC1B0] to-primary shadow-[0_6px_16px_-6px_rgba(47,193,176,0.9)]">
            <Icon name="cart" size={18} />
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold ring-2 ring-[#0C2A2F] tnum">
              {cartCount}
            </span>
          </span>
          <span className="text-left leading-tight">
            <span className="block text-[11px] text-white/60">{cartCount} item{cartCount === 1 ? "" : "s"} in order</span>
            <span className="block font-display text-base font-bold tnum">₹{cartTotal.toFixed(2)}</span>
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          Checkout
          <Icon name="arrowRight" size={16} strokeWidth={2} className="transition-transform duration-300 group-hover:translate-x-1" />
        </span>
      </button>
    </div>
  );
}
