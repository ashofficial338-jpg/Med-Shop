import { createContext, useContext, useEffect, useState } from "react";
import { useAuth } from "./AuthContext";

const CartContext = createContext(null);
const STORAGE_KEY = "ghm_cart";

function lineKey(productId, unitType) {
  return `${productId}:${unitType}`;
}

const OWNER_KEY = "ghm_cart_owner";

function readStoredCart() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }) {
  const { user } = useAuth();
  const userId = user?._id || user?.id || null;
  const [lines, setLines] = useState(readStoredCart);

  // The cart belongs to whoever built it. Another user signing in at a shared
  // counter starts with an empty cart; the same user signing back in (e.g.
  // after their session expired mid-sale) gets theirs back.
  useEffect(() => {
    if (!userId) return;
    let owner = null;
    try {
      owner = localStorage.getItem(OWNER_KEY);
    } catch {
      /* storage blocked */
    }
    if (owner && owner !== String(userId)) setLines((prev) => (prev.length ? [] : prev));
    try {
      localStorage.setItem(OWNER_KEY, String(userId));
    } catch {
      /* storage blocked */
    }
  }, [userId]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      /* storage full or blocked - the cart still works for this visit */
    }
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

  // Pin a line to one exact batch - and optionally one rack position of it
  // (null = automatic: earliest expiry first, primary rack first).
  const setLineBatch = (product, unitType, batch, rack = null) => {
    setLines((prev) =>
      prev.map((l) =>
        lineKey(l.product._id, l.unitType) === lineKey(product._id, unitType) ? { ...l, batch: batch || null, rack: batch ? rack : null } : l
      )
    );
  };

  // The cart is kept in the browser, so its product details (rates, GST,
  // units) can go stale. Checkout swaps in the current details from the
  // server, so the total on screen is the total that gets billed.
  const refreshProducts = (fresh) => {
    setLines((prev) => {
      let changed = false;
      const next = prev.map((l) => {
        const p = fresh[l.product._id];
        if (!p) return l;
        changed = true;
        return { ...l, product: { ...l.product, ...p } };
      });
      return changed ? next : prev;
    });
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
      value={{ lines, addToCart, updateQty, removeLine, setLineBatch, refreshProducts, clearCart, cartTotal, cartCount, lineTotal }}
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
