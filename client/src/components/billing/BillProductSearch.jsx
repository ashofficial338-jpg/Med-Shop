import { useEffect, useRef, useState } from "react";
import Icon from "../Icon";
import { listProducts } from "../../api/products";
import { makerOf, stockLabel } from "../../utils/medicine";

const money = (n) => `₹${Number(n || 0).toFixed(2)}`;

// The one search box on the bill: type a medicine's name, composition or code
// and press Enter, or scan its barcode. Picking adds it to the bill and leaves
// the cursor here for the next one.
export default function BillProductSearch({ onAdd, inputRef }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const [note, setNote] = useState("");
  const seq = useRef(0);
  const term = q.trim();

  useEffect(() => {
    const mine = ++seq.current;
    if (!term) {
      setResults([]);
      setSearching(false);
      return undefined;
    }
    setSearching(true);
    const t = setTimeout(() => {
      listProducts({ q: term })
        .then((list) => {
          if (mine !== seq.current) return;
          // In-stock products first; the rest stay visible so it's clear
          // they exist but have run out.
          setResults([...list].sort((a, b) => Number(b.qty > 0) - Number(a.qty > 0)).slice(0, 8));
          setActive(0);
        })
        .catch(() => mine === seq.current && setResults([]))
        .finally(() => mine === seq.current && setSearching(false));
    }, 200);
    return () => clearTimeout(t);
  }, [term]);

  const add = (p) => {
    if (p.qty <= 0) {
      setNote(`${p.name} is out of stock. Enter a purchase to add stock.`);
      return;
    }
    onAdd(p);
    seq.current += 1; // drop any search still on its way
    setQ("");
    setResults([]);
    setNote("");
    setSearching(false);
  };

  const onKeyDown = async (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!results.length) return;
      e.preventDefault();
      setActive((a) => (a + (e.key === "ArrowDown" ? 1 : results.length - 1)) % results.length);
      return;
    }
    if (e.key === "Escape") {
      setQ("");
      setNote("");
      return;
    }
    if (e.key !== "Enter" || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    if (!term) return;
    if (!searching && results.length) {
      add(results.find((p) => p.barcode && p.barcode === term) || results[active]);
      return;
    }
    // A scanner types the code and presses Enter before results arrive.
    const mine = ++seq.current;
    setSearching(true);
    const list = await listProducts({ q: term }).catch(() => []);
    if (mine !== seq.current) return;
    setSearching(false);
    const hit = list.find((p) => p.barcode && p.barcode === term) || (list.length === 1 ? list[0] : null);
    if (hit) add(hit);
    else if (list.length) {
      setResults(list.slice(0, 8));
      setActive(0);
    } else setNote(`Nothing found for “${term}”.`);
  };

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-4 top-[26px] -translate-y-1/2 text-muted">
        <Icon name="search" size={18} />
      </span>
      <input
        ref={inputRef}
        type="text"
        autoFocus
        autoComplete="off"
        aria-label="Add a product to the bill"
        placeholder="Type a medicine name or scan its barcode, then press Enter"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setNote("");
        }}
        onKeyDown={onKeyDown}
        className="h-[52px] w-full rounded-xl border border-border bg-surface pl-11 pr-4 text-base text-text shadow-sm focus:border-primary focus:outline-none"
      />
      {term && (results.length > 0 || searching) && (
        <ul className="absolute z-30 mt-1 max-h-96 w-full overflow-y-auto rounded-xl border border-border bg-surface py-1 shadow-lg" role="listbox">
          {searching && results.length === 0 && <li className="px-4 py-3 text-sm text-muted">Searching…</li>}
          {results.map((p, i) => {
            const out = p.qty <= 0;
            return (
              <li key={p._id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => add(p)}
                  className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left ${i === active ? "bg-primary-soft" : ""} ${out ? "opacity-60" : ""}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-text">{p.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {[makerOf(p), p.composition || p.genericName, p.rack && `📍 ${p.rack}`].filter(Boolean).join(" · ") || p.productCode}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-semibold tabular-nums text-text">{money(p.packRate)}</span>
                    <span className={`block text-xs ${out ? "font-semibold text-danger" : "text-muted"}`}>{out ? "Out of stock" : stockLabel(p)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {note && (
        <p className="mt-1.5 text-sm text-warning" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
