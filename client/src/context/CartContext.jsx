import { createContext, useContext, useEffect, useState } from "react";

const CartContext = createContext(null);
const STORAGE_KEY = "ghm_cart";

function lineKey(productId, unitType) {
  return `${productId}:${unitType}`;
}

export function CartProvider({ children }) {
  const [lines, setLines] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  }, [lines]);

  const addToCart = (product, unitType, qtyToAdd = 1) => {
    setLines((prev) => {
      const key = lineKey(product._id, unitType);
      const existing = prev.find((l) => lineKey(l.product._id, l.unitType) === key);
      if (existing) {
        return prev.map((l) =>
          lineKey(l.product._id, l.unitType) === key ? { ...l, qty: l.qty + qtyToAdd } : l
        );
      }
      return [...prev, { product, unitType, qty: qtyToAdd }];
    });
  };

  const updateQty = (product, unitType, qty) => {
    setLines((prev) =>
      prev
        .map((l) => (lineKey(l.product._id, l.unitType) === lineKey(product._id, unitType) ? { ...l, qty } : l))
        .filter((l) => l.qty > 0)
    );
  };

  const removeLine = (product, unitType) => {
    setLines((prev) => prev.filter((l) => lineKey(l.product._id, l.unitType) !== lineKey(product._id, unitType)));
  };

  const clearCart = () => setLines([]);

  const lineTotal = (line) => {
    const rate = line.unitType === "pack" ? line.product.packRate : line.product.looseRate;
    return line.qty * rate;
  };

  const cartTotal = lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const cartCount = lines.reduce((sum, l) => sum + l.qty, 0);

  return (
    <CartContext.Provider
      value={{ lines, addToCart, updateQty, removeLine, clearCart, cartTotal, cartCount, lineTotal }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
