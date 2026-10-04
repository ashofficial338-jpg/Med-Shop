import { useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../Icon";
import { ChartCard } from "./DashboardCharts";
import { money, money2, count, percent, fullDate, daysUntil } from "./format";

const TONES = {
  teal: "bg-primary-soft text-primary",
  blue: "bg-info-soft text-info",
  violet: "bg-[#f0eefc] text-[#5b4fc4]",
  slate: "bg-bg text-text",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
};

const VALUE_TONES = { text: "text-text", success: "text-success", danger: "text-danger" };

export function SectionTitle({ icon, children, action }) {
  return (
    <div className="flex items-center justify-between gap-3 pt-2">
      <h2 className="flex items-center gap-2.5 font-display text-lg font-bold tracking-tight text-text">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-soft text-primary">
          <Icon name={icon} size={17} />
        </span>
        {children}
      </h2>
      {action}
    </div>
  );
}

// `value` is ₹ unless `isCount` is set; `display` overrides the formatting entirely.
export function StatTile({ label, value, icon, tone = "teal", valueTone = "text", isCount, display, note, to }) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-medium text-muted">{label}</p>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${TONES[tone]}`}>
          <Icon name={icon} size={17} />
        </span>
      </div>
      <p className={`mt-2 font-display text-2xl font-bold leading-tight tracking-tight tnum ${VALUE_TONES[valueTone]}`}>
        {display ?? (isCount ? count(value) : money2(value))}
      </p>
      {note && <p className="mt-1 text-[11px] text-muted">{note}</p>}
    </>
  );
  const cls = "card card-hover fade-up block min-w-0 p-5";
  return to ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function ViewAll({ to, label = "View all" }) {
  return (
    <Link
      to={to}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-primary transition hover:bg-primary-soft"
    >
      {label}
      <Icon name="arrowRight" size={14} />
    </Link>
  );
}

function EmptyRow({ icon = "check", title, text }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-soft text-primary">
        <Icon name={icon} size={18} />
      </span>
      <p className="text-sm font-medium text-text">{title}</p>
      {text && <p className="max-w-[18rem] text-xs text-muted">{text}</p>}
    </div>
  );
}

export function TopSelling({ items }) {
  const max = Math.max(...items.map((i) => i.totalRevenue), 1);
  return (
    <ChartCard title="Top 5 Products by Revenue" subtitle="Best sellers this period" action={<ViewAll to="/products" />}>
      {items.length === 0 ? (
        <EmptyRow icon="pill" title="No records found" text="Your best sellers will rank here once sales come in." />
      ) : (
        <ol className="grid gap-x-8 gap-y-3.5 md:grid-cols-2">
          {items.map((p, i) => (
            <li key={p.productId}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold tnum ${
                      i === 0 ? "bg-primary text-white" : "bg-bg text-muted"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="truncate font-medium text-text">{p.name}</span>
                </span>
                <span className="shrink-0 font-semibold text-text tnum">{money(p.totalRevenue)}</span>
              </div>
              <div className="ml-[34px] mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-[#1baf7a] transition-all duration-700"
                  style={{ width: `${(p.totalRevenue / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </ChartCard>
  );
}

export function LowStockList({ items }) {
  return (
    <ChartCard
      title="Low Stock"
      subtitle={`${items.length} item${items.length === 1 ? "" : "s"} at or below reorder level`}
      action={<ViewAll to="/stock" />}
    >
      {items.length === 0 ? (
        <EmptyRow title="Nothing low on stock" />
      ) : (
        <ul className="space-y-3">
          {items.map((p) => {
            const pct = Math.min(100, (p.qty / Math.max(p.lowStockThreshold, 1)) * 100);
            return (
              <li key={p._id} className="rounded-xl border border-border px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-text">{p.name}</span>
                    <span className="block font-mono text-[11px] text-muted">{p.productCode}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning tnum">
                    {p.qty} left
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg">
                    <span className="block h-full rounded-full bg-[#e0a126]" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="text-[10px] text-muted tnum">min {p.lowStockThreshold}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </ChartCard>
  );
}

export function ExpiringList({ items }) {
  return (
    <ChartCard title="Expiring Soon" subtitle="Batches expiring in the next 30 days" action={<ViewAll to="/stock" />}>
      {items.length === 0 ? (
        <EmptyRow title="Nothing expiring soon" text="No batches expire in the next 30 days." />
      ) : (
        <ul className="divide-y divide-border/70">
          {items.map((b) => {
            const d = daysUntil(b.expiryDate);
            const cls = d < 0 ? "bg-danger text-white" : d <= 7 ? "bg-danger/10 text-danger" : "bg-warning/10 text-warning";
            return (
              <li key={b._id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-danger/10 text-danger">
                  <Icon name="hourglass" size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-text">
                    {b.product?.name} <span className="font-mono text-[11px] font-normal text-muted">({b.product?.productCode})</span>
                  </span>
                  <span className="block text-[11px] text-muted">
                    Batch {b.batchNo} · {fullDate(b.expiryDate)}
                  </span>
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tnum ${cls}`}>
                  {d < 0 ? "Expired" : d === 0 ? "Today" : `${d}d left`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </ChartCard>
  );
}

function StatementRow({ label, value, sign, strong, tone = "text-text", note }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-2 ${strong ? "border-t border-border font-semibold" : ""}`}>
      <span className="text-sm text-text">
        {sign && <span className="mr-1.5 inline-block w-3 text-muted">{sign}</span>}
        {label}
        {note && <span className="ml-1.5 text-xs font-normal text-muted">{note}</span>}
      </span>
      <span className={`shrink-0 text-sm tnum ${tone}`}>{money2(value)}</span>
    </div>
  );
}

// Net result = revenue (net of GST & discount) - cost of goods sold - expenses
// - expired stock written off; all computed server-side in dashboard.js.
export function ProfitLoss({ summary, range }) {
  const isProfit = summary.profit >= 0;
  const tone = isProfit ? "text-success" : "text-danger";
  const grossTone = summary.grossProfit >= 0 ? "text-success" : "text-danger";

  return (
    <section className="space-y-4" aria-label="Profit and Loss">
      <ChartCard title="Profit & Loss" subtitle={`${fullDate(range.from)} – ${fullDate(range.to)}`}>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div
            className={`relative flex flex-col justify-center overflow-hidden rounded-2xl p-6 ${
              isProfit ? "bg-gradient-to-br from-success/10 to-primary-soft" : "bg-gradient-to-br from-danger/10 to-bg"
            }`}
          >
            <p className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${tone}`}>
              <Icon name={isProfit ? "trendUp" : "trendDown"} size={15} strokeWidth={2} />
              {isProfit ? "Net profit" : "Net loss"}
            </p>
            <p className={`mt-2 break-all font-display text-3xl font-bold tnum sm:text-4xl ${tone}`}>
              {money2(isProfit ? summary.netProfit : summary.netLoss)}
            </p>
            <p className="mt-2 text-xs text-muted">
              {summary.netMarginPct === null
                ? "No sales in this period."
                : `${isProfit ? "Net margin" : "Loss equals"} ${Math.abs(summary.netMarginPct)}% of revenue · ${summary.salesCount} sale${summary.salesCount === 1 ? "" : "s"}`}
            </p>
            <Icon name="rupee" size={110} strokeWidth={1} className={`pointer-events-none absolute -bottom-5 -right-3 opacity-[0.07] ${tone}`} />
          </div>

          <div>
            <StatementRow label="Total Sales (Revenue)" value={summary.revenue} note="excl. GST, after discounts" />
            <StatementRow sign="−" label="Cost of Goods Sold" value={summary.cogs} />
            <StatementRow
              strong
              sign="="
              label="Gross Profit"
              value={summary.grossProfit}
              tone={grossTone}
              note={summary.grossMarginPct === null ? "" : `${summary.grossMarginPct}% margin`}
            />
            <StatementRow sign="−" label="Expenses" value={summary.expenses} />
            <StatementRow sign="−" label="Expired Stock Write-off" value={summary.expiredWriteOff} />
            <StatementRow
              strong
              sign="="
              label={isProfit ? "Net Profit" : "Net Loss"}
              value={isProfit ? summary.netProfit : summary.netLoss}
              tone={tone}
            />
          </div>
        </div>
      </ChartCard>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Total Sales" value={summary.revenue} icon="rupee" tone="teal" />
        <StatTile label="Total Purchases" value={summary.totalPurchases} icon="truck" tone="blue" />
        <StatTile label="Total Expenses" value={summary.expenses} icon="wallet" tone="warning" />
        <StatTile
          label="Net Profit"
          value={summary.netProfit}
          icon="trendUp"
          tone="success"
          valueTone={summary.netProfit > 0 ? "success" : "text"}
        />
        <StatTile
          label="Net Loss"
          value={summary.netLoss}
          icon="trendDown"
          tone="danger"
          valueTone={summary.netLoss > 0 ? "danger" : "text"}
        />
      </div>
      <p className="text-xs text-muted">
        Purchases are stock bought in this period. They count as cost only when that stock is sold (Cost of Goods Sold), so
        they are not subtracted again.
      </p>
    </section>
  );
}

const signTone = (n) => (n > 0 ? "text-success" : n < 0 ? "text-danger" : "text-text");
const PRODUCT_ROWS = 10;

// Per-product figures come from dashboard.js:
// ROI (%) = Net Profit / Product Investment x 100, where
// Net Profit = (Sales Revenue - COGS) - Allocated Expenses.
export function ProductProfitability({ summary }) {
  const [showAll, setShowAll] = useState(false);

  // The frontend (Vercel) and backend (Render) deploy separately, so the API
  // can briefly be an older build without these fields - show a notice
  // instead of crashing the whole dashboard on undefined.
  if (!Array.isArray(summary.productProfitability)) {
    return (
      <section className="space-y-4" aria-label="Product Profitability and ROI">
        <SectionTitle icon="chart">Product Profitability &amp; ROI</SectionTitle>
        <ChartCard title="Profitability by Product">
          <EmptyRow
            icon="alert"
            title="Not available yet"
            text="The server hasn't been updated with product ROI. Redeploy the backend to see these figures."
          />
        </ChartCard>
      </section>
    );
  }

  const rows = summary.productProfitability;
  const visible = showAll ? rows : rows.slice(0, PRODUCT_ROWS);
  const roiTone = summary.roiPct === null ? "text" : summary.roiPct > 0 ? "success" : summary.roiPct < 0 ? "danger" : "text";
  const netTone = summary.profit > 0 ? "success" : summary.profit < 0 ? "danger" : "text";

  return (
    <section className="space-y-4" aria-label="Product Profitability and ROI">
      <SectionTitle icon="chart">Product Profitability &amp; ROI</SectionTitle>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Product Investment" value={summary.investment} icon="boxes" tone="blue" note="Cost of goods sold" />
        <StatTile label="Sales Revenue" value={summary.revenue} icon="rupee" tone="teal" note="Excl. GST, after discounts" />
        <StatTile label="Gross Profit" value={summary.grossProfit} icon="trendUp" tone="success" note="Revenue − COGS" />
        <StatTile
          label="Allocated Expenses"
          value={summary.allocatedExpenses}
          icon="wallet"
          tone="warning"
          note="Expenses + expired write-off"
        />
        <StatTile label="Net Profit" value={summary.profit} icon="trendUp" tone="success" valueTone={netTone} note="Gross profit − expenses" />
        <StatTile
          label="ROI (%)"
          display={percent(summary.roiPct)}
          icon="chart"
          tone="violet"
          valueTone={roiTone}
          note="Net profit ÷ investment × 100"
        />
      </div>

      <ChartCard
        title="Profitability by Product"
        subtitle="Expenses are shared across products by their share of revenue; expired write-offs go to their own product"
      >
        {rows.length === 0 ? (
          <EmptyRow icon="pill" title="No records found" text="Product profit and ROI will show here once sales come in." />
        ) : (
          <>
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                    <th className="py-2 pr-3 font-semibold">Product</th>
                    <th className="px-3 py-2 text-right font-semibold">Investment</th>
                    <th className="px-3 py-2 text-right font-semibold">Revenue</th>
                    <th className="px-3 py-2 text-right font-semibold">Gross Profit</th>
                    <th className="px-3 py-2 text-right font-semibold">Alloc. Expenses</th>
                    <th className="px-3 py-2 text-right font-semibold">Net Profit</th>
                    <th className="py-2 pl-3 text-right font-semibold">ROI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {visible.map((p) => (
                    <tr key={p.productId}>
                      <td className="max-w-[16rem] truncate py-2.5 pr-3 font-medium text-text">{p.name}</td>
                      <td className="px-3 py-2.5 text-right text-text tnum">{money2(p.investment)}</td>
                      <td className="px-3 py-2.5 text-right text-text tnum">{money2(p.revenue)}</td>
                      <td className={`px-3 py-2.5 text-right tnum ${signTone(p.grossProfit)}`}>{money2(p.grossProfit)}</td>
                      <td className="px-3 py-2.5 text-right text-text tnum">{money2(p.allocatedExpenses)}</td>
                      <td className={`px-3 py-2.5 text-right font-semibold tnum ${signTone(p.netProfit)}`}>{money2(p.netProfit)}</td>
                      <td className={`py-2.5 pl-3 text-right font-semibold tnum ${signTone(p.roiPct ?? 0)}`}>{percent(p.roiPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > PRODUCT_ROWS && (
              <button
                onClick={() => setShowAll((v) => !v)}
                className="mt-3 rounded-lg px-2 py-1 text-xs font-semibold text-primary transition hover:bg-primary-soft"
              >
                {showAll ? "Show top 10" : `Show all ${rows.length} products`}
              </button>
            )}
          </>
        )}
        {summary.unallocatedExpenses > 0 && (
          <p className="mt-3 text-xs text-muted">
            {money2(summary.unallocatedExpenses)} of expenses could not be allocated because there were no sales in this period.
          </p>
        )}
      </ChartCard>
    </section>
  );
}
