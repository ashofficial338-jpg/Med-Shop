import { createContext, useContext, useEffect, useState } from "react";
import { useAuth } from "./AuthContext";
import { newEntryRef } from "../utils/entryRef";

const CartContext = createContext(null);
const STORAGE_KEY = "ghm_cart";
const REF_KEY = "ghm_cart_ref";

function lineKey(productId, unitType) {
  return `${productId}:${unitType}`;
}
const isLine = (l, product, unitType) => lineKey(l.product._id, l.unitType) === lineKey(product._id, unitType);

const OWNER_KEY = "ghm_cart_owner";

function readStoredCart() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

// The rate a line is billed at: the one typed on the bill (Admin), else the
// product's own price.
export function lineRate(line) {
  if (line.rate !== undefined && line.rate !== null) return line.rate;
  return Number(line.unitType === "pack" ? line.product.packRate : line.product.looseRate) || 0;
}

// The bill being made. It lives in the browser, so it survives moving around
// the app, a refresh or a session that expires mid-bill.
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
      // An empty cart is the start of a different bill.
      if (lines.length === 0) localStorage.removeItem(REF_KEY);
    } catch {
      /* storage full or blocked - the cart still works for this visit */
    }
  }, [lines]);

  // This bill's id for saving it exactly once (see utils/entryRef.js).
  const billRef = () => {
    try {
      const stored = localStorage.getItem(REF_KEY);
      if (stored) return stored;
      const ref = newEntryRef();
      localStorage.setItem(REF_KEY, ref);
      return ref;
    } catch {
      return newEntryRef();
    }
  };
  const renewBillRef = () => {
    try {
      localStorage.removeItem(REF_KEY);
    } catch {
      /* storage blocked */
    }
  };

  const addToCart = (product, unitType, qtyToAdd = 1) => {
    setLines((prev) => {
      const existing = prev.find((l) => isLine(l, product, unitType));
      if (existing) {
        return prev.map((l) => (isLine(l, product, unitType) ? { ...l, qty: l.qty + qtyToAdd } : l));
      }
      return [...prev, { product, unitType, qty: qtyToAdd }];
    });
  };

  const updateQty = (product, unitType, qty) => {
    setLines((prev) => prev.map((l) => (isLine(l, product, unitType) ? { ...l, qty } : l)).filter((l) => l.qty > 0));
  };

  const removeLine = (product, unitType) => {
    setLines((prev) => prev.filter((l) => !isLine(l, product, unitType)));
  };

  // Pin a line to one exact batch - and optionally one rack position of it
  // (null = automatic: earliest expiry first, primary rack first).
  const setLineBatch = (product, unitType, batch, rack = null) => {
    setLines((prev) => prev.map((l) => (isLine(l, product, unitType) ? { ...l, batch: batch || null, rack: batch ? rack : null } : l)));
  };

  // The selling rate typed on the bill; null goes back to the product's price.
  const setLineRate = (product, unitType, rate) => {
    setLines((prev) => prev.map((l) => (isLine(l, product, unitType) ? { ...l, rate } : l)));
  };

  // Pack <-> loose for one line (joining the other line if it exists).
  const setLineUnit = (product, unitType, nextUnit) => {
    if (unitType === nextUnit) return;
    setLines((prev) => {
      const line = prev.find((l) => isLine(l, product, unitType));
      if (!line) return prev;
      if (prev.some((l) => isLine(l, product, nextUnit))) {
        return prev.filter((l) => !isLine(l, product, unitType)).map((l) => (isLine(l, product, nextUnit) ? { ...l, qty: l.qty + line.qty } : l));
      }
      return prev.map((l) => (isLine(l, product, unitType) ? { ...l, unitType: nextUnit, rate: null } : l));
    });
  };

  // The cart is kept in the browser, so its product details (rates, GST,
  // units) can go stale. Billing swaps in the current details from the
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

  const lineTotal = (line) => Number((line.qty * lineRate(line)).toFixed(2));

  const cartTotal = lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const cartCount = lines.reduce((sum, l) => sum + l.qty, 0);

  return (
    <CartContext.Provider
      value={{
        lines,
        addToCart,
        updateQty,
        removeLine,
        setLineBatch,
        setLineRate,
        setLineUnit,
        refreshProducts,
        clearCart,
        billRef,
        renewBillRef,
        cartTotal,
        cartCount,
        lineTotal,
      }}
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
