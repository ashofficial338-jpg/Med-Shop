import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "./Icon";
import { getStockReport, listProducts } from "../api/products";

const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_MS = 60 * 1000;

// Every page mounts its own Layout, so keep the last result briefly instead of
// refetching stock on each navigation.
let cache = { at: 0, key: "", items: [] };

async function fetchAlerts(isAdmin) {
  const key = isAdmin ? "admin" : "staff";
  if (cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.items;

  let items = [];
  if (isAdmin) {
    const { rows } = await getStockReport();
    const now = Date.now();
    for (const r of rows) {
      if (r.nearestExpiry) {
        const days = Math.ceil((new Date(r.nearestExpiry) - now) / DAY_MS);
        if (days < 0) items.push({ id: `exp-${r.productId}`, kind: "expired", title: r.name, detail: "A batch has expired", to: "/stock", rank: 0 });
        else if (days <= 30)
          items.push({ id: `exp-${r.productId}`, kind: "expiring", title: r.name, detail: `Batch expires in ${days} day${days === 1 ? "" : "s"}`, to: "/stock", rank: 2 });
      }
      if (r.isOut) items.push({ id: `out-${r.productId}`, kind: "out", title: r.name, detail: "Out of stock", to: "/stock", rank: 1 });
      else if (r.isLowStock) items.push({ id: `low-${r.productId}`, kind: "low", title: r.name, detail: `Low stock · ${r.qtyDisplay} left`, to: "/stock", rank: 3 });
    }
  } else {
    const low = await listProducts({ availability: "low" });
    items = low.map((p) => ({ id: `low-${p._id}`, kind: "low", title: p.name, detail: `Low stock · ${p.qty} left`, to: "/products", rank: 3 }));
  }
  items.sort((a, b) => a.rank - b.rank);
  cache = { at: Date.now(), key, items };
  return items;
}

const KIND = {
  expired: { icon: "alert", cls: "bg-danger/10 text-danger", label: "Expired" },
  out: { icon: "boxes", cls: "bg-danger/10 text-danger", label: "Out of stock" },
  expiring: { icon: "hourglass", cls: "bg-warning/10 text-warning", label: "Expiring" },
  low: { icon: "boxes", cls: "bg-warning/10 text-warning", label: "Low stock" },
};

export default function NotificationsMenu({ open, onOpenChange, onCountChange, isAdmin }) {
  const [items, setItems] = useState(cache.items);
  const ref = useRef(null);

  useEffect(() => {
    let alive = true;
    fetchAlerts(isAdmin)
      .then((list) => {
        if (!alive) return;
        setItems(list);
        onCountChange?.(list.length);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isAdmin, onCountChange]);

  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) onOpenChange(false);
    }
    function onKey(e) {
      if (e.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => onOpenChange(!open)}
        aria-label={`Notifications${items.length ? ` (${items.length})` : ""}`}
        aria-expanded={open}
        className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface text-muted transition hover:border-primary/30 hover:text-primary"
      >
        <Icon name="bell" />
        {items.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white ring-2 ring-surface tnum">
            {items.length > 99 ? "99+" : items.length}
          </span>
        )}
      </button>

      {open && (
        <div className="fade-up absolute right-0 z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-lift)]">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-text">Notifications</p>
            <span className="text-xs text-muted">{items.length} alert{items.length === 1 ? "" : "s"}</span>
          </div>
          <div className="thin-scroll max-h-96 overflow-y-auto">
            {items.length === 0 && (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-soft text-primary">
                  <Icon name="check" />
                </span>
                <p className="text-sm font-medium text-text">All clear</p>
                <p className="text-xs text-muted">No stock or expiry alerts right now.</p>
              </div>
            )}
            {items.slice(0, 30).map((n) => {
              const k = KIND[n.kind];
              return (
                <Link
                  key={n.id}
                  to={n.to}
                  onClick={() => onOpenChange(false)}
                  className="flex items-start gap-3 border-b border-border/60 px-4 py-3 last:border-0 hover:bg-bg"
                >
                  <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${k.cls}`}>
                    <Icon name={k.icon} size={16} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-text">{n.title}</span>
                    <span className="block text-xs text-muted">{n.detail}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
