import { useState } from "react";

const norm = (s) => String(s || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\p{M}]/gu, "");

// Supplier box for Purchase Entry: pick a supplier, or just type a new name -
// it is added to the Supplier List when the purchase is saved. A name that is
// already in the list is linked to it, however it's typed. Blank = no supplier.
export default function SupplierPicker({ vendors, vendor, name, onPick, onType, locked, inputClassName, autoFocus }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1); // -1: nothing highlighted yet
  const key = norm(name);

  if (vendor) {
    return (
      <div className="flex min-h-[42px] items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm">
        <span className="min-w-0">
          <span className="block truncate font-semibold text-text">{vendor.name}</span>
          {vendor.outstandingPayable > 0 && <span className="block text-xs text-danger">You owe ₹{vendor.outstandingPayable.toFixed(2)}</span>}
        </span>
        {!locked && (
          <button type="button" onClick={() => onPick(null)} className="shrink-0 text-xs font-semibold text-primary hover:underline">
            Change
          </button>
        )}
      </div>
    );
  }

  const live = vendors.filter((v) => v.isActive !== false);
  const matches = live.filter((v) => !key || norm(v.name).includes(key) || String(v.phone || "").includes(name.trim())).slice(0, 8);
  const exact = live.find((v) => norm(v.name) === key);

  return (
    <div className="relative">
      <input
        type="text"
        aria-label="Supplier"
        autoComplete="off"
        autoFocus={autoFocus}
        maxLength={150}
        value={name}
        disabled={locked}
        placeholder="Type the supplier's name (blank = no supplier)"
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Typed in full: that's the supplier meant.
          if (key && exact) onPick(exact);
          setTimeout(() => setOpen(false), 150);
        }}
        onChange={(e) => {
          onType(e.target.value);
          setActive(-1);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (!open || matches.length === 0) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (e.key === "ArrowDown" ? (a + 1) % matches.length : a <= 0 ? matches.length - 1 : a - 1));
          } else if (e.key === "Enter" && (active >= 0 || exact)) {
            // Only a highlighted or fully typed supplier is picked.
            e.preventDefault();
            e.stopPropagation();
            onPick(active >= 0 ? matches[active] : exact);
            setOpen(false);
          }
        }}
        className={inputClassName}
      />
      {open && !locked && matches.length > 0 && (
        <ul className="absolute left-0 top-full z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-lg">
          {matches.map((v, i) => (
            <li key={v._id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  onPick(v);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${i === active ? "bg-primary-soft" : ""}`}
              >
                <span className="font-medium text-text">{v.name}</span>
                <span className="shrink-0 text-xs text-muted">{v.outstandingPayable > 0 ? `You owe ₹${v.outstandingPayable.toFixed(2)}` : v.phone || ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {key && !exact && !locked && !(open && matches.length > 0) && <p className="mt-1 text-xs font-semibold text-secondary">New supplier – added to your Supplier List when saved.</p>}
    </div>
  );
}
