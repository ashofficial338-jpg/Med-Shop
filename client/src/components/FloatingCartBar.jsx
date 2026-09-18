import { useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext";

export default function FloatingCartBar() {
  const { cartCount, cartTotal } = useCart();
  const navigate = useNavigate();

  if (cartCount === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4">
      <button
        onClick={() => navigate("/checkout")}
        className="flex w-full max-w-md items-center justify-between rounded-full bg-primary-dark px-5 py-3 text-white shadow-xl transition hover:brightness-110"
      >
        <span className="text-sm font-medium">
          {cartCount} item{cartCount === 1 ? "" : "s"} · ₹{cartTotal.toFixed(2)}
        </span>
        <span className="text-sm font-semibold">Checkout →</span>
      </button>
    </div>
  );
}
