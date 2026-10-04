import { useCallback, useEffect, useRef, useState } from "react";
import Layout, { STORE_NAME } from "../components/Layout";
import Icon from "../components/Icon";
import ReportDownloadButtons from "../components/ReportDownloadButtons";
import { getDashboardSummary, downloadDashboardReport } from "../api/dashboard";
import { getDayBookSummary } from "../api/daybook";
import { SalesTrendChart, CategoryBars, CashFlowChart } from "../components/dashboard/DashboardCharts";
import {
  SectionTitle,
  StatTile,
  TopSelling,
  LowStockList,
  ExpiringList,
  ProfitLoss,
  ProductProfitability,
} from "../components/dashboard/DashboardWidgets";
import { fullDate } from "../components/dashboard/format";

function localIso(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function lastDays(days) {
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

function presetFor(range) {
  return PRESETS.find((p) => {
    const r = p.range();
    return r.from === range.from && r.to === range.to;
  });
}

function DateFilter({ range, onChange }) {
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

function Skeleton() {
  return (
    <div className="mt-6 space-y-6" aria-busy="true" aria-label="Loading dashboard">
      <div className="card skeleton h-72" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card space-y-3 p-5">
            <div className="skeleton h-3 w-24" />
            <div className="skeleton h-7 w-32" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [range, setRange] = useState(() => lastDays(30));
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [todayBalances, setTodayBalances] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    getDashboardSummary(range)
      .then(setSummary)
      .catch(() => setError("Couldn't load the dashboard. Check your connection and try again."))
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    getDayBookSummary()
      .then(setTodayBalances)
      .catch(() => {});
  }, []);

  const periodLabel = presetFor(range)?.label.toLowerCase() || "selected period";
  const cashFlowToday = todayBalances
    ? [
        { type: "Cash", in: todayBalances.cash.in, out: todayBalances.cash.out },
        { type: "UPI", in: todayBalances.upi.in, out: todayBalances.upi.out },
        { type: "Credit", in: todayBalances.credit.in, out: todayBalances.credit.out },
      ]
    : [];

  return (
    <Layout toolbar={<DateFilter range={range} onChange={setRange} />}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-primary">{STORE_NAME}</p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">Accounting Dashboard</h1>
          <p className="mt-1 text-sm text-muted">Profit, sales, cash and stock at a glance — {periodLabel}.</p>
        </div>
        <ReportDownloadButtons onExport={(format) => downloadDashboardReport(range, format)} />
      </div>

      {error && (
        <div className="mt-6 flex items-center justify-between gap-3 rounded-2xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
          <span className="flex items-center gap-2">
            <Icon name="alert" size={17} />
            {error}
          </span>
          <button onClick={load} className="rounded-lg px-3 py-1 font-semibold hover:bg-danger/10">
            Retry
          </button>
        </div>
      )}

      {loading && !summary && <Skeleton />}

      {summary && (
        <div className={`mt-6 space-y-8 transition-opacity ${loading ? "opacity-60" : ""}`}>
          <ProfitLoss summary={summary} range={range} />

          <ProductProfitability summary={summary} />

          <section className="space-y-4">
            <SectionTitle icon="receipt">Sales &amp; GST</SectionTitle>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile label="Sales Count" value={summary.salesCount} isCount icon="receipt" tone="violet" to="/bills" />
              <StatTile label="Output GST" value={summary.outputGst} icon="arrowRight" tone="blue" />
              <StatTile label="Input GST" value={summary.inputGst} icon="truck" tone="slate" />
              <StatTile label="Net GST Payable" value={summary.netGst} icon="rupee" tone="teal" />
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <SalesTrendChart data={summary.salesTrend} />
              <CategoryBars data={summary.revenueByCategory} />
            </div>
            <TopSelling items={summary.fastMovers} />
          </section>

          {todayBalances && (
            <section className="space-y-4">
              <SectionTitle icon="wallet">Cash Position</SectionTitle>
              <div className="grid gap-6 lg:grid-cols-3">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-1">
                  <StatTile label="Cash Today" value={todayBalances.cash.closing} icon="wallet" tone="success" to="/day-book" />
                  <StatTile label="UPI Today" value={todayBalances.upi.closing} icon="rupee" tone="blue" to="/day-book" />
                  <StatTile label="Credit Outstanding" value={todayBalances.credit.closing} icon="clock" tone="warning" to="/day-book" />
                </div>
                <CashFlowChart data={cashFlowToday} />
              </div>
            </section>
          )}

          <section className="space-y-4">
            <SectionTitle icon="boxes">Stock</SectionTitle>
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="self-start">
                <StatTile
                  label="Stock Value (at cost)"
                  value={summary.totalStockValue}
                  icon="boxes"
                  tone="teal"
                  note="Current stock on hand, valued at purchase cost"
                  to="/stock"
                />
              </div>
              <LowStockList items={summary.lowStock} />
              <ExpiringList items={summary.expiringSoon} />
            </div>
          </section>

          <section className="space-y-4">
            <SectionTitle icon="users">Receivables &amp; Payables</SectionTitle>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <StatTile
                label="Customer Receivables"
                value={todayBalances?.credit.closing ?? 0}
                icon="users"
                tone="danger"
                valueTone="danger"
                note="Owed to the shop by customers"
                to="/customers"
              />
              <StatTile
                label="Total Payables"
                value={summary.totalPayables}
                icon="building"
                tone="danger"
                valueTone="danger"
                note="Owed by the shop to suppliers"
                to="/vendors"
              />
            </div>
          </section>
        </div>
      )}
    </Layout>
  );
}
