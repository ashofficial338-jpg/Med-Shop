import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from "recharts";
import Icon from "../Icon";
import { ChartCard, EmptyChart, LegendItem, TooltipCard } from "../dashboard/DashboardCharts";
import { EmptyRow, SectionTitle } from "../dashboard/DashboardWidgets";
import { count, fullDate, money2, moneyCompact, percent } from "../dashboard/format";
import { COLORS, KpiCard, RankBars, axisLabel, changeOf } from "./ReportCharts";
import { DataTable } from "./ReportTables";
import { getConsolidated } from "../../api/reports";

const GRID = "#edf0f3";
const AXIS = { fontSize: 11, fill: "#7b8793" };

// Sales vs total costs vs net profit per month or financial year - all in ₹,
// so one axis.
function ComparisonChart({ rows, title, subtitle }) {
  const data = rows.map((r) => ({ ...r, costs: Number((r.cogs + r.expenses + r.writeOff).toFixed(2)) }));
  const empty = data.every((d) => !d.sales && !d.costs);
  return (
    <ChartCard title={title} subtitle={subtitle}>
      <div className="mb-3 flex flex-wrap gap-4">
        <LegendItem color={COLORS.revenue} label="Total sales" />
        <LegendItem color={COLORS.costs} label="Total costs" />
        <LegendItem color={COLORS.profit} label="Net profit" />
      </div>
      {empty ? (
        <EmptyChart height={280} />
      ) : (
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tickFormatter={axisLabel} tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={14} dy={6} />
              <YAxis tickFormatter={moneyCompact} tick={AXIS} axisLine={false} tickLine={false} width={56} />
              <ReferenceLine y={0} stroke="#c9d1d8" />
              <Tooltip content={<TooltipCard />} cursor={{ fill: "rgba(14,124,116,0.05)" }} />
              <Bar dataKey="sales" name="Total sales" fill={COLORS.revenue} radius={[4, 4, 0, 0]} maxBarSize={20} />
              <Bar dataKey="costs" name="Total costs" fill={COLORS.costs} radius={[4, 4, 0, 0]} maxBarSize={20} />
              <Bar dataKey="profit" name="Net profit" fill={COLORS.profit} radius={[4, 4, 0, 0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

const changeTone = (v) => (v > 0 ? "text-success" : v < 0 ? "text-danger" : "text-muted");
const trendColumns = (label) => [
  { key: "label", label },
  { key: "sales", label: "Total sales", type: "money" },
  { key: "revenue", label: "Revenue", type: "money" },
  { key: "purchases", label: "Purchases", type: "money" },
  { key: "expenses", label: "Expenses", type: "money" },
  { key: "profit", label: "Net profit", type: "signed" },
  { key: "marginPct", label: "Margin", type: "pct" },
  { key: "salesChangePct", label: "Sales chg", type: "pct", tone: (r) => changeTone(r.salesChangePct) },
  { key: "profitChangePct", label: "Profit chg", type: "pct", tone: (r) => changeTone(r.profitChangePct) },
];
const sum = (rows, key) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
const trendTotals = (rows) => ({ sales: sum(rows, "sales"), revenue: sum(rows, "revenue"), purchases: sum(rows, "purchases"), expenses: sum(rows, "expenses"), profit: sum(rows, "profit") });

function Statement({ lines, total }) {
  return (
    <dl className="divide-y divide-border/70 text-sm">
      {lines.map((l) => (
        <div key={l.label} className="flex justify-between gap-4 py-2">
          <dt className="text-text">{l.label}</dt>
          <dd className={`tnum ${l.amount < 0 ? "text-danger" : "text-text"}`}>{money2(l.amount)}</dd>
        </div>
      ))}
      {total && (
        <div className="flex justify-between gap-4 py-2 font-semibold">
          <dt className="text-text">{total.label}</dt>
          <dd className={`tnum ${total.amount < 0 ? "text-danger" : "text-success"}`}>{money2(total.amount)}</dd>
        </div>
      )}
    </dl>
  );
}

const expiryColumns = [
  { key: "name", label: "Medicine", render: (r) => <Link to={`/products?product=${r.productId}`} className="text-text hover:text-primary hover:underline">{r.name}</Link> },
  { key: "batchNo", label: "Batch" },
  { key: "expiryDate", label: "Expiry", type: "date" },
  { key: "daysLeft", label: "Days", type: "int", tone: (r) => (r.daysLeft < 0 ? "text-danger" : r.daysLeft <= 30 ? "text-warning" : "text-text") },
  { key: "qtyRemaining", label: "Qty", type: "int" },
  { key: "valueCost", label: "Value (cost)", type: "money" },
];

// Medical Shop Consolidated Financial Report: every headline figure of the
// shop's financial health on one screen, from GET /reports/consolidated.
export default function ConsolidatedReport({ params, refreshKey, goTab }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [against, setAgainst] = useState("previous");
  const [view, setView] = useState("monthly");
  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    getConsolidated(JSON.parse(paramsKey))
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(err.response?.data?.message || "Couldn't load the consolidated report. Please try again."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [paramsKey, refreshKey]);

  if (error && !data) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
        <Icon name="alert" size={17} />
        {error}
      </div>
    );
  }
  if (!data) return <div className="card skeleton h-96" aria-busy="true" aria-label="Loading consolidated report" />;

  const m = data.metrics;
  const base = against === "lastYear" ? data.comparisons.lastYear : data.comparisons.previous;
  const ch = (key, opts) => (base ? changeOf(m[key], base[key], opts) : null);
  const baseLabel =
    against === "lastYear"
      ? `${fullDate(data.lastYearPeriod.from)} – ${fullDate(data.lastYearPeriod.to)}`
      : data.previousPeriod
        ? `${fullDate(data.previousPeriod.from)} – ${fullDate(data.previousPeriod.to)}`
        : "—";
  const rows = view === "monthly" ? data.monthly : data.yearly;
  const b = data.breakdowns;

  return (
    <div className={`space-y-8 transition-opacity ${loading ? "opacity-60" : ""}`}>
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle icon="shield">Financial Health</SectionTitle>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Compare with</span>
            <div className="inline-flex rounded-xl bg-bg p-1" role="group" aria-label="Compare with">
              {[
                ["previous", "Previous period"],
                ["lastYear", "Same period last year"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setAgainst(key)}
                  aria-pressed={against === key}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${against === key ? "bg-surface text-primary shadow-sm" : "text-muted hover:text-text"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="text-xs text-muted">
          Changes compare with {baseLabel}. Balances are as of {fullDate(data.asOf)}; expiry as of today. Cash balances are shop-wide.
        </p>

        <div className="stagger grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <KpiCard label="Total Sales" value={m.totalSales} change={ch("totalSales")} note={`incl. GST · ${count(m.bills)} bills`} accent={COLORS.revenue} />
          <KpiCard label="Total Revenue" value={m.revenue} change={ch("revenue")} note="excl. GST, after discounts" accent={COLORS.revenue} />
          <KpiCard label="Total Purchases" value={m.purchases} change={ch("purchases", { costLike: true })} accent="#64717D" />
          <KpiCard label="Operating Expenses" value={m.operatingExpenses} change={ch("operatingExpenses", { costLike: true })} accent={COLORS.costs} />
          <KpiCard label="Gross Profit" value={m.grossProfit} change={ch("grossProfit")} note={`${percent(m.grossMarginPct)} margin`} accent={COLORS.profit} />
          <KpiCard label={m.netProfit < 0 ? "Net Loss" : "Net Profit"} value={m.netProfit} change={ch("netProfit")} tone={m.netProfit < 0 ? "text-danger" : "text-success"} accent={COLORS.profit} />
          <KpiCard label="Profit Margin" display={percent(m.profitMarginPct)} change={ch("profitMarginPct", { points: true })} note="net" />
          <KpiCard label="GST Payable" value={m.gstPayable} change={ch("gstPayable", { costLike: true })} note={m.gstPayable < 0 ? "input credit exceeds output" : "output − input"} />
          <KpiCard label="Cash Balance" value={m.cashBalance} note={`Cash ${money2(m.cashInHand)} · UPI ${money2(m.upiBalance)}`} tone={m.cashBalance < 0 ? "text-danger" : "text-text"} />
          <KpiCard label="Accounts Receivable" value={m.receivables} note="owed by customers" tone={m.receivables > 0 ? "text-warning" : "text-text"} />
          <KpiCard label="Supplier Payables" value={m.payables} note="owed to suppliers" tone={m.payables > 0 ? "text-danger" : "text-text"} />
          <KpiCard label="Inventory Value" value={m.inventoryValue} note={`at cost · ${money2(m.inventoryValueAtSelling)} at selling`} />
          <KpiCard label="Net Cash Flow" value={m.netCashFlow} note={`in ${money2(m.cashInflow)} · out ${money2(m.cashOutflow)}`} tone={m.netCashFlow < 0 ? "text-danger" : "text-success"} />
          <KpiCard label="Working Capital" value={m.workingCapital} note="cash + receivables + stock − payables" tone={m.workingCapital < 0 ? "text-danger" : "text-text"} />
          <KpiCard
            label="Near-expiry (90 days)"
            display={`${count(m.nearExpiry.batches)} batches`}
            note={`${count(m.nearExpiry.products)} medicines · ${money2(m.nearExpiry.value)} at cost`}
            tone={m.nearExpiry.batches ? "text-warning" : "text-text"}
          />
          <KpiCard
            label="Expired Medicines"
            display={`${count(m.expired.batches)} batches`}
            note={`still on hand · ${money2(m.expired.value)} at cost`}
            tone={m.expired.batches ? "text-danger" : "text-text"}
          />
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle icon="chart">{view === "monthly" ? "Monthly Comparison" : "Yearly Comparison"}</SectionTitle>
          <div className="inline-flex rounded-xl bg-bg p-1" role="group" aria-label="Comparison view">
            {[
              ["monthly", "Monthly (12 months)"],
              ["yearly", "Yearly (financial year)"],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setView(key)}
                aria-pressed={view === key}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${view === key ? "bg-surface text-primary shadow-sm" : "text-muted hover:text-text"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <ComparisonChart
          rows={rows}
          title={view === "monthly" ? "Sales, Costs and Profit by Month" : "Sales, Costs and Profit by Financial Year"}
          subtitle={view === "monthly" ? `The 12 months up to ${fullDate(data.asOf)} · costs = cost of goods + expenses + write-offs` : "Indian financial years, April to March"}
        />
        <ChartCard title={view === "monthly" ? "Month-on-Month" : "Year-on-Year"} subtitle="Change columns compare each row with the one before it">
          <DataTable columns={trendColumns(view === "monthly" ? "Month" : "Financial year")} rows={rows} totals={trendTotals(rows)} rowKey={(r) => r.key} minWidth={900} />
        </ChartCard>
      </section>

      <section className="space-y-4">
        <SectionTitle icon="wallet">Balance Position &amp; Cash Flow</SectionTitle>
        <div className="grid gap-6 lg:grid-cols-3">
          <ChartCard title={`Balance as of ${fullDate(data.asOf)}`} subtitle="What the shop holds and owes">
            <Statement
              lines={[
                { label: "Cash in hand", amount: m.cashInHand },
                { label: "UPI balance", amount: m.upiBalance },
                { label: "Accounts receivable", amount: m.receivables },
                { label: "Inventory at cost", amount: m.inventoryValue },
                { label: "Less: supplier payables", amount: -m.payables },
              ]}
              total={{ label: "Working capital", amount: m.workingCapital }}
            />
          </ChartCard>
          <ChartCard title="Cash Flow" subtitle="Money moved during the period" action={<Link to="/day-book" className="text-xs font-semibold text-primary hover:underline">Day book</Link>}>
            <Statement lines={b.cashFlow.lines.map((l) => ({ label: l.label, amount: l.direction === "out" ? -l.amount : l.amount }))} total={{ label: "Net cash flow", amount: m.netCashFlow }} />
          </ChartCard>
          <ChartCard title="GST" subtitle="CGST/SGST split equally (intra-state)" action={<button onClick={() => goTab("finance")} className="text-xs font-semibold text-primary hover:underline">By rate</button>}>
            <Statement
              lines={[
                { label: "Output GST (on sales)", amount: m.outputGst },
                { label: "Less: input GST (on purchases)", amount: -m.inputGst },
              ]}
              total={{ label: "Net GST payable", amount: m.gstPayable }}
            />
          </ChartCard>
        </div>
      </section>

      <section className="space-y-4">
        <SectionTitle icon="hourglass">Expired &amp; Near-expiry Medicines</SectionTitle>
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard title={`Expired, still on hand (${data.expiry.expired.length})`} subtitle={`${money2(m.expired.value)} at cost · remove from sale`} action={<Link to="/stock?tab=expiry" className="text-xs font-semibold text-primary hover:underline">Expiry tracker</Link>}>
            {data.expiry.expired.length === 0 ? (
              <EmptyRow title="No expired stock on hand" />
            ) : (
              <DataTable columns={expiryColumns} rows={data.expiry.expired} totals={{ qtyRemaining: m.expired.qty, valueCost: m.expired.value }} rowKey={(r) => `${r.productId}-${r.batchNo}`} minWidth={560} />
            )}
          </ChartCard>
          <ChartCard title={`Expiring in the next 90 days (${data.expiry.nearExpiry.length})`} subtitle={`${money2(m.nearExpiry.value)} at cost · ${m.nearExpiry30.batches} batch${m.nearExpiry30.batches === 1 ? "" : "es"} within 30 days`}>
            {data.expiry.nearExpiry.length === 0 ? (
              <EmptyRow title="Nothing expires in the next 90 days" />
            ) : (
              <DataTable columns={expiryColumns} rows={data.expiry.nearExpiry} totals={{ qtyRemaining: m.nearExpiry.qty, valueCost: m.nearExpiry.value }} rowKey={(r) => `${r.productId}-${r.batchNo}`} minWidth={560} />
            )}
          </ChartCard>
        </div>
      </section>

      <section className="space-y-4">
        <SectionTitle icon="receipt">Breakdowns</SectionTitle>
        <div className="grid gap-6 lg:grid-cols-3">
          <RankBars title="Operating Expenses" subtitle="By category" rows={b.expenseCategories} labelKey="category" valueKey="amount" color={COLORS.costs} />
          <RankBars title="Sales by Payment Method" subtitle="Revenue excl. GST" rows={b.paymentModes} labelKey="mode" color={COLORS.revenue} />
          <RankBars title="Sales by Category" subtitle="Revenue excl. GST" rows={b.categories} labelKey="category" />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard title={`Top Receivables · ${money2(b.receivables.total)}`} subtitle="Customers who owe the shop, as of now">
            {b.receivables.rows.length === 0 ? (
              <p className="text-sm text-muted">No customer owes the shop money.</p>
            ) : (
              <DataTable minWidth={360} columns={[{ key: "name", label: "Customer" }, { key: "outstanding", label: "Outstanding", type: "money" }]} rows={b.receivables.rows.slice(0, 8)} rowKey={(r) => r.customerId} />
            )}
          </ChartCard>
          <ChartCard title={`Top Payables · ${money2(b.payables.total)}`} subtitle="Suppliers the shop owes, as of now">
            {b.payables.rows.length === 0 ? (
              <p className="text-sm text-muted">The shop owes no supplier money.</p>
            ) : (
              <DataTable minWidth={360} columns={[{ key: "name", label: "Supplier" }, { key: "outstanding", label: "Outstanding", type: "money" }]} rows={b.payables.rows.slice(0, 8)} rowKey={(r) => r.vendorId} />
            )}
          </ChartCard>
        </div>
      </section>
    </div>
  );
}
