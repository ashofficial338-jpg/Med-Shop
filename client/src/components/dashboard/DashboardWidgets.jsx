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
// With `to`, the whole tile is a link to the records behind the figure.
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
      {to && (
        <p className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-primary opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
          View details
          <Icon name="arrowRight" size={12} />
        </p>
      )}
    </>
  );
  const cls = "card card-hover fade-up group block min-w-0 p-5";
  return to ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

// Renders a Link when `to` is set, otherwise the same content without one
// (view-only dashboards pass no links).
function MaybeLink({ to, className, children }) {
  return to ? (
    <Link to={to} className={className}>
      {children}
    </Link>
  ) : (
    <div className={className}>{children}</div>
  );
}

// links.product etc. are absent for view-only users.
const linkOf = (fn, arg) => (fn ? fn(arg) : undefined);

export function ViewAll({ to, label = "View all" }) {
  if (!to) return null;
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

export function EmptyRow({ icon = "check", title, text }) {
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

export function TopSelling({ items, links }) {
  const max = Math.max(...items.map((i) => i.totalRevenue), 1);
  return (
    <ChartCard title="Top 5 Products by Revenue" subtitle="Best sellers this period · click a product for details" action={<ViewAll to={links.profitability} label="Full report" />}>
      {items.length === 0 ? (
        <EmptyRow icon="pill" title="No records found" text="Your best sellers will rank here once sales come in." />
      ) : (
        <ol className="grid gap-x-8 gap-y-1.5 md:grid-cols-2">
          {items.map((p, i) => (
            <li key={p.productId}>
              <MaybeLink to={linkOf(links.product, p.productId)} className="block rounded-lg px-1.5 py-1.5 transition hover:bg-bg">
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
              </MaybeLink>
            </li>
          ))}
        </ol>
      )}
    </ChartCard>
  );
}

export function LowStockList({ items, links }) {
  return (
    <ChartCard
      title="Low Stock"
      subtitle={`${items.length} item${items.length === 1 ? "" : "s"} at or below reorder level`}
      action={<ViewAll to={links.lowStock} />}
    >
      {items.length === 0 ? (
        <EmptyRow title="Nothing low on stock" />
      ) : (
        <ul className="space-y-3">
          {items.map((p) => {
            const pct = Math.min(100, (p.qty / Math.max(p.lowStockThreshold, 1)) * 100);
            return (
              <li key={p._id}>
                <MaybeLink to={linkOf(links.product, p._id)} className="block rounded-xl border border-border px-3 py-2.5 transition hover:border-primary/30 hover:bg-bg">
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
                </MaybeLink>
              </li>
            );
          })}
        </ul>
      )}
    </ChartCard>
  );
}

export function ExpiringList({ items, links }) {
  return (
    <ChartCard title="Expiring Soon" subtitle="Batches expiring in the next 30 days" action={<ViewAll to={links.expiry} />}>
      {items.length === 0 ? (
        <EmptyRow title="Nothing expiring soon" text="No batches expire in the next 30 days." />
      ) : (
        <ul className="divide-y divide-border/70">
          {items.map((b) => {
            const d = daysUntil(b.expiryDate);
            const cls = d < 0 ? "bg-danger text-white" : d <= 7 ? "bg-danger/10 text-danger" : "bg-warning/10 text-warning";
            return (
              <li key={b._id}>
                <MaybeLink to={links.expiry} className="-mx-1.5 flex items-center gap-3 rounded-lg px-1.5 py-2.5 transition hover:bg-bg">
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
                </MaybeLink>
              </li>
            );
          })}
        </ul>
      )}
    </ChartCard>
  );
}

// One line of a statement (P&L, turnover). With `to` the row links to the
// records behind the figure.
function StatementRow({ label, value, sign, strong, tone = "text-text", note, display, to }) {
  const cls = `flex items-baseline justify-between gap-3 py-2 ${strong ? "border-t border-border font-semibold" : ""}`;
  const body = (
    <>
      <span className="text-sm text-text">
        {sign && <span className="mr-1.5 inline-block w-3 text-muted">{sign}</span>}
        <span className={to ? "underline decoration-border decoration-dotted underline-offset-4 group-hover:decoration-primary" : ""}>{label}</span>
        {note && <span className="ml-1.5 text-xs font-normal text-muted">{note}</span>}
      </span>
      <span className={`flex shrink-0 items-center gap-1 text-sm tnum ${tone}`}>
        {display ?? money2(value)}
        {to && <Icon name="arrowRight" size={13} className="text-muted transition group-hover:text-primary" />}
      </span>
    </>
  );
  return to ? (
    <Link to={to} className={`${cls} group -mx-2 rounded-lg px-2 transition hover:bg-bg`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

const isFiltered = (summary) => Boolean(summary.filters?.category || summary.filters?.paymentMode);

// Net result = revenue (net of GST & discount) - cost of goods sold - expenses
// - expired stock written off; all computed server-side in dashboard.js.
export function ProfitLoss({ summary, range, links }) {
  const isProfit = summary.profit >= 0;
  const tone = isProfit ? "text-success" : "text-danger";
  const grossTone = summary.grossProfit >= 0 ? "text-success" : "text-danger";
  const filtered = isFiltered(summary);

  return (
    <section className="space-y-4" aria-label="Profit and Loss">
      <ChartCard
        title="Profit & Loss"
        subtitle={`${fullDate(range.from)} – ${fullDate(range.to)}${filtered ? " · filtered" : ""}`}
        action={<ViewAll to={links.profitability} label="By product" />}
      >
        <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <MaybeLink
            to={links.profitability}
            className={`group relative flex flex-col justify-center overflow-hidden rounded-2xl p-6 transition hover:brightness-[0.98] ${
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
          </MaybeLink>

          <div>
            <StatementRow label="Total Sales (Revenue)" value={summary.revenue} note="excl. GST, after discounts" to={links.sales} />
            <StatementRow sign="−" label="Cost of Goods Sold" value={summary.cogs} to={links.profitability} />
            <StatementRow
              strong
              sign="="
              label="Gross Profit"
              value={summary.grossProfit}
              tone={grossTone}
              note={summary.grossMarginPct === null ? "" : `${summary.grossMarginPct}% margin`}
              to={links.profitability}
            />
            <StatementRow
              sign="−"
              label="Expenses"
              value={summary.expenses}
              note={filtered ? `share of ${money2(summary.totalExpenses)}` : ""}
              to={links.expenses}
            />
            <StatementRow sign="−" label="Expired Stock Write-off" value={summary.expiredWriteOff} to={links.writeOffs} />
            <StatementRow
              strong
              sign="="
              label={isProfit ? "Net Profit" : "Net Loss"}
              value={isProfit ? summary.netProfit : summary.netLoss}
              tone={tone}
              to={links.profitability}
            />
          </div>
        </div>
      </ChartCard>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Total Sales" value={summary.revenue} icon="rupee" tone="teal" to={links.sales} />
        <StatTile label="Total Purchases" value={summary.totalPurchases} icon="truck" tone="blue" to={links.purchases} />
        <StatTile label="Total Expenses" value={summary.expenses} icon="wallet" tone="warning" to={links.expenses} />
        <StatTile
          label="Net Profit"
          value={summary.netProfit}
          icon="trendUp"
          tone="success"
          valueTone={summary.netProfit > 0 ? "success" : "text"}
          to={links.profitability}
        />
        <StatTile
          label="Net Loss"
          value={summary.netLoss}
          icon="trendDown"
          tone="danger"
          valueTone={summary.netLoss > 0 ? "danger" : "text"}
          to={links.profitability}
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

// Per-product figures come from dashboard.js:
// ROI (%) = Net Profit / Product Investment x 100, where
// Net Profit = (Sales Revenue - COGS) - Allocated Expenses.
// Shared by the dashboard (top rows) and the full Product Profitability report.
const PROFIT_COLUMNS = [
  { key: "name", label: "Product", align: "left" },
  { key: "investment", label: "Investment" },
  { key: "revenue", label: "Revenue" },
  { key: "grossProfit", label: "Gross Profit" },
  { key: "allocatedExpenses", label: "Alloc. Expenses" },
  { key: "netProfit", label: "Net Profit" },
  { key: "roiPct", label: "ROI" },
];

export function ProfitabilityTable({ rows, linkForProduct, sort, onSort }) {
  const arrow = (key) => (sort?.key === key ? (sort.dir === "asc" ? " ↑" : " ↓") : "");
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wide text-muted">
            {PROFIT_COLUMNS.map((c, i) => (
              <th
                key={c.key}
                className={`py-2 font-semibold ${c.align === "left" ? "text-left" : "text-right"} ${i === 0 ? "pr-3" : i === PROFIT_COLUMNS.length - 1 ? "pl-3" : "px-3"}`}
                aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
              >
                {onSort ? (
                  <button onClick={() => onSort(c.key)} className="uppercase tracking-wide transition hover:text-primary">
                    {c.label}
                    {arrow(c.key)}
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {rows.map((p) => (
            <tr key={p.productId} className="transition hover:bg-bg">
              <td className="max-w-[16rem] truncate py-2.5 pr-3 font-medium">
                {linkForProduct && p.productId && p.productId !== "null" ? (
                  <Link to={linkForProduct(p.productId)} className="text-text hover:text-primary hover:underline">
                    {p.name}
                  </Link>
                ) : (
                  <span className="text-text">{p.name}</span>
                )}
              </td>
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
  );
}

const PRODUCT_ROWS = 10;

export function ProductProfitability({ summary, links }) {
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
  const roiTone = summary.roiPct === null ? "text" : summary.roiPct > 0 ? "success" : summary.roiPct < 0 ? "danger" : "text";
  const netTone = summary.profit > 0 ? "success" : summary.profit < 0 ? "danger" : "text";

  return (
    <section className="space-y-4" aria-label="Product Profitability and ROI">
      <SectionTitle icon="chart" action={<ViewAll to={links.profitability} label="Full report" />}>
        Product Profitability &amp; ROI
      </SectionTitle>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Product Investment" value={summary.investment} icon="boxes" tone="blue" note="Cost of goods sold" to={links.profitability} />
        <StatTile label="Sales Revenue" value={summary.revenue} icon="rupee" tone="teal" note="Excl. GST, after discounts" to={links.sales} />
        <StatTile label="Gross Profit" value={summary.grossProfit} icon="trendUp" tone="success" note="Revenue − COGS" to={links.profitability} />
        <StatTile
          label="Allocated Expenses"
          value={summary.allocatedExpenses}
          icon="wallet"
          tone="warning"
          note="Expenses + expired write-off"
          to={links.expenses}
        />
        <StatTile
          label="Net Profit"
          value={summary.profit}
          icon="trendUp"
          tone="success"
          valueTone={netTone}
          note="Gross profit − expenses"
          to={links.profitability}
        />
        <StatTile
          label="ROI (%)"
          display={percent(summary.roiPct)}
          icon="chart"
          tone="violet"
          valueTone={roiTone}
          note="Net profit ÷ investment × 100"
          to={links.profitability}
        />
      </div>

      <ChartCard
        title="Profitability by Product"
        subtitle="Expenses are shared across products by their share of revenue; expired write-offs go to their own product"
        action={<ViewAll to={links.profitability} label={rows.length > PRODUCT_ROWS ? `All ${rows.length}` : "Full report"} />}
      >
        {rows.length === 0 ? (
          <EmptyRow icon="pill" title="No records found" text="Product profit and ROI will show here once sales come in." />
        ) : (
          <ProfitabilityTable rows={rows.slice(0, PRODUCT_ROWS)} linkForProduct={links.product} />
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

// Inventory Turnover Ratio = COGS / Average Inventory, with
// Average Inventory = (Opening + Closing Inventory) / 2 - computed in dashboard.js.
export function InventoryTurnover({ summary, range, links }) {
  // Older backend builds don't send these fields - see ProductProfitability.
  if (summary.inventoryTurnover === undefined) {
    return (
      <ChartCard title="Inventory Turnover Ratio">
        <EmptyRow
          icon="alert"
          title="Not available yet"
          text="The server hasn't been updated with inventory turnover. Redeploy the backend to see this figure."
        />
      </ChartCard>
    );
  }

  const ratio = summary.inventoryTurnover;
  const ratioText = ratio === null ? "—" : `${ratio.toFixed(2)}×`;
  return (
    <ChartCard
      title="Inventory Turnover Ratio"
      subtitle={`${fullDate(range.from)} – ${fullDate(range.to)}`}
      action={<ViewAll to={links.stockReport} label="Stock report" />}
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <MaybeLink
          to={links.stockReport}
          className="relative flex flex-col justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-info-soft to-primary-soft p-6 transition hover:brightness-[0.98]"
        >
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-info">
            <Icon name="boxes" size={15} strokeWidth={2} />
            Turnover
          </p>
          <p className="mt-2 font-display text-3xl font-bold text-text tnum sm:text-4xl">{ratioText}</p>
          <p className="mt-2 text-xs text-muted">
            {ratio === null
              ? "No stock on hand in this period."
              : `Stock was sold through about ${ratio.toFixed(1)} time${ratio === 1 ? "" : "s"} in this period.`}
          </p>
          <Icon name="boxes" size={110} strokeWidth={1} className="pointer-events-none absolute -bottom-5 -right-3 text-info opacity-[0.07]" />
        </MaybeLink>

        <div>
          <StatementRow label="Opening Inventory" value={summary.openingInventory} note="at cost, start of period" to={links.stockReport} />
          <StatementRow sign="+" label="Closing Inventory" value={summary.closingInventory} note="at cost, end of period" to={links.stockReport} />
          <StatementRow strong sign="÷" label="Average Inventory" value={summary.averageInventory} note="(opening + closing) ÷ 2" />
          <StatementRow label="Cost of Goods Sold" value={summary.cogs} to={links.profitability} />
          <StatementRow strong sign="=" label="Turnover Ratio" note="COGS ÷ average inventory" display={ratioText} />
        </div>
      </div>
    </ChartCard>
  );
}

// EBITDA = Net Profit + Interest + Taxes + Depreciation + Amortization, all
// computed in dashboard.js. The four add-backs are expense categories, so each
// row links to those expenses for the period.
export function Ebitda({ summary, range, links }) {
  // Older backend builds don't send these fields - see ProductProfitability.
  if (summary.ebitda === undefined) {
    return (
      <ChartCard title="EBITDA">
        <EmptyRow
          icon="alert"
          title="Not available yet"
          text="The server hasn't been updated with EBITDA. Redeploy the backend to see this figure."
        />
      </ChartCard>
    );
  }

  const positive = summary.ebitda >= 0;
  const tone = positive ? "text-success" : "text-danger";
  const filtered = isFiltered(summary);
  const addBacks = [
    ["Interest", summary.interest],
    ["Taxes", summary.taxes],
    ["Depreciation", summary.depreciation],
    ["Amortization", summary.amortization],
  ];
  const noAddBacks = addBacks.every(([, v]) => v === 0);

  return (
    <ChartCard
      title="EBITDA"
      subtitle={`Earnings before interest, taxes, depreciation & amortization · ${fullDate(range.from)} – ${fullDate(range.to)}${filtered ? " · filtered" : ""}`}
      action={<ViewAll to={links.expenses} label="Expenses" />}
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div
          className={`relative flex flex-col justify-center overflow-hidden rounded-2xl p-6 ${
            positive ? "bg-gradient-to-br from-success/10 to-info-soft" : "bg-gradient-to-br from-danger/10 to-bg"
          }`}
        >
          <p className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${tone}`}>
            <Icon name="chart" size={15} strokeWidth={2} />
            EBITDA
          </p>
          <p className={`mt-2 break-all font-display text-3xl font-bold tnum sm:text-4xl ${tone}`}>{money2(summary.ebitda)}</p>
          <p className="mt-2 text-xs text-muted">
            {summary.ebitdaMarginPct === null ? "No sales in this period." : `EBITDA margin ${summary.ebitdaMarginPct}% of revenue`}
          </p>
          <Icon name="chart" size={110} strokeWidth={1} className={`pointer-events-none absolute -bottom-5 -right-3 opacity-[0.07] ${tone}`} />
        </div>

        <div>
          <StatementRow
            label={summary.profit >= 0 ? "Net Profit" : "Net Loss"}
            value={summary.profit}
            tone={summary.profit >= 0 ? "text-success" : "text-danger"}
            to={links.profitability}
          />
          {addBacks.map(([label, value]) => (
            <StatementRow key={label} sign="+" label={label} value={value} to={linkOf(links.expenseCategory, label)} />
          ))}
          <StatementRow strong sign="=" label="EBITDA" value={summary.ebitda} tone={tone} />
          {noAddBacks && (
            <p className="mt-2 text-xs text-muted">
              No interest, tax, depreciation or amortization recorded for this period, so EBITDA equals net profit. Record them
              as expenses with those categories.
            </p>
          )}
        </div>
      </div>
    </ChartCard>
  );
}
