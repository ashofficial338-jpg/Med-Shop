import { useMemo, useRef, useState } from "react";

export const PO_STATUSES = ["Draft", "Pending", "Partially Received", "Completed", "Cancelled"];
export const GST_RATES = [0, 5, 12, 18, 28];
export const inr = (v) => `₹${Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const showDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

const TONES = {
  Draft: "bg-bg text-muted",
  Pending: "bg-warning/15 text-warning",
  "Partially Received": "bg-primary/10 text-primary",
  Completed: "bg-success/15 text-success",
  Confirmed: "bg-success/15 text-success",
  Cancelled: "bg-danger/10 text-danger",
};

export function StatusBadge({ status }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONES[status] || "bg-bg text-muted"}`}>{status}</span>;
}

// Received / ordered as a thin bar.
export function ProgressBar({ received, ordered }) {
  const pct = ordered ? Math.min(100, Math.round((received / ordered) * 100)) : 0;
  return (
    <div className="flex items-center gap-2" title={`${received} of ${ordered} received`}>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-bg">
        <div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted">{received}/{ordered}</span>
    </div>
  );
}

// Type to find an existing item (name or code) and pick it. Items only -
// a purchase order can't create new products.
export function ItemSelect({ products, value, onPick, inputCls, autoFocus }) {
  const picked = products.find((p) => p._id === value);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef(null);
  const q = text.trim().toLowerCase();
  const matches = useMemo(
    () => (q ? products.filter((p) => `${p.name} ${p.productCode || ""}`.toLowerCase().includes(q)).slice(0, 12) : []),
    [products, q]
  );
  const choose = (p) => {
    onPick(p);
    setText("");
    setOpen(false);
  };
  return (
    <div className="relative" ref={box}>
      <input
        type="text"
        value={open || !picked ? text : picked.name}
        placeholder="Search item"
        autoFocus={autoFocus}
        onFocus={() => {
          setOpen(true);
          setText("");
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (!matches.length) return;
          if (!["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) return;
          e.preventDefault();
          e.stopPropagation();
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, matches.length - 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          else choose(matches[active]);
        }}
        className={inputCls}
        aria-label="Item"
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full min-w-[16rem] overflow-y-auto rounded-lg border border-border bg-surface shadow-lg" role="listbox">
          {matches.map((p, i) => (
            <li key={p._id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(p)}
                className={`block w-full px-3 py-2 text-left text-sm ${i === active ? "bg-primary-soft text-primary" : "text-text hover:bg-bg"}`}
              >
                {p.name} <span className="font-mono text-xs text-muted">({p.productCode})</span>
                <span className="float-right text-xs text-muted">Stock {p.qty}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
