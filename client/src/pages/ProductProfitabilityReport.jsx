import { useEffect, useState } from "react";
import Layout from "../components/Layout";
import Icon from "../components/Icon";
import ReportDownloadButtons from "../components/ReportDownloadButtons";
import { getDashboardSummary, downloadProfitabilityReport } from "../api/dashboard";
import { ChartCard } from "../components/dashboard/DashboardCharts";
import { StatTile, EmptyRow, ProfitabilityTable, ViewAll } from "../components/dashboard/DashboardWidgets";
import { DateFilter, FilterBar, presetFor, useReportFilters } from "../components/dashboard/ReportFilters";
import { fullDate, percent } from "../components/dashboard/format";
import { withQuery } from "../utils/query";

// Full Product Profitability & ROI table - where the dashboard's profit/ROI
// figures lead. Same filters (in the URL) and the same server figures as the
// dashboard, plus search and sortable columns.
export default function ProductProfitabilityReport() {
  const [filters, setFilters] = useReportFilters();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({ key: "netProfit", dir: "desc" });
  const { from, to, category, paymentMode } = filters;

  useEffect(() => {
    setLoading(true);
    setError("");
    getDashboardSummary({ from, to, category, paymentMode })
      .then(setSummary)
      .catch(() => setError("Couldn't load the report. Check your connection and try again."))
      .finally(() => setLoading(false));
  }, [from, to, category, paymentMode]);

  const onSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" }));

  const rows = (summary?.productProfitability || [])
    .filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => {
      const av = a[sort.key] ?? -Infinity;
      const bv = b[sort.key] ?? -Infinity;
      const cmp = typeof av === "string" ? av.localeCompare(bv) : av - bv;
      return sort.dir === "asc" ? cmp : -cmp;
    });

  const range = { from, to };
  const periodLabel = presetFor(range)?.label || `${fullDate(from)} – ${fullDate(to)}`;
  const salesLink = withQuery("/bills", { from, to, category, paymentMode, status: "completed" });
  const productLink = (id) => withQuery("/products", { product: id });
  const netTone = summary?.profit > 0 ? "success" : summary?.profit < 0 ? "danger" : "text";
  const roiTone = summary?.roiPct > 0 ? "success" : summary?.roiPct < 0 ? "danger" : "text";

  return (
    <Layout toolbar={<DateFilter range={range} onChange={(r) => setFilters(r)} />}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <ViewAll to={withQuery("/dashboard", filters)} label="Back to dashboard" />
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">Product Profitability &amp; ROI</h1>
          <p className="mt-1 text-sm text-muted">
            {periodLabel} · ROI = Net Profit ÷ Product Investment × 100
          </p>
        </div>
        <ReportDownloadButtons onExport={(format) => downloadProfitabilityReport(filters, format)} />
      </div>

      <div className="mt-5">
        <FilterBar
          filters={filters}
          onChange={setFilters}
          note="Shop expenses are shared by revenue across all sales, so each product's allocated expenses are the same with or without filters. Downloads include these filters."
        />
      </div>

      {error && (
        <div className="mt-6 flex items-center gap-2 rounded-2xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
          <Icon name="alert" size={17} />
          {error}
        </div>
      )}

      {loading && !summary && <div className="card skeleton mt-6 h-72" aria-busy="true" />}

      {summary && (
        <div className={`mt-6 space-y-6 transition-opacity ${loading ? "opacity-60" : ""}`}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatTile label="Product Investment" value={summary.investment} icon="boxes" tone="blue" note="Cost of goods sold" />
            <StatTile label="Sales Revenue" value={summary.revenue} icon="rupee" tone="teal" note="Excl. GST, after discounts" to={salesLink} />
            <StatTile label="Gross Profit" value={summary.grossProfit} icon="trendUp" tone="success" note="Revenue − COGS" />
            <StatTile
              label="Allocated Expenses"
              value={summary.allocatedExpenses}
              icon="wallet"
              tone="warning"
              note="Expenses + expired write-off"
              to={withQuery("/expenses", { from, to })}
            />
            <StatTile label="Net Profit" value={summary.profit} icon="trendUp" tone="success" valueTone={netTone} note="Gross profit − expenses" />
            <StatTile label="ROI (%)" display={percent(summary.roiPct)} icon="chart" tone="violet" valueTone={roiTone} note="Net profit ÷ investment × 100" />
          </div>

          <ChartCard
            title="Profitability by Product"
            subtitle={`${rows.length} product${rows.length === 1 ? "" : "s"} · click a column to sort, a product to open it`}
            action={
              <input
                type="search"
                placeholder="Search products"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search products"
                className="w-40 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text focus:border-primary focus:outline-none sm:w-56"
              />
            }
          >
            {rows.length === 0 ? (
              <EmptyRow
                icon="pill"
                title="No records found"
                text={search ? "No product matches that search." : "Product profit and ROI will show here once sales come in."}
              />
            ) : (
              <ProfitabilityTable rows={rows} linkForProduct={productLink} sort={sort} onSort={onSort} />
            )}
          </ChartCard>
        </div>
      )}
    </Layout>
  );
}
