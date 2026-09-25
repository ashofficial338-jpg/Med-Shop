import { useCallback, useEffect, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { Link } from "react-router-dom";
import Layout from "../components/Layout";
import ExportButtons from "../components/ExportButtons";
import { getDashboardSummary, downloadDashboardReport } from "../api/dashboard";
import { getDayBookSummary } from "../api/daybook";

// Categorical slots 1-3 of the validated default dataviz palette (blue/orange/aqua) -
// this trio clears CVD separation in both light and dark under the strictest
// (all-pairs) check, so it's safe for a 3-line chart where any two lines can sit
// next to each other. Orange/aqua also sit close to this app's existing accent/success hues.
const COLOR_REVENUE = "#2a78d6";
const COLOR_EXPENSE = "#eb6834";
const COLOR_PROFIT = "#1baf7a";
const COLOR_PRIMARY = "#0F6B66"; // app brand teal - sequential hue for single-series magnitude bars

const AXIS_TEXT = { fontSize: 12, fill: "#5B7A77" };

function currency(n) {
  return `₹${Number(n || 0).toFixed(2)}`;
}

function StatTile({ label, value, tone = "text" }) {
  const toneCls = { text: "text-text", success: "text-success", danger: "text-danger" }[tone];
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-sm">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={`mt-1 font-mono text-xl font-semibold ${toneCls}`}>{currency(value)}</p>
    </div>
  );
}

function ChartCard({ title, children, height = 260 }) {
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-text">{title}</h2>
      <div style={{ height }} className="mt-3">
        {children}
      </div>
    </div>
  );
}

function SectionTitle({ children }) {
  return <h2 className="mt-8 border-t border-border pt-6 font-display text-lg font-semibold text-text">{children}</h2>;
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-md">
      {label && <p className="font-semibold text-text">{label}</p>}
      {payload.map((p) => (
        <p key={p.dataKey || p.name} style={{ color: p.color }} className="font-medium">
          {p.name}: {currency(p.value)}
        </p>
      ))}
    </div>
  );
}

function DATE_PRESET(days) {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}

const PRESETS = [
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
];

export default function Dashboard() {
  const [range, setRange] = useState(DATE_PRESET(30));
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [todayBalances, setTodayBalances] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    getDashboardSummary(range).then((data) => {
      setSummary(data);
      setLoading(false);
    });
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    getDayBookSummary().then(setTodayBalances);
  }, []);

  const inputCls =
    "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none";

  const revenueByCategory = [...(summary?.revenueByCategory || [])].sort((a, b) => b.total - a.total);
  const fastMovers = summary?.fastMovers || [];
  const cashFlowToday = todayBalances
    ? [
        { type: "Cash", in: todayBalances.cash.in, out: todayBalances.cash.out },
        { type: "UPI", in: todayBalances.upi.in, out: todayBalances.upi.out },
        { type: "Credit", in: todayBalances.credit.in, out: todayBalances.credit.out },
      ]
    : [];

  return (
    <Layout>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-text">Accounting Dashboard</h1>
        <ExportButtons onExport={(format) => downloadDashboardReport(range, format)} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => {
          const preset = DATE_PRESET(p.days);
          const active = range.from === preset.from && range.to === preset.to;
          return (
            <button
              key={p.label}
              onClick={() => setRange(preset)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                active ? "bg-primary text-white" : "border border-border text-text hover:bg-surface"
              }`}
            >
              Last {p.label}
            </button>
          );
        })}
        <input
          type="date"
          value={range.from}
          onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
          className={inputCls}
        />
        <span className="text-sm text-muted">to</span>
        <input
          type="date"
          value={range.to}
          onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
          className={inputCls}
        />
      </div>

      {loading && <p className="mt-6 text-sm text-muted">Loading…</p>}

      {!loading && summary && (
        <>
          <SectionTitle>Sales & Profit</SectionTitle>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
            <StatTile label="Revenue" value={summary.revenue} />
            <StatTile label="Profit" value={summary.profit} tone={summary.profit >= 0 ? "success" : "danger"} />
            <StatTile label="Cost of Goods Sold" value={summary.cogs} />
            <StatTile label="Expenses" value={summary.expenses} />
            <StatTile label="Total Purchases" value={summary.totalPurchases} />
            <StatTile label="Net GST Payable" value={summary.netGst} />
            <StatTile label="Expired Write-off" value={summary.expiredWriteOff} tone={summary.expiredWriteOff > 0 ? "danger" : "text"} />
            <div className="rounded-2xl bg-surface p-4 shadow-sm">
              <p className="text-xs font-medium text-muted">Sales Count</p>
              <p className="mt-1 font-mono text-xl font-semibold text-text">{summary.salesCount}</p>
            </div>
            <StatTile label="Output GST" value={summary.outputGst} />
            <StatTile label="Input GST" value={summary.inputGst} />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <ChartCard title="Sales Trend (Revenue · Expense · Profit)">
              {summary.salesTrend.length === 0 ? (
                <p className="text-sm text-muted">No records found.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={summary.salesTrend} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid stroke="#e1e0d9" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={AXIS_TEXT}
                      tickFormatter={(d) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                      axisLine={{ stroke: "#c3c2b7" }}
                      tickLine={false}
                    />
                    <YAxis tick={AXIS_TEXT} axisLine={false} tickLine={false} width={44} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="revenue" name="Revenue" stroke={COLOR_REVENUE} strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="expense" name="Expense" stroke={COLOR_EXPENSE} strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="profit" name="Profit" stroke={COLOR_PROFIT} strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Revenue by Category">
              {revenueByCategory.length === 0 ? (
                <p className="text-sm text-muted">No records found.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={revenueByCategory}
                    layout="vertical"
                    margin={{ top: 4, right: 24, left: 8, bottom: 0 }}
                  >
                    <CartesianGrid stroke="#e1e0d9" horizontal={false} />
                    <XAxis type="number" tick={AXIS_TEXT} axisLine={false} tickLine={false} />
                    <YAxis dataKey="category" type="category" tick={AXIS_TEXT} axisLine={false} tickLine={false} width={90} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="total" name="Revenue" fill={COLOR_PRIMARY} radius={[0, 4, 4, 0]} maxBarSize={22} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          <div className="mt-4">
            <ChartCard title="Top 5 Products by Revenue" height={fastMovers.length ? fastMovers.length * 44 + 20 : 60}>
              {fastMovers.length === 0 ? (
                <p className="text-sm text-muted">No records found.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={fastMovers} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
                    <CartesianGrid stroke="#e1e0d9" horizontal={false} />
                    <XAxis type="number" tick={AXIS_TEXT} axisLine={false} tickLine={false} />
                    <YAxis dataKey="name" type="category" tick={AXIS_TEXT} axisLine={false} tickLine={false} width={110} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="totalRevenue" name="Revenue" fill={COLOR_PRIMARY} radius={[0, 4, 4, 0]} maxBarSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          <SectionTitle>Cash Position</SectionTitle>
          {todayBalances && (
            <>
              <div className="mt-3 grid grid-cols-3 gap-3">
                {[
                  { label: "Cash Today", data: todayBalances.cash },
                  { label: "UPI Today", data: todayBalances.upi },
                  { label: "Credit Outstanding", data: todayBalances.credit },
                ].map((t) => (
                  <Link key={t.label} to="/day-book" className="rounded-2xl bg-surface p-4 shadow-sm hover:bg-bg">
                    <p className="text-xs font-medium text-muted">{t.label}</p>
                    <p className="mt-1 font-mono text-lg font-semibold text-text">{currency(t.data.closing)}</p>
                  </Link>
                ))}
              </div>

              <div className="mt-4">
                <ChartCard title="Today's Cash Flow (In vs Out)" height={200}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={cashFlowToday} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                      <CartesianGrid stroke="#e1e0d9" vertical={false} />
                      <XAxis dataKey="type" tick={AXIS_TEXT} axisLine={{ stroke: "#c3c2b7" }} tickLine={false} />
                      <YAxis tick={AXIS_TEXT} axisLine={false} tickLine={false} width={44} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="in" name="In" fill={COLOR_PROFIT} radius={[4, 4, 0, 0]} maxBarSize={40} />
                      <Bar dataKey="out" name="Out" fill={COLOR_EXPENSE} radius={[4, 4, 0, 0]} maxBarSize={40} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>
            </>
          )}

          <SectionTitle>Stock</SectionTitle>
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            <StatTile label="Stock Value (at cost)" value={summary.totalStockValue} />

            <div className="rounded-2xl bg-surface p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-text">Needs Attention</h2>

              <div className="mt-3">
                <p className="text-xs font-semibold text-muted">
                  Low Stock <span className="ml-1 rounded-full bg-warning/15 px-2 py-0.5 text-warning">{summary.lowStock.length}</span>
                </p>
                <div className="mt-1.5 space-y-1">
                  {summary.lowStock.length === 0 && <p className="text-xs text-muted">Nothing low on stock.</p>}
                  {summary.lowStock.map((p) => (
                    <div key={p._id} className="flex justify-between rounded-lg bg-bg px-2.5 py-1.5 text-xs">
                      <span className="text-text">{p.name} <span className="font-mono text-muted">({p.productCode})</span></span>
                      <span className="font-semibold text-warning">{p.qty} left</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4">
                <p className="text-xs font-semibold text-muted">
                  Expiring Soon <span className="ml-1 rounded-full bg-danger/15 px-2 py-0.5 text-danger">{summary.expiringSoon.length}</span>
                </p>
                <div className="mt-1.5 space-y-1">
                  {summary.expiringSoon.length === 0 && <p className="text-xs text-muted">Nothing expiring in the next 30 days.</p>}
                  {summary.expiringSoon.map((b) => (
                    <div key={b._id} className="flex justify-between rounded-lg bg-bg px-2.5 py-1.5 text-xs">
                      <span className="text-text">
                        {b.product?.name} <span className="font-mono text-muted">({b.product?.productCode})</span>
                        <span className="text-muted"> · Batch {b.batchNo}</span>
                      </span>
                      <span className="font-semibold text-danger">
                        {new Date(b.expiryDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <SectionTitle>Receivables & Payables</SectionTitle>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile label="Customer Receivables" value={todayBalances?.credit.closing ?? 0} tone="danger" />
            <StatTile label="Total Payables" value={summary.totalPayables} tone="danger" />
          </div>
        </>
      )}
    </Layout>
  );
}
