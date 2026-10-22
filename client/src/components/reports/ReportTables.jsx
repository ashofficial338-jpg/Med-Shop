import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../Icon";
import { ChartCard } from "../dashboard/DashboardCharts";
import { EmptyRow } from "../dashboard/DashboardWidgets";
import { count, fullDate, money2, percent } from "../dashboard/format";
import { getCatalog, getTransactions } from "../../api/reports";

const signTone = (n) => (n < 0 ? "text-danger" : n > 0 ? "text-success" : "text-text");

// Cell renderers by column type.
const RENDER = {
  money: (v) => money2(v),
  signed: (v) => money2(v),
  pct: (v) => percent(v),
  int: (v) => count(v),
  qty: (v) => Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 }),
  date: (v) => (v ? fullDate(v) : "—"),
  text: (v) => (v === null || v === undefined || v === "" ? "—" : v),
};
const isNumeric = (type) => type && type !== "text" && type !== "date";

function SortHeader({ col, sort, onSort, first, last }) {
  const active = sort?.key === col.key;
  return (
    <th
      className={`whitespace-nowrap py-2 font-semibold ${isNumeric(col.type) ? "text-right" : "text-left"} ${first ? "pr-3" : last ? "pl-3" : "px-3"}`}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
    >
      {onSort && col.sortable !== false ? (
        <button onClick={() => onSort(col.key)} className="uppercase tracking-wide transition hover:text-primary">
          {col.label}
          {active ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
        </button>
      ) : (
        col.label
      )}
    </th>
  );
}

// columns: [{ key, label, type, render(row), tone(row) }]. Sorted locally
// unless the caller handles sort (server-side tables pass sort/onSort).
export function DataTable({ columns, rows, totals, sort: externalSort, onSort: externalOnSort, rowKey = (r, i) => i, minWidth = 640 }) {
  const [localSort, setLocalSort] = useState(null);
  const sort = externalSort ?? localSort;
  const onSort =
    externalOnSort ??
    ((key) => setLocalSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" })));
  const sorted =
    externalSort || !localSort
      ? rows
      : [...rows].sort((a, b) => {
          const av = a[localSort.key] ?? -Infinity;
          const bv = b[localSort.key] ?? -Infinity;
          const cmp = typeof av === "string" || typeof bv === "string" ? String(av).localeCompare(String(bv)) : av - bv;
          return localSort.dir === "asc" ? cmp : -cmp;
        });

  const cell = (col, row, i, bold) => {
    const value = row[col.key];
    const text = col.render ? col.render(row) : RENDER[col.type || "text"](value);
    const tone = col.tone ? col.tone(row) : col.type === "signed" ? signTone(value) : "text-text";
    return (
      <td
        key={col.key}
        className={`py-2.5 tnum ${isNumeric(col.type) ? "text-right" : "max-w-[16rem] truncate text-left"} ${i === 0 ? "pr-3 font-medium" : i === columns.length - 1 ? "pl-3" : "px-3"} ${tone} ${bold ? "font-semibold" : ""}`}
      >
        {text}
      </td>
    );
  };

  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full text-sm" style={{ minWidth }}>
        <thead>
          <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wide text-muted">
            {columns.map((c, i) => (
              <SortHeader key={c.key} col={c} sort={sort} onSort={onSort} first={i === 0} last={i === columns.length - 1} />
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {sorted.map((row, idx) => (
            <tr key={rowKey(row, idx)} className="transition hover:bg-bg">
              {columns.map((c, i) => cell(c, row, i))}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr className="border-t-2 border-primary/30 bg-primary-soft/40">
              {columns.map((c, i) =>
                i === 0 ? (
                  <td key={c.key} className="py-2.5 pr-3 font-semibold text-text">
                    Total
                  </td>
                ) : totals[c.key] === undefined ? (
                  <td key={c.key} />
                ) : (
                  cell(c, totals, i, true)
                )
              )}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export function Pager({ page, pages, total, limit, onPage, onLimit }) {
  if (!total) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  const btn = "rounded-lg border border-border px-2.5 py-1.5 text-sm font-semibold text-text transition hover:border-primary/30 disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
      <span className="tnum">
        {count(from)}–{count(to)} of {count(total)}
      </span>
      <div className="flex items-center gap-2">
        <select
          aria-label="Rows per page"
          value={limit}
          onChange={(e) => onLimit(Number(e.target.value))}
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text"
        >
          {[10, 25, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n} / page
            </option>
          ))}
        </select>
        <button className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          ‹ Prev
        </button>
        <span className="tnum">
          {page} / {pages}
        </span>
        <button className={btn} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          Next ›
        </button>
      </div>
    </div>
  );
}

// Text input that reports its value after the user pauses typing.
function useDebounced(value, ms = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

const inputCls = "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text focus:border-primary focus:outline-none";

// Server-paginated list (transactions, catalog): search, sort and paging
// all happen on the server so large histories stay fast.
function usePagedQuery(fetcher, params, refreshKey, defaultSort) {
  const [q, setQ] = useState("");
  const [extra, setExtra] = useState({});
  const [sort, setSort] = useState(defaultSort);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const search = useDebounced(q);
  const paramsKey = JSON.stringify(params);
  const extraKey = JSON.stringify(extra);

  useEffect(() => setPage(1), [paramsKey, extraKey, search, sort.key, sort.dir, limit]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    fetcher({ ...params, ...extra, q: search, sort: sort.key, dir: sort.dir, page, limit })
      .then((d) => alive && setData(d))
      .catch(() => alive && setError("Couldn't load this list. Please try again."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey, extraKey, search, sort.key, sort.dir, page, limit, refreshKey]);

  const onSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" }));
  return { q, setQ, extra, setExtra, sort, onSort, page, setPage, limit, setLimit, data, loading, error };
}

const TYPE_LABELS = { sale: "Sales", purchase: "Purchases", expense: "Expenses", receipt: "Payments received", payment: "Payments made" };
const STATUS_TONE = { Void: "bg-bg text-muted line-through", Due: "bg-warning/10 text-warning", Paid: "bg-success/10 text-success", Received: "bg-success/10 text-success" };

export function TransactionsPanel({ params, refreshKey }) {
  const t = usePagedQuery(getTransactions, params, refreshKey, { key: "date", dir: "desc" });
  const columns = [
    { key: "date", label: "Date", type: "date" },
    { key: "type", label: "Type" },
    { key: "ref", label: "Reference", render: (r) => (r.type === "Sale" ? <Link to={`/bills/${r.id}`} className="text-primary hover:underline">{r.ref}</Link> : r.ref) },
    { key: "party", label: "Party / Notes" },
    { key: "mode", label: "Mode" },
    { key: "amount", label: "Amount", type: "money", tone: (r) => (r.status === "Void" ? "text-muted line-through" : r.direction === "out" ? "text-danger" : "text-success") },
    {
      key: "status",
      label: "Status",
      render: (r) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[r.status] || "bg-bg text-muted"}`}>{r.status}</span>,
    },
  ];
  return (
    <ChartCard
      title="Transaction History"
      subtitle={t.data ? `Money in ${money2(t.data.totals.in)} · money out ${money2(t.data.totals.out)} (void bills excluded)` : "Every sale, purchase, expense and payment in the period"}
      action={
        <div className="flex flex-wrap justify-end gap-2">
          <select aria-label="Transaction type" value={t.extra.type || ""} onChange={(e) => t.setExtra({ type: e.target.value })} className={inputCls}>
            <option value="">All types</option>
            {Object.entries(TYPE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <input type="search" placeholder="Search ref, party, mode" value={t.q} onChange={(e) => t.setQ(e.target.value)} aria-label="Search transactions" className={`${inputCls} w-44 sm:w-56`} />
        </div>
      }
    >
      {t.error && <p className="text-sm text-danger">{t.error}</p>}
      {!t.data && t.loading && <div className="skeleton h-48 rounded-xl" />}
      {t.data && t.data.total === 0 && <EmptyRow icon="receipt" title="No transactions found" text="Nothing matches this period and these filters." />}
      {t.data && t.data.total > 0 && (
        <div className={`transition-opacity ${t.loading ? "opacity-60" : ""}`}>
          <DataTable columns={columns} rows={t.data.rows} sort={t.sort} onSort={t.onSort} rowKey={(r) => `${r.type}-${r.id}`} minWidth={760} />
          <Pager page={t.data.page} pages={t.data.pages} total={t.data.total} limit={t.limit} onPage={t.setPage} onLimit={t.setLimit} />
        </div>
      )}
    </ChartCard>
  );
}

const STOCK_TONE = { "Out of stock": "bg-danger/10 text-danger", "Low stock": "bg-warning/10 text-warning", "In stock": "bg-success/10 text-success" };

export function CatalogPanel({ params, refreshKey, canEdit }) {
  const c = usePagedQuery(getCatalog, params, refreshKey, { key: "name", dir: "asc" });
  const columns = [
    { key: "name", label: "Product", render: (r) => <Link to={`/products?product=${r.productId}`} className="text-text hover:text-primary hover:underline">{r.name}</Link> },
    { key: "brand", label: "Brand" },
    { key: "sku", label: "SKU" },
    { key: "category", label: "Category" },
    { key: "sellingPrice", label: "Selling", type: "money" },
    { key: "purchasePrice", label: "Purchase", type: "money", render: (r) => (r.purchasePrice === null ? "—" : money2(r.purchasePrice)) },
    { key: "gstPercent", label: "GST", type: "int", render: (r) => `${r.gstPercent}%` },
    { key: "marginPct", label: "Margin", type: "pct", tone: (r) => (r.marginPct < 0 ? "text-danger" : "text-text") },
    { key: "qty", label: "Stock", type: "int", render: (r) => r.qtyDisplay },
    { key: "supplier", label: "Supplier" },
    { key: "status", label: "Status", sortable: false, render: (r) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STOCK_TONE[r.status]}`}>{r.status}</span> },
  ];
  return (
    <ChartCard
      title="Product Catalog"
      subtitle="Selling vs latest purchase price per pack, GST, stock and supplier. Margin = (selling − purchase) ÷ selling."
      action={
        <div className="flex flex-wrap justify-end gap-2">
          <select aria-label="Stock status" value={c.extra.status || ""} onChange={(e) => c.setExtra({ status: e.target.value })} className={inputCls}>
            <option value="">All stock</option>
            <option>In stock</option>
            <option>Low stock</option>
            <option>Out of stock</option>
          </select>
          <input type="search" placeholder="Search name, SKU, brand" value={c.q} onChange={(e) => c.setQ(e.target.value)} aria-label="Search products" className={`${inputCls} w-44 sm:w-56`} />
          {canEdit && (
            <Link to="/products" className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-dark">
              <Icon name="plus" size={14} />
              Add / import
            </Link>
          )}
        </div>
      }
    >
      {c.error && <p className="text-sm text-danger">{c.error}</p>}
      {!c.data && c.loading && <div className="skeleton h-48 rounded-xl" />}
      {c.data && c.data.total === 0 && (
        <EmptyRow icon="pill" title="No products found" text={c.q || c.extra.status ? "Nothing matches this search." : "Add products or import them from Excel on the Products page."} />
      )}
      {c.data && c.data.total > 0 && (
        <div className={`transition-opacity ${c.loading ? "opacity-60" : ""}`}>
          <DataTable columns={columns} rows={c.data.rows} sort={c.sort} onSort={c.onSort} rowKey={(r) => r.productId} minWidth={1020} />
          <Pager page={c.data.page} pages={c.data.pages} total={c.data.total} limit={c.limit} onPage={c.setPage} onLimit={c.setLimit} />
        </div>
      )}
    </ChartCard>
  );
}
