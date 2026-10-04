import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Icon from "../Icon";
import { listCategories } from "../../api/products";
import { fullDate } from "./format";

function localIso(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function lastDays(days) {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return { from: localIso(from), to: localIso(to) };
}

const PRESETS = [
  { label: "Today", range: () => lastDays(1) },
  { label: "Last 7 days", range: () => lastDays(7) },
  { label: "Last 30 days", range: () => lastDays(30) },
  { label: "Last 90 days", range: () => lastDays(90) },
  {
    label: "This month",
    range: () => {
      const now = new Date();
      return { from: localIso(new Date(now.getFullYear(), now.getMonth(), 1)), to: localIso(now) };
    },
  },
];

export function presetFor(range) {
  return PRESETS.find((p) => {
    const r = p.range();
    return r.from === range.from && r.to === range.to;
  });
}

export function DateFilter({ range, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const active = presetFor(range);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const inputCls =
    "w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm font-medium text-text transition hover:border-primary/30"
      >
        <Icon name="calendar" size={17} className="text-primary" />
        <span className="hidden whitespace-nowrap sm:inline">
          {active ? active.label : `${fullDate(range.from)} – ${fullDate(range.to)}`}
        </span>
        <Icon name="chevronDown" size={15} className="text-muted" />
      </button>

      {open && (
        <div className="fade-up absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-border bg-surface p-1.5 shadow-[var(--shadow-lift)]">
          {PRESETS.map((p) => {
            const isActive = active?.label === p.label;
            return (
              <button
                key={p.label}
                onClick={() => {
                  onChange(p.range());
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition hover:bg-bg ${isActive ? "font-semibold text-primary" : "text-text"}`}
              >
                {p.label}
                {isActive && <Icon name="check" size={16} strokeWidth={2.5} />}
              </button>
            );
          })}
          <div className="mt-1 border-t border-border px-2 pb-1.5 pt-2.5">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Custom range</p>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                aria-label="From"
                value={range.from}
                max={range.to}
                onChange={(e) => e.target.value && onChange({ ...range, from: e.target.value })}
                className={inputCls}
              />
              <span className="text-xs text-muted">–</span>
              <input
                type="date"
                aria-label="To"
                value={range.to}
                min={range.from}
                onChange={(e) => e.target.value && onChange({ ...range, to: e.target.value })}
                className={inputCls}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const PAYMENT_MODES = ["Cash", "UPI", "Card", "Credit", "Other"];

// Dashboard-style filters kept in the URL (?from&to&category&paymentMode), so
// they survive a refresh, can be shared as a link, and are still applied when
// coming Back from a detail page. Defaults to the last 30 days.
export function useReportFilters() {
  const [params, setParams] = useSearchParams();
  const fallback = lastDays(30);
  const filters = {
    from: params.get("from") || fallback.from,
    to: params.get("to") || fallback.to,
    category: params.get("category") || "",
    paymentMode: params.get("paymentMode") || "",
  };
  const setFilters = (patch) => {
    const next = { ...filters, ...patch };
    setParams(
      Object.fromEntries(Object.entries(next).filter(([, v]) => v)),
      { replace: true }
    );
  };
  return [filters, setFilters];
}

const selectCls =
  "h-10 rounded-xl border border-border bg-surface px-3 text-sm font-medium text-text transition hover:border-primary/30 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10";

// Category + payment mode selects with a "Clear filters" link; the date range
// lives in the page toolbar (DateFilter). `note` explains what the filters cover.
export function FilterBar({ filters, onChange, note }) {
  const [categories, setCategories] = useState([]);
  useEffect(() => {
    listCategories()
      .then(setCategories)
      .catch(() => {});
  }, []);

  const active = Boolean(filters.category || filters.paymentMode);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        <Icon name="search" size={14} />
        Filters
      </span>
      <select
        aria-label="Category"
        value={filters.category}
        onChange={(e) => onChange({ category: e.target.value })}
        className={`${selectCls} ${filters.category ? "border-primary/40 text-primary" : ""}`}
      >
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c._id} value={c._id}>
            {c.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Payment mode"
        value={filters.paymentMode}
        onChange={(e) => onChange({ paymentMode: e.target.value })}
        className={`${selectCls} ${filters.paymentMode ? "border-primary/40 text-primary" : ""}`}
      >
        <option value="">All payment modes</option>
        {PAYMENT_MODES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      {active && (
        <button
          onClick={() => onChange({ category: "", paymentMode: "" })}
          className="inline-flex h-10 items-center gap-1 rounded-xl px-3 text-sm font-semibold text-primary transition hover:bg-primary-soft"
        >
          <Icon name="close" size={14} />
          Clear filters
        </button>
      )}
      {active && note && <p className="w-full text-xs text-muted">{note}</p>}
    </div>
  );
}
