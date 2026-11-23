import { useEffect, useRef, useState } from "react";
import { listProducts, similarProducts } from "../api/products";

// Product name box for Sales Entry and Purchase Entry: type to see matching
// products from the Product List and pick one, or keep typing a new name -
// it's added to the Product List when the entry is saved. Before that,
// products with the same or a close name are shown, so the same item isn't
// added twice.
//
// `products` (optional): an already-loaded product list to search locally;
// without it the server is searched. `preferred` sorts some products first.

const fmt = (n) => Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

export default function ProductPicker({ value, productId, onChange, onPick, products, preferred, inputRef, disabled, className, placeholder = "Type product name" }) {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [similar, setSimilar] = useState([]);
  const typed = useRef(false);
  // Kept in a ref: a new function each render must not re-run the search.
  const preferredRef = useRef(preferred);
  useEffect(() => {
    preferredRef.current = preferred;
  });
  const q = value.trim();

  // Matching products for the dropdown.
  useEffect(() => {
    if (!typed.current) return undefined;
    if (products) {
      const key = norm(q);
      const list = products
        .filter((p) => !key || norm(p.name).includes(key) || norm(p.productCode).includes(key))
        .sort((a, b) => Number(Boolean(preferredRef.current?.(b))) - Number(Boolean(preferredRef.current?.(a))))
        .slice(0, 10);
      setResults(list);
      setActive(0);
      return undefined;
    }
    if (q.length < 2) {
      setResults([]);
      return undefined;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      listProducts({ q })
        .then((list) => {
          if (cancelled) return;
          setResults(list.slice(0, 8));
          setActive(0);
        })
        .catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, products]);

  // A new name: look for the same or similar products already in the list.
  useEffect(() => {
    if (productId || q.length < 2) {
      setSimilar([]);
      return undefined;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      similarProducts(q)
        .then((list) => !cancelled && setSimilar(list))
        .catch(() => {});
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, productId]);

  const pick = (p) => {
    typed.current = false;
    setOpen(false);
    setSimilar([]);
    onPick(p);
  };

  const showList = open && results.length > 0;
  const exact = similar.find((p) => p.exact);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={value}
        disabled={disabled}
        autoComplete="off"
        maxLength={150}
        placeholder={placeholder}
        className={className}
        onFocus={() => {
          if (products && !productId) {
            typed.current = true;
            setOpen(true);
          }
        }}
        onChange={(e) => {
          typed.current = true;
          setOpen(true);
          onChange(e.target.value);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!showList) return;
          if (["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(e.key)) {
            e.preventDefault();
            e.stopPropagation();
          }
          if (e.key === "ArrowDown") setActive((a) => (a + 1) % results.length);
          if (e.key === "ArrowUp") setActive((a) => (a - 1 + results.length) % results.length);
          if (e.key === "Enter") pick(results[active]);
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {showList && (
        <ul className="absolute left-0 top-full z-30 mt-1 max-h-64 w-full min-w-[260px] overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-lg">
          {results.map((p, i) => (
            <li key={p._id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p)}
                className={`block w-full px-3 py-1.5 text-left text-sm ${i === active ? "bg-primary-soft" : "hover:bg-bg"}`}
              >
                <span className="font-medium text-text">{p.name}</span>
                <span className="ml-2 text-xs text-muted">
                  {p.productCode} · ₹{fmt(p.packRate)} · GST {p.gstPercent}%
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Status under a typed (not picked) name. */}
      {!disabled && !productId && q.length >= 2 && !showList && (
        <div className="mt-1 text-[11px] leading-snug">
          {exact ? (
            <span className="text-muted">
              Already in Product List:{" "}
              <button type="button" onClick={() => pick(exact)} className="font-semibold text-primary underline">
                {exact.name} ({exact.productCode})
              </button>{" "}
              - it will be used, not duplicated.
            </span>
          ) : (
            <>
              <span className="font-semibold text-secondary">New product</span>
              <span className="text-muted"> - added to Product List when saved.</span>
              {similar.length > 0 && (
                <span className="block text-warning">
                  Similar:{" "}
                  {similar.map((p, i) => (
                    <span key={p._id}>
                      {i > 0 && ", "}
                      <button type="button" onClick={() => pick(p)} className="font-semibold underline">
                        {p.name}
                      </button>
                    </span>
                  ))}
                </span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
