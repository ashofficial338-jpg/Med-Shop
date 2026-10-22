import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Layout from "../components/Layout";
import Icon from "../components/Icon";
import { ChartCard } from "../components/dashboard/DashboardCharts";
import { SectionTitle, StatTile } from "../components/dashboard/DashboardWidgets";
import { DateFilter, lastDays, presetFor, presetRange } from "../components/dashboard/ReportFilters";
import { count, fullDate, money2, percent } from "../components/dashboard/format";
import { COLORS, KpiCard, ProfitTrendChart, RankBars, RevenueCostChart, changeOf } from "../components/reports/ReportCharts";
import { CatalogPanel, DataTable, TransactionsPanel } from "../components/reports/ReportTables";
import ExportDialog from "../components/reports/ExportDialog";
import { getAnalytics, getReportOptions } from "../api/reports";
import { useAuth } from "../context/AuthContext";
import { can } from "../utils/permissions";

const TABS = [
  { key: "overview", label: "Overview", icon: "dashboard" },
  { key: "sales", label: "Sales & Products", icon: "receipt" },
  { key: "inventory", label: "Inventory", icon: "boxes" },
  { key: "finance", label: "Finance & GST", icon: "wallet" },
  { key: "transactions", label: "Transactions", icon: "book" },
  { key: "catalog", label: "Catalog", icon: "pill" },
];
const GRANULARITIES = [
  { key: "", label: "Auto" },
  { key: "day", label: "Daily" },
  { key: "week", label: "Weekly" },
  { key: "month", label: "Monthly" },
  { key: "quarter", label: "Quarterly" },
  { key: "year", label: "Yearly" },
];
const FILTER_KEYS = ["category", "brand", "product", "supplier", "paymentMode"];
const REFRESH_MS = 60 * 1000;

// Report filters kept in the URL, so a view survives a refresh and can be
// shared as a link. Defaults to the last 30 days, compared with the 30 before.
function useReportParams() {
  const [params, setParams] = useSearchParams();
  const fallback = lastDays(30);
  const state = {
    from: params.get("from") || fallback.from,
    to: params.get("to") || fallback.to,
    granularity: params.get("granularity") || "",
    compare: params.get("compare") !== "0",
    tab: TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "overview",
    ...Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) || ""])),
  };
  const update = (patch) => {
    const next = { ...state, ...patch };
    const entries = Object.entries({ ...next, compare: next.compare ? "" : "0", tab: next.tab === "overview" ? "" : next.tab });
    setParams(Object.fromEntries(entries.filter(([, v]) => v)), { replace: true });
  };
  return [state, update];
}

const selectCls =
  "h-10 min-w-0 max-w-[13rem] rounded-xl border border-border bg-surface px-3 text-sm font-medium text-text transition hover:border-primary/30 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10";

function FilterSelect({ label, value, onChange, children }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={`${selectCls} ${value ? "border-primary/40 text-primary" : ""}`}>
      {children}
    </select>
  );
}

// Product filter: type to search by name or code (datalist), then pick.
function ProductFilter({ products, value, onChange }) {
  const current = products.find((p) => p._id === value);
  const labelOf = (p) => `${p.name} (${p.productCode})`;
  const [text, setText] = useState(current ? labelOf(current) : "");
  useEffect(() => setText(current ? labelOf(current) : ""), [current]);
  return (
    <>
      <input
        list="report-products"
        aria-label="Product"
        placeholder="All products"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const match = products.find((p) => labelOf(p) === e.target.value);
          if (match) onChange(match._id);
          if (!e.target.value) onChange("");
        }}
        className={`${selectCls} w-48 ${value ? "border-primary/40 text-primary" : ""}`}
      />
      <datalist id="report-products">
        {products.map((p) => (
          <option key={p._id} value={labelOf(p)} />
        ))}
      </datalist>
    </>
  );
}

function FiltersBar({ state, update, options }) {
  const active = FILTER_KEYS.some((k) => state[k]);
  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          <Icon name="search" size={14} />
          Filters
        </span>
        <ProductFilter products={options?.products || []} value={state.product} onChange={(product) => update({ product })} />
        <FilterSelect label="Brand" value={state.brand} onChange={(brand) => update({ brand })}>
          <option value="">All brands</option>
          {(options?.brands || []).map((b) => (
            <option key={b}>{b}</option>
          ))}
        </FilterSelect>
        <FilterSelect label="Category" value={state.category} onChange={(category) => update({ category })}>
          <option value="">All categories</option>
          {(options?.categories || []).map((c) => (
            <option key={c._id} value={c._id}>
              {c.name}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Supplier" value={state.supplier} onChange={(supplier) => update({ supplier })}>
          <option value="">All suppliers</option>
          {(options?.suppliers || []).map((s) => (
            <option key={s._id} value={s._id}>
              {s.name}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Payment method" value={state.paymentMode} onChange={(paymentMode) => update({ paymentMode })}>
          <option value="">All payment methods</option>
          {(options?.paymentModes || []).map((m) => (
            <option key={m}>{m}</option>
          ))}
        </FilterSelect>
        {active && (
          <button
            onClick={() => update(Object.fromEntries(FILTER_KEYS.map((k) => [k, ""])))}
            className="inline-flex h-10 items-center gap-1 rounded-xl px-3 text-sm font-semibold text-primary transition hover:bg-primary-soft"
          >
            <Icon name="close" size={14} />
            Clear filters
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex flex-wrap rounded-xl bg-bg p-1" role="group" aria-label="Chart period">
          {GRANULARITIES.map((g) => (
            <button
              key={g.key}
              onClick={() => update({ granularity: g.key })}
              aria-pressed={state.granularity === g.key}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${state.granularity === g.key ? "bg-surface text-primary shadow-sm" : "text-muted hover:text-text"}`}
            >
              {g.label}
            </button>
          ))}
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-text">
          <input type="checkbox" checked={state.compare} onChange={(e) => update({ compare: e.target.checked })} />
          Compare with previous period
        </label>
      </div>
      {active && (
        <p className="text-xs text-muted">
          Product, brand, category and supplier narrow sales, profit, purchases and stock; payment method narrows sales and profit. Shop expenses are shared by the filtered sales&apos; revenue. Exports use the same filters.
        </p>
      )}
    </div>
  );
}

// Shown when the period has no records - never filled with sample figures.
function NoDataNotice({ hasProducts }) {
  const linkCls = "inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-semibold text-primary transition hover:border-primary/30";
  return (
    <div className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-info-soft text-info">
          <Icon name="info" size={18} />
        </span>
        <div>
          <p className="font-semibold text-text">No transactions in this period</p>
          <p className="text-sm text-muted">
            {hasProducts
              ? "There are no sales, purchases or expenses recorded for these dates and filters. Pick another period, or record transactions to see them here."
              : "There are no products yet. Add or import your products, then record sales and purchases to build these reports."}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link to="/products" className={linkCls}>
          <Icon name="plus" size={14} />
          {hasProducts ? "Products" : "Add / import products"}
        </Link>
        <Link to="/checkout" className={linkCls}>
          <Icon name="cart" size={14} />
          New sale
        </Link>
        <Link to="/purchases" className={linkCls}>
          <Icon name="truck" size={14} />
          Purchases
        </Link>
        <Link to="/expenses" className={linkCls}>
          <Icon name="wallet" size={14} />
          Expenses
        </Link>
      </div>
    </div>
  );
}

const sum = (rows, key) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
const perfColumns = (labelKey, label) => [
  { key: labelKey, label },
  { key: "bills", label: "Bills", type: "int" },
  { key: "qtyPacks", label: "Qty (packs)", type: "qty" },
  { key: "revenue", label: "Revenue", type: "money" },
  { key: "cogs", label: "COGS", type: "money" },
  { key: "grossProfit", label: "Gross Profit", type: "signed" },
  { key: "marginPct", label: "Margin", type: "pct" },
  { key: "sharePct", label: "Share", type: "pct" },
];
const perfTotals = (rows, k) => ({ bills: undefined, qtyPacks: sum(rows, "qtyPacks"), revenue: sum(rows, "revenue"), cogs: sum(rows, "cogs"), grossProfit: sum(rows, "grossProfit"), marginPct: k.grossMarginPct });

function Overview({ a, update, goTab }) {
  const k = a.kpis;
  const p = a.previous;
  const ch = (key, opts) => (p ? changeOf(k[key], p[key], opts) : null);
  const inv = a.inventory.totals;
  return (
    <div className="space-y-6">
      <div className="stagger grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard label="Revenue" value={k.revenue} change={ch("revenue")} note="excl. GST" accent={COLORS.revenue} />
        <KpiCard label="Expenses" value={k.expenses} change={ch("expenses", { costLike: true })} accent={COLORS.costs} />
        <KpiCard label="Purchases" value={k.purchases} change={ch("purchases", { costLike: true })} accent="#64717D" />
        <KpiCard label={k.profit < 0 ? "Net Loss" : "Net Profit"} value={k.profit} change={ch("profit")} tone={k.profit < 0 ? "text-danger" : "text-success"} accent={COLORS.profit} />
        <KpiCard label="Profit Margin" display={percent(k.netMarginPct)} change={ch("netMarginPct", { points: true })} note="net" />
        <KpiCard label="Gross Profit" value={k.grossProfit} change={ch("grossProfit")} note={`${percent(k.grossMarginPct)} margin`} />
        <KpiCard label="Bills" display={count(k.salesCount)} change={ch("salesCount")} />
        <KpiCard label="Average Bill" value={k.avgBillValue} change={ch("avgBillValue")} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <RevenueCostChart trend={a.trend} granularity={a.period.granularity} />
        <ProfitTrendChart trend={a.trend} granularity={a.period.granularity} />
      </div>

      <div className="stagger grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <AlertTile label="Low stock" value={inv.lowStockCount} tone={inv.lowStockCount ? "warning" : "success"} onClick={() => goTab("inventory")} />
        <AlertTile label="Out of stock" value={inv.outOfStockCount} tone={inv.outOfStockCount ? "danger" : "success"} onClick={() => goTab("inventory")} />
        <AlertTile label="Expiring ≤ 90 days" value={a.inventory.expiring.length} tone={a.inventory.expiring.length ? "warning" : "success"} onClick={() => goTab("inventory")} />
        <AlertTile label="Receivables" money={a.receivables.total} tone={a.receivables.total ? "warning" : "success"} onClick={() => goTab("finance")} />
        <AlertTile label="Payables" money={a.payables.total} tone={a.payables.total ? "danger" : "success"} onClick={() => goTab("finance")} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <RankBars title="Top-selling Products" subtitle="By revenue · click to filter" rows={a.products} labelKey="name" color={COLORS.revenue} onSelect={(r) => r?.productId && update({ product: r.productId })} />
        <RankBars title="Best-performing Brands" subtitle="By revenue · click to filter" rows={a.brands} labelKey="brand" onSelect={(r) => r?.brand && r.brand !== "Unbranded" && update({ brand: r.brand })} />
        <RankBars title="Category-wise Sales" subtitle="By revenue · click to filter" rows={a.categories} labelKey="category" onSelect={(r) => r?.categoryId && update({ category: r.categoryId })} />
      </div>
    </div>
  );
}

const ALERT_TONES = { success: "text-success", warning: "text-warning", danger: "text-danger" };
function AlertTile({ label, value, money, tone, onClick }) {
  return (
    <button onClick={onClick} className="card card-hover fade-up p-4 text-left">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={`mt-1 font-display text-xl font-bold tnum ${ALERT_TONES[tone]}`}>{money !== undefined ? money2(money) : count(value)}</p>
    </button>
  );
}

function SalesTab({ a, update }) {
  const k = a.kpis;
  const [showAll, setShowAll] = useState(false);
  const products = showAll ? a.products : a.products.slice(0, 25);
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Sales by Payment Method" subtitle="Revenue excl. GST · billed amount includes GST">
          {a.paymentModes.length === 0 ? (
            <p className="text-sm text-muted">No sales in this period.</p>
          ) : (
            <DataTable
              minWidth={480}
              columns={[
                { key: "mode", label: "Method" },
                { key: "bills", label: "Bills", type: "int" },
                { key: "revenue", label: "Revenue", type: "money" },
                { key: "collected", label: "Billed", type: "money" },
                { key: "sharePct", label: "Share", type: "pct" },
              ]}
              rows={a.paymentModes}
              totals={{ bills: sum(a.paymentModes, "bills"), revenue: sum(a.paymentModes, "revenue"), collected: sum(a.paymentModes, "collected") }}
            />
          )}
        </ChartCard>
        <RankBars title="Category-wise Sales" subtitle="Click a bar to filter by that category" rows={a.categories} labelKey="category" onSelect={(r) => r?.categoryId && update({ category: r.categoryId })} />
      </div>

      <ChartCard title="Category Performance" subtitle="Revenue, cost and gross margin by category">
        {a.categories.length === 0 ? <p className="text-sm text-muted">No sales in this period.</p> : <DataTable columns={perfColumns("category", "Category")} rows={a.categories} totals={perfTotals(a.categories, k)} minWidth={760} />}
      </ChartCard>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <RankBars title="Best-performing Brands" subtitle="Click a bar to filter by that brand" rows={a.brands} labelKey="brand" onSelect={(r) => r?.brand && r.brand !== "Unbranded" && update({ brand: r.brand })} />
        <ChartCard title="Brand Performance" subtitle="Set a product's brand on the Products page; products without one show as Unbranded">
          {a.brands.length === 0 ? <p className="text-sm text-muted">No sales in this period.</p> : <DataTable columns={perfColumns("brand", "Brand")} rows={a.brands} totals={perfTotals(a.brands, k)} minWidth={760} />}
        </ChartCard>
      </div>

      <ChartCard
        title="Product Performance"
        subtitle={`${a.products.length} product${a.products.length === 1 ? "" : "s"} sold · click a column to sort`}
        action={
          a.products.length > 25 && (
            <button onClick={() => setShowAll((v) => !v)} className="rounded-lg px-2 py-1 text-xs font-semibold text-primary hover:bg-primary-soft">
              {showAll ? "Show top 25" : `Show all ${a.products.length}`}
            </button>
          )
        }
      >
        {a.products.length === 0 ? (
          <p className="text-sm text-muted">No sales in this period.</p>
        ) : (
          <DataTable
            columns={[
              { key: "name", label: "Product", render: (r) => (r.productId ? <Link to={`/products?product=${r.productId}`} className="text-text hover:text-primary hover:underline">{r.name}</Link> : r.name) },
              { key: "brand", label: "Brand" },
              { key: "category", label: "Category" },
              ...perfColumns("name", "").slice(1),
            ]}
            rows={products}
            totals={perfTotals(a.products, k)}
            rowKey={(r) => r.productId || r.name}
            minWidth={980}
          />
        )}
      </ChartCard>
    </div>
  );
}

function InventoryTab({ a }) {
  const inv = a.inventory;
  const stockCols = [
    { key: "name", label: "Product", render: (r) => <Link to={`/products?product=${r.productId}`} className="text-text hover:text-primary hover:underline">{r.name}</Link> },
    { key: "productCode", label: "SKU" },
    { key: "category", label: "Category" },
    { key: "qty", label: "On hand", type: "int", render: (r) => r.qtyDisplay },
    { key: "lowStockThreshold", label: "Alert below", type: "int" },
    { key: "supplier", label: "Supplier" },
  ];
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">Stock figures are as of right now, not limited to the report period.</p>
      <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Stock Value (cost)" value={inv.totals.valueCost} icon="boxes" tone="teal" note="What the stock on hand cost" to="/stock?tab=report" />
        <StatTile label="Stock Value (selling)" value={inv.totals.valueMrp} icon="rupee" tone="blue" note="At current selling rates, excl. GST" />
        <StatTile label="Expected Profit" value={inv.totals.expectedProfit} icon="trendUp" tone="success" valueTone="success" note="Selling value − cost" />
        <StatTile label="Expiring ≤ 90 days" value={inv.totals.expiringValue} icon="hourglass" tone="warning" note={`${inv.expiring.length} batch${inv.expiring.length === 1 ? "" : "es"}, at cost`} to="/stock?tab=expiry" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title={`Low Stock (${inv.lowStock.length})`} subtitle="At or below the product's alert level">
          {inv.lowStock.length === 0 ? <p className="text-sm text-muted">No products are running low.</p> : <DataTable columns={stockCols} rows={inv.lowStock} rowKey={(r) => r.productId} />}
        </ChartCard>
        <ChartCard title={`Out of Stock (${inv.outOfStock.length})`} subtitle="Nothing left on the shelf">
          {inv.outOfStock.length === 0 ? <p className="text-sm text-muted">No products are out of stock.</p> : <DataTable columns={stockCols} rows={inv.outOfStock} rowKey={(r) => r.productId} />}
        </ChartCard>
      </div>
      <ChartCard title="Expiring Batches" subtitle="Expired or expiring in the next 90 days">
        {inv.expiring.length === 0 ? (
          <p className="text-sm text-muted">No batches expire in the next 90 days.</p>
        ) : (
          <DataTable
            columns={[
              { key: "name", label: "Product" },
              { key: "batchNo", label: "Batch" },
              { key: "expiryDate", label: "Expiry", type: "date" },
              { key: "daysLeft", label: "Days left", type: "int", tone: (r) => (r.daysLeft < 0 ? "text-danger" : r.daysLeft <= 30 ? "text-warning" : "text-text") },
              { key: "qtyRemaining", label: "Qty left", type: "int" },
              { key: "valueCost", label: "Value (cost)", type: "money" },
            ]}
            rows={inv.expiring}
            totals={{ valueCost: inv.totals.expiringValue }}
            rowKey={(r) => `${r.productId}-${r.batchNo}`}
          />
        )}
      </ChartCard>
      <ChartCard title="Highest-value Stock" subtitle="Where most of the money on the shelf is">
        <DataTable
          columns={[
            { key: "name", label: "Product" },
            { key: "qty", label: "On hand", type: "int", render: (r) => r.qtyDisplay },
            { key: "valueCost", label: "Value (cost)", type: "money" },
            { key: "valueMrp", label: "Value (selling)", type: "money" },
            { key: "expectedProfit", label: "Expected profit", type: "signed" },
          ]}
          rows={inv.topValue}
          rowKey={(r) => r.productId}
        />
      </ChartCard>
    </div>
  );
}

function FinanceTab({ a }) {
  const pl = a.pnl;
  const cf = a.cashFlow;
  const lines = [
    { label: "Revenue (net of GST & discounts)", amount: pl.revenue },
    { label: "Less: Cost of goods sold", amount: -pl.cogs },
    { label: "Gross Profit", amount: pl.grossProfit, strong: true },
    { label: `Less: Expenses${pl.expenseSharePct !== null && pl.expenseSharePct !== 100 ? ` (${pl.expenseSharePct}% share)` : ""}`, amount: -pl.expenses },
    { label: "Less: Expired stock write-off", amount: -pl.expiredWriteOff },
    { label: pl.profit < 0 ? "Net Loss" : "Net Profit", amount: pl.profit, strong: true },
    { label: "Add back: Interest, Taxes, Depreciation, Amortization", amount: pl.interest + pl.taxes + pl.depreciation + pl.amortization },
    { label: "EBITDA", amount: pl.ebitda, strong: true },
  ];
  const gstCols = [
    { key: "rate", label: "Rate", type: "int", render: (r) => `${r.rate}%` },
    { key: "taxable", label: "Taxable value", type: "money" },
    { key: "cgst", label: "CGST", type: "money" },
    { key: "sgst", label: "SGST", type: "money" },
    { key: "gst", label: "Total GST", type: "money" },
  ];
  const gstTotals = (rows) => ({ taxable: sum(rows, "taxable"), cgst: sum(rows, "cgst"), sgst: sum(rows, "sgst"), gst: sum(rows, "gst") });

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <SectionTitle icon="trendUp">Profit &amp; Loss</SectionTitle>
        <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          <ChartCard title="Statement" subtitle="Same figures as the dashboard and the exports">
            <dl className="divide-y divide-border/70 text-sm">
              {lines.map((l) => (
                <div key={l.label} className={`flex justify-between gap-4 py-2 ${l.strong ? "font-semibold" : ""}`}>
                  <dt className="text-text">{l.label}</dt>
                  <dd className={`tnum ${l.amount < 0 ? "text-danger" : l.strong ? "text-success" : "text-text"}`}>{money2(l.amount)}</dd>
                </div>
              ))}
            </dl>
          </ChartCard>
          <div className="grid grid-cols-2 content-start gap-3">
            <KpiCard label="Gross margin" display={percent(pl.grossMarginPct)} />
            <KpiCard label="Net margin" display={percent(pl.netMarginPct)} />
            <KpiCard label="EBITDA margin" display={percent(pl.ebitdaMarginPct)} />
            <KpiCard label="ROI" display={percent(pl.roiPct)} note="profit ÷ COGS" />
            <KpiCard label="Inventory turnover" display={pl.inventoryTurnover === null ? "—" : `${pl.inventoryTurnover}×`} />
            <KpiCard label="Closing inventory" value={pl.closingInventory} note="at cost" />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <SectionTitle icon="wallet">Cash Flow</SectionTitle>
        <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatTile label="Money In" value={cf.inflow} icon="trendUp" tone="success" note="Counter sales + collections" />
          <StatTile label="Money Out" value={cf.outflow} icon="trendDown" tone="danger" note="Expenses + purchases + supplier payments" />
          <StatTile label="Net Cash Flow" value={cf.net} icon="rupee" tone="teal" valueTone={cf.net < 0 ? "danger" : "success"} note="Shop-wide, not filtered" to="/day-book" />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard title="By Payment Mode">
            {cf.byMode.length === 0 ? (
              <p className="text-sm text-muted">No money moved in this period.</p>
            ) : (
              <DataTable
                minWidth={420}
                columns={[
                  { key: "mode", label: "Mode" },
                  { key: "inflow", label: "In", type: "money" },
                  { key: "outflow", label: "Out", type: "money" },
                  { key: "net", label: "Net", type: "signed" },
                ]}
                rows={cf.byMode}
                totals={{ inflow: cf.inflow, outflow: cf.outflow, net: cf.net }}
                rowKey={(r) => r.mode}
              />
            )}
          </ChartCard>
          <ChartCard title="Where It Came From and Went">
            <dl className="divide-y divide-border/70 text-sm">
              {cf.lines.map((l) => (
                <div key={l.label} className="flex justify-between gap-4 py-2">
                  <dt className="text-text">{l.label}</dt>
                  <dd className={`tnum ${l.direction === "out" ? "text-danger" : "text-success"}`}>{money2(l.amount)}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-4 py-2 text-muted">
                <dt>New credit given to customers (not cash yet)</dt>
                <dd className="tnum">{money2(cf.newReceivables)}</dd>
              </div>
              <div className="flex justify-between gap-4 py-2 text-muted">
                <dt>New credit taken from suppliers (not paid yet)</dt>
                <dd className="tnum">{money2(cf.newPayables)}</dd>
              </div>
            </dl>
          </ChartCard>
        </div>
      </section>

      <section className="space-y-4">
        <SectionTitle icon="users">Outstanding Payments</SectionTitle>
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard title={`Receivables · ${money2(a.receivables.total)}`} subtitle="Owed to the shop by customers, as of now">
            {a.receivables.rows.length === 0 ? (
              <p className="text-sm text-muted">No customer owes the shop money.</p>
            ) : (
              <DataTable
                minWidth={420}
                columns={[
                  { key: "name", label: "Customer", render: (r) => <Link to={`/customers/${r.customerId}/ledger`} className="text-text hover:text-primary hover:underline">{r.name}</Link> },
                  { key: "phone", label: "Phone" },
                  { key: "outstanding", label: "Outstanding", type: "money", tone: () => "text-danger" },
                ]}
                rows={a.receivables.rows}
                totals={{ outstanding: a.receivables.total }}
                rowKey={(r) => r.customerId}
              />
            )}
          </ChartCard>
          <ChartCard title={`Payables · ${money2(a.payables.total)}`} subtitle="Owed by the shop to suppliers, as of now">
            {a.payables.rows.length === 0 ? (
              <p className="text-sm text-muted">The shop owes no supplier money.</p>
            ) : (
              <DataTable
                minWidth={420}
                columns={[
                  { key: "name", label: "Supplier", render: (r) => <Link to={`/vendors/${r.vendorId}/ledger`} className="text-text hover:text-primary hover:underline">{r.name}</Link> },
                  { key: "outstanding", label: "Outstanding", type: "money", tone: () => "text-danger" },
                ]}
                rows={a.payables.rows}
                totals={{ outstanding: a.payables.total }}
                rowKey={(r) => r.vendorId}
              />
            )}
          </ChartCard>
        </div>
      </section>

      <section className="space-y-4">
        <SectionTitle icon="receipt">GST Summary</SectionTitle>
        <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatTile label="Output GST" value={a.gst.outputTotal} icon="arrowRight" tone="blue" note="Collected on sales" />
          <StatTile label="Input GST" value={a.gst.inputTotal} icon="truck" tone="slate" note="Paid on purchases" />
          <StatTile label="Net GST Payable" value={a.gst.netPayable} icon="rupee" tone="teal" valueTone={a.gst.netPayable < 0 ? "success" : "text"} note={a.gst.netPayable < 0 ? "Input credit exceeds output" : "Output − input"} />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard title="Output GST by Rate" subtitle="CGST/SGST shown as an equal split (intra-state)">
            {a.gst.output.length === 0 ? <p className="text-sm text-muted">No taxable sales in this period.</p> : <DataTable minWidth={480} columns={gstCols} rows={a.gst.output} totals={gstTotals(a.gst.output)} rowKey={(r) => r.rate} />}
          </ChartCard>
          <ChartCard title="Input GST by Rate" subtitle="From purchase invoices">
            {a.gst.input.length === 0 ? <p className="text-sm text-muted">No purchases in this period.</p> : <DataTable minWidth={480} columns={gstCols} rows={a.gst.input} totals={gstTotals(a.gst.input)} rowKey={(r) => r.rate} />}
          </ChartCard>
        </div>
        <p className="text-xs text-muted">These figures come from your recorded bills and invoices. Check them against your GST returns before filing.</p>
      </section>
    </div>
  );
}

export default function Reports() {
  const { user } = useAuth();
  const canExport = can(user, "reports.export");
  const [state, update] = useReportParams();
  const [options, setOptions] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [exporting, setExporting] = useState(false);

  const query = {
    from: state.from,
    to: state.to,
    granularity: state.granularity,
    compare: state.compare ? "" : "false",
    ...Object.fromEntries(FILTER_KEYS.map((k) => [k, state[k]])),
  };
  const queryKey = JSON.stringify(query);

  useEffect(() => {
    getReportOptions()
      .then(setOptions)
      .catch(() => setOptions({ categories: [], brands: [], suppliers: [], products: [], paymentModes: [] }));
  }, []);

  // `silent` refreshes keep the current figures on screen while reloading.
  const load = useCallback(
    (silent = false) => {
      if (!silent) setLoading(true);
      setError("");
      return getAnalytics(JSON.parse(queryKey))
        .then((data) => {
          setAnalytics(data);
          setUpdatedAt(new Date());
        })
        .catch((err) => !silent && setError(err.response?.data?.message || "Couldn't load the reports. Check your connection and try again."))
        .finally(() => !silent && setLoading(false));
    },
    [queryKey]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Figures follow new sales/purchases/expenses on their own: refresh every
  // minute while the tab is visible, and whenever the window regains focus.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      load(true);
      setRefreshKey((k) => k + 1);
    };
    const timer = setInterval(refresh, REFRESH_MS);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  const range = { from: state.from, to: state.to };
  const periodLabel = presetFor(range)?.label || `${fullDate(state.from)} – ${fullDate(state.to)}`;
  const a = analytics;

  return (
    <Layout toolbar={<DateFilter range={range} onChange={(r) => update(r)} />}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-gradient font-display text-3xl font-extrabold tracking-tight sm:text-[34px]">Reports &amp; Analytics</h1>
          <p className="mt-1 text-sm text-muted">
            {periodLabel}
            {a?.previousPeriod ? ` · compared with ${fullDate(a.previousPeriod.from)} – ${fullDate(a.previousPeriod.to)}` : ""}
            {updatedAt ? ` · updated ${updatedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              load();
              setRefreshKey((k) => k + 1);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-semibold text-text transition hover:border-primary/30"
            aria-label="Refresh figures"
          >
            <Icon name="pulse" size={16} />
            Refresh
          </button>
          {canExport && (
            <button
              onClick={() => setExporting(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_-8px_rgba(14,124,116,0.8)] transition hover:bg-primary-dark"
            >
              <Icon name="download" size={16} />
              Export PDF / Excel
            </button>
          )}
        </div>
      </div>

      <div className="mt-5">
        <FiltersBar state={state} update={update} options={options} />
      </div>

      <nav className="mt-5 flex gap-1 overflow-x-auto border-b border-border" aria-label="Report sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => update({ tab: t.key })}
            aria-current={state.tab === t.key ? "page" : undefined}
            className={`-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-semibold transition ${
              state.tab === t.key ? "border-primary text-primary" : "border-transparent text-muted hover:text-text"
            }`}
          >
            <Icon name={t.icon} size={15} />
            {t.label}
          </button>
        ))}
      </nav>

      {error && (
        <div className="mt-6 flex items-center justify-between gap-3 rounded-2xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
          <span className="flex items-center gap-2">
            <Icon name="alert" size={17} />
            {error}
          </span>
          <button onClick={() => load()} className="rounded-lg px-3 py-1 font-semibold hover:bg-danger/10">
            Retry
          </button>
        </div>
      )}

      {loading && !a && (
        <div className="mt-6 space-y-6" aria-busy="true" aria-label="Loading reports">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="card space-y-3 p-5">
                <div className="skeleton h-3 w-24" />
                <div className="skeleton h-7 w-32" />
              </div>
            ))}
          </div>
          <div className="card skeleton h-72" />
        </div>
      )}

      {a && (
        <div className={`mt-6 space-y-6 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {!a.hasData && ["overview", "sales", "finance"].includes(state.tab) && <NoDataNotice hasProducts={(options?.products?.length ?? 1) > 0} />}
          {state.tab === "overview" && <Overview a={a} update={update} goTab={(tab) => update({ tab })} />}
          {state.tab === "sales" && <SalesTab a={a} update={update} />}
          {state.tab === "inventory" && <InventoryTab a={a} />}
          {state.tab === "finance" && <FinanceTab a={a} />}
        </div>
      )}
      {state.tab === "transactions" && (
        <div className="mt-6">
          <TransactionsPanel params={query} refreshKey={refreshKey} />
        </div>
      )}
      {state.tab === "catalog" && (
        <div className="mt-6">
          <CatalogPanel params={Object.fromEntries(FILTER_KEYS.filter((k) => k !== "paymentMode").map((k) => [k, state[k]]))} refreshKey={refreshKey} canEdit={can(user, "products.add")} />
        </div>
      )}

      {exporting && (
        <ExportDialog
          params={query}
          periodLabel={periodLabel}
          onApplyPeriod={({ preset, granularity }) => update({ ...(preset ? presetRange(preset) : {}), ...(granularity !== undefined ? { granularity } : {}) })}
          onClose={() => setExporting(false)}
        />
      )}
    </Layout>
  );
}
