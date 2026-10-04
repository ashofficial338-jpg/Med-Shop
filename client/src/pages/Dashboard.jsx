import { useCallback, useEffect, useState } from "react";
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
  InventoryTurnover,
  Ebitda,
} from "../components/dashboard/DashboardWidgets";
import { DateFilter, FilterBar, presetFor, useReportFilters } from "../components/dashboard/ReportFilters";
import { withQuery } from "../utils/query";

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
  const [filters, setFilters] = useReportFilters();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [todayBalances, setTodayBalances] = useState(null);
  const { from, to, category, paymentMode } = filters;

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    getDashboardSummary({ from, to, category, paymentMode })
      .then(setSummary)
      .catch(() => setError("Couldn't load the dashboard. Check your connection and try again."))
      .finally(() => setLoading(false));
  }, [from, to, category, paymentMode]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    getDayBookSummary()
      .then(setTodayBalances)
      .catch(() => {});
  }, []);

  const range = { from, to };
  const periodLabel = presetFor(range)?.label.toLowerCase() || "selected period";
  const cashFlowToday = todayBalances
    ? [
        { type: "Cash", in: todayBalances.cash.in, out: todayBalances.cash.out },
        { type: "UPI", in: todayBalances.upi.in, out: todayBalances.upi.out },
        { type: "Credit", in: todayBalances.credit.in, out: todayBalances.credit.out },
      ]
    : [];

  // Where each metric leads. Every link carries the filters its page
  // understands, so the detail list shows the same records behind the number.
  const salesQuery = { from, to, category, paymentMode, status: "completed" };
  const links = {
    sales: withQuery("/bills", salesQuery),
    salesDay: (day) => withQuery("/bills", { ...salesQuery, from: day, to: day }),
    purchases: withQuery("/purchases", { from, to, category }),
    expenses: withQuery("/expenses", { from, to }),
    expenseCategory: (cat) => withQuery("/expenses", { from, to, category: cat }),
    profitability: withQuery("/reports/profitability", { from, to, category, paymentMode }),
    stockReport: withQuery("/stock", { tab: "report", category }),
    writeOffs: withQuery("/stock", { tab: "ledger", type: "stock-clearance" }),
    expiry: "/stock?tab=expiry",
    lowStock: withQuery("/products", { availability: "low", category }),
    product: (id) => withQuery("/products", { product: id }),
    category: (id) => withQuery("/products", { category: id }),
    dayBook: "/day-book",
  };

  return (
    <Layout toolbar={<DateFilter range={range} onChange={(r) => setFilters(r)} />}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-primary">{STORE_NAME}</p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">Accounting Dashboard</h1>
          <p className="mt-1 text-sm text-muted">
            Profit, sales, cash and stock at a glance — {periodLabel}. Click any figure to see the records behind it.
          </p>
        </div>
        <ReportDownloadButtons onExport={(format) => downloadDashboardReport(filters, format)} />
      </div>

      <div className="mt-5">
        <FilterBar
          filters={filters}
          onChange={setFilters}
          note="Category narrows sales, profit, purchase and stock figures; payment mode narrows sales and profit. Shop expenses are shared by the filtered sales' revenue. Downloads include these filters."
        />
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
          <ProfitLoss summary={summary} range={range} links={links} />

          <Ebitda summary={summary} range={range} links={links} />

          <ProductProfitability summary={summary} links={links} />

          <section className="space-y-4">
            <SectionTitle icon="receipt">Sales &amp; GST</SectionTitle>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile label="Sales Count" value={summary.salesCount} isCount icon="receipt" tone="violet" to={links.sales} />
              <StatTile label="Output GST" value={summary.outputGst} icon="arrowRight" tone="blue" note="GST collected on sales" to={links.sales} />
              <StatTile label="Input GST" value={summary.inputGst} icon="truck" tone="slate" note="GST paid on purchases" to={links.purchases} />
              <StatTile label="Net GST Payable" value={summary.netGst} icon="rupee" tone="teal" note="Output − input GST" to={links.sales} />
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <SalesTrendChart data={summary.salesTrend} linkForDay={links.salesDay} />
              <CategoryBars data={summary.revenueByCategory} linkFor={links.category} />
            </div>
            <TopSelling items={summary.fastMovers} links={links} />
          </section>

          {todayBalances && (
            <section className="space-y-4">
              <SectionTitle icon="wallet">Cash Position</SectionTitle>
              <div className="grid gap-6 lg:grid-cols-3">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-1">
                  <StatTile label="Cash Today" value={todayBalances.cash.closing} icon="wallet" tone="success" to={links.dayBook} />
                  <StatTile label="UPI Today" value={todayBalances.upi.closing} icon="rupee" tone="blue" to={links.dayBook} />
                  <StatTile label="Credit Outstanding" value={todayBalances.credit.closing} icon="clock" tone="warning" to={links.dayBook} />
                </div>
                <CashFlowChart data={cashFlowToday} to={links.dayBook} />
              </div>
            </section>
          )}

          <section className="space-y-4">
            <SectionTitle icon="boxes">Stock</SectionTitle>
            <InventoryTurnover summary={summary} range={range} links={links} />
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="self-start">
                <StatTile
                  label="Stock Value (at cost)"
                  value={summary.totalStockValue}
                  icon="boxes"
                  tone="teal"
                  note="Current stock on hand, valued at purchase cost"
                  to={links.stockReport}
                />
              </div>
              <LowStockList items={summary.lowStock} links={links} />
              <ExpiringList items={summary.expiringSoon} links={links} />
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
