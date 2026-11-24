import { useEffect, useState } from "react";
import { createVendor } from "../../api/vendors";

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Supplier box for Purchase Entry. Pick a supplier, add a new one on the spot,
// or leave it blank for a purchase with no supplier. A name that is typed but
// not added stays on this purchase only (no account, paid in full).
export default function SupplierPicker({ vendors, vendor, name, knownNames = [], onPick, onType, onCreated, locked, inputClassName, autoFocus }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const key = norm(name);

  useEffect(() => setActive(0), [key]);

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

  const matches = vendors.filter((v) => v.isActive !== false && (!key || norm(v.name).includes(key) || String(v.phone || "").includes(name.trim()))).slice(0, 8);
  const exact = vendors.find((v) => v.isActive !== false && norm(v.name) === key);
  const names = key ? knownNames.filter((n) => norm(n).includes(key) && norm(n) !== key && !vendors.some((v) => norm(v.name) === norm(n))).slice(0, 3) : [];

  const add = async () => {
    if (adding || !name.trim()) return;
    setAdding(true);
    setError("");
    try {
      const created = await createVendor({ name: name.trim() });
      onCreated(created);
      onPick(created);
      setOpen(false);
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't add the supplier. Please try again.");
    } finally {
      setAdding(false);
    }
  };

  const options = [
    ...matches.map((v) => ({ id: v._id, label: v.name, hint: v.outstandingPayable > 0 ? `You owe ₹${v.outstandingPayable.toFixed(2)}` : v.phone || "", run: () => onPick(v) })),
    ...names.map((n) => ({ id: `n:${n}`, label: n, hint: "Used before, no account", run: () => onType(n) })),
    ...(key && !exact ? [{ id: "add", label: adding ? "Adding…" : `+ Add “${name.trim()}” as a supplier`, hint: "Keeps an account, can buy on credit", run: add, add: true }] : []),
  ];

  return (
    <div className="relative">
      <input
        type="text"
        autoComplete="off"
        autoFocus={autoFocus}
        maxLength={100}
        value={name}
        disabled={locked}
        placeholder="Type to find or add a supplier (blank = no supplier)"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          onType(e.target.value);
          setOpen(true);
          setError("");
        }}
        onKeyDown={(e) => {
          if (!open || options.length === 0) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
          } else if (e.key === "Enter" && key) {
            e.preventDefault();
            e.stopPropagation();
            options[Math.min(active, options.length - 1)].run();
            setOpen(false);
          } else if (e.key === "Escape") setOpen(false);
        }}
        className={inputClassName}
      />
      {open && !locked && options.length > 0 && (
        <ul className="absolute left-0 top-full z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-lg">
          {options.map((o, i) => (
            <li key={o.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  o.run();
                  if (!o.add) setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${i === active ? "bg-primary-soft" : ""}`}
              >
                <span className={o.add ? "font-semibold text-primary" : "font-medium text-text"}>{o.label}</span>
                <span className="shrink-0 text-xs text-muted">{o.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      {key && !open && !locked && (
        <p className="mt-1 text-xs text-muted">
          No account for this name – the purchase is paid in full.{" "}
          <button type="button" onClick={add} className="font-semibold text-primary hover:underline">
            Add as a supplier
          </button>{" "}
          to buy on credit.
        </p>
      )}
    </div>
  );
}
