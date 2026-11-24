import { useEffect, useRef, useState } from "react";
import { searchCustomers, getCustomer } from "../api/customers";

const norm = (s) => String(s || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\p{M}]/gu, "");

// Customer box for billing. Pick a customer, or just type a name or phone: an
// existing customer is linked, a new one is added to the Customer List when
// the bill is saved. Blank = walk-in.
//   selected / onSelect  the picked customer
//   typed / onTyped      { name, phone } being typed, or null
export default function CustomerPicker({ selected, onSelect, typed, onTyped, isAdmin }) {
  const [matches, setMatches] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1); // -1: nothing highlighted yet
  const debounceRef = useRef(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // What's in the search box: digits are a phone number, anything else a name.
  const query = typed ? typed.query : "";
  const term = query.trim();
  const isPhone = /^[\d\s+-]+$/.test(term) && /\d/.test(term);

  useEffect(() => {
    // Reset the purchase-history accordion whenever the picked customer changes.
    setHistoryOpen(false);
    setHistory(null);
  }, [selected?._id]);

  useEffect(() => {
    if (selected || !term) {
      setMatches([]);
      setSearching(false);
      return undefined;
    }
    setSearching(true);
    // `cancelled` drops an older, slower search so it can't overwrite the
    // results for what's typed now.
    let cancelled = false;
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await searchCustomers(term);
        if (!cancelled) setMatches(results);
      } catch {
        if (!cancelled) setMatches([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(debounceRef.current);
    };
  }, [term, selected]);

  const choose = (c) => {
    onSelect(c);
    onTyped(null);
    setMatches([]);
    setOpen(false);
  };
  const type = (value) => {
    setOpen(true);
    setActive(-1);
    const v = value.trim();
    const phoneLike = /^[\d\s+-]+$/.test(v) && /\d/.test(v);
    onTyped(v ? { query: value, name: phoneLike ? "" : v, phone: phoneLike ? v.replace(/\D/g, "").slice(-10) : typed?.phone && !typed.query.match(/^\d/) ? typed.phone : "" } : null);
  };

  const exact = term && !isPhone ? matches.find((c) => norm(c.name) === norm(term) && (!typed?.phone || !c.phone || c.phone === typed.phone)) : matches.find((c) => c.phone && c.phone === typed?.phone);

  const toggleHistory = async () => {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    setHistoryOpen(true);
    if (history) return;
    setLoadingHistory(true);
    try {
      const data = await getCustomer(selected._id);
      setHistory(data.bills || []);
    } catch {
      setHistory(null);
      setHistoryOpen(false);
    } finally {
      setLoadingHistory(false);
    }
  };

  if (selected) {
    return (
      <div>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
          <span className="min-w-0 text-text">
            <span className="block truncate font-semibold">{selected.name}</span>
            <span className="block text-xs text-muted">
              {selected.phone}
              {selected.outstandingBalance > 0 && (
                <span className="font-semibold text-danger">
                  {selected.phone ? " · " : ""}Owes ₹{selected.outstandingBalance.toFixed(2)}
                </span>
              )}
            </span>
          </span>
          <button type="button" onClick={() => onSelect(null)} className="shrink-0 text-xs font-semibold text-primary hover:underline">
            Change
          </button>
        </div>

        {isAdmin && (
          <div className="mt-2 overflow-hidden rounded-lg border border-border">
            <button type="button" onClick={toggleHistory} className="flex w-full items-center justify-between bg-bg px-3 py-2 text-left text-xs font-semibold text-text hover:bg-border/40">
              Past bills
              <span className="text-muted">{historyOpen ? "▲" : "▼"}</span>
            </button>
            {historyOpen && (
              <div className="max-h-56 space-y-1.5 overflow-y-auto p-2">
                {loadingHistory && <p className="p-2 text-xs text-muted">Loading…</p>}
                {!loadingHistory && history?.length === 0 && <p className="p-2 text-xs text-muted">No previous bills.</p>}
                {!loadingHistory &&
                  history?.map((b) => (
                    <div key={b._id} className="flex justify-between rounded-lg bg-bg px-2.5 py-1.5 text-xs">
                      <span className="text-text">
                        {b.billNo}
                        {b.paymentStatus === "void" && <span className="ml-2 text-danger">VOID</span>}
                        <span className="ml-2 text-muted">{new Date(b.createdAt).toLocaleDateString()}</span>
                      </span>
                      <span className="font-mono text-text">₹{b.total.toFixed(2)}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  const inputCls = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none";
  const showList = open && matches.length > 0;

  return (
    <div className="relative">
      <input
        type="text"
        aria-label="Customer"
        autoComplete="off"
        maxLength={100}
        placeholder="Name or phone (blank = walk-in)"
        value={query}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => type(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if ((e.key === "ArrowDown" || e.key === "ArrowUp") && showList) {
            e.preventDefault();
            setActive((a) => (e.key === "ArrowDown" ? (a + 1) % matches.length : a <= 0 ? matches.length - 1 : a - 1));
          }
          if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            // Only a highlighted or fully typed customer is picked: "Ravi" must not
            // become "Ravi Kumar" by itself.
            const pick = showList && active >= 0 ? matches[active] : exact;
            if (pick) choose(pick);
            else setOpen(false);
          }
        }}
        className={inputCls}
      />

      {showList && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-lg">
          {matches.map((c, i) => (
            <li key={c._id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(c)}
                className={`block w-full px-3 py-2 text-left text-sm text-text ${i === active ? "bg-primary-soft" : ""}`}
              >
                {[c.name, c.phone].filter(Boolean).join(" · ")}
                {c.outstandingBalance > 0 && <span className="ml-2 text-xs font-semibold text-danger">owes ₹{c.outstandingBalance.toFixed(2)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {term && !showList && !searching && (
        <div className="mt-1.5 space-y-1.5">
          <p className={`text-xs font-semibold ${exact ? "text-muted" : "text-secondary"}`}>{exact ? `Existing customer: ${exact.name}` : "New customer – added to your Customer List when saved."}</p>
          {!exact && (
            <input
              type={isPhone ? "text" : "tel"}
              aria-label={isPhone ? "New customer name" : "New customer phone"}
              placeholder={isPhone ? "Name (optional)" : "Phone (optional, 10 digits)"}
              maxLength={isPhone ? 100 : 10}
              value={isPhone ? typed.name : typed.phone}
              onChange={(e) => onTyped({ ...typed, ...(isPhone ? { name: e.target.value } : { phone: e.target.value.replace(/\D/g, "") }) })}
              onKeyDown={(e) => e.key === "Enter" && !e.ctrlKey && e.preventDefault()}
              className={inputCls}
            />
          )}
        </div>
      )}
    </div>
  );
}
