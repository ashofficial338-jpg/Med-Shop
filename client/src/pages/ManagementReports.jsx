import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Layout from "../components/Layout";
import Icon from "../components/Icon";
import ReportDownloadButtons from "../components/ReportDownloadButtons";
import ReportChart from "../components/reports/ReportChart";
import { KpiCard } from "../components/reports/ReportCharts";
import { DataTable } from "../components/reports/ReportTables";
import { DateFilter, lastDays } from "../components/dashboard/ReportFilters";
import { count, fullDate, money2, percent } from "../components/dashboard/format";
import { useAuth } from "../context/AuthContext";
import { useLiveRefresh } from "../context/LiveSync";
import { exportManagementReport, getManagementOptions, getManagementReport, managementReportPdf } from "../api/reports";
import DocumentViewer from "../components/DocumentViewer";
import { getErrorMessage } from "../api/client";
import { can, isAdmin } from "../utils/permissions";
import { compactParams } from "../utils/query";
import { todayLocal } from "../utils/date";

const GROUPS = [
  ["Sales", "Sales reports"],
  ["Purchase", "Purchase reports"],
  ["Inventory", "Purchase management & stock"],
  ["Business", "Business analysis"],
];
const FILTERS = ["customer", "vendor", "product"];
const show = (type, v) => (type === "money" ? money2(v) : type === "int" ? count(v) : type === "pct" ? percent(v) : (v ?? "—"));

// A row of a customer / vendor / bill / purchase report opens that record.
function linkFor(report, row) {
  if (!row.id || String(row.id).startsWith("name:") || ["walk-in", "none"].includes(row.id)) return null;
  if (["sales-customer", "customer-performance"].includes(report)) return `/customers/${row.id}`;
  if (["purchase-vendor", "vendor-performance"].includes(report)) return `/vendors/${row.id}`;
  if (report === "sales-pending") return `/bills/${row.id}`;
  if (report === "purchase-pending") return `/purchases/${row.id}/edit`;
  if (["sales-product", "purchase-product", "best-sellers", "current-stock", "stock-movement"].includes(report)) return `/products?product=${row.id}`;
  if (report === "po-register") return `/purchase-orders/${row.id}`;
  if (report === "pi-register") return `/purchases/${row.id}/edit`;
  if (report === "supplier-purchase") return `/vendors/${row.id}`;
  return null;
}

// Management Reports: pick a report, a period and (if wanted) one customer,
// vendor or product. Every figure is worked out from the bills and purchases
// when shown, and again whenever one of them changes.
export default function ManagementReports() {
  const { user } = useAuth();
  const admin = isAdmin(user);
  const [params, setParams] = useSearchParams();
  const fallback = lastDays(30);
  const state = {
    report: params.get("report") || "business-summary",
    from: params.get("from") || fallback.from,
    to: params.get("to") || fallback.to,
    ...Object.fromEntries(FILTERS.map((k) => [k, params.get(k) || ""])),
  };
  const update = (patch) => setParams(compactParams({ ...state, ...patch }), { replace: true });
  const query = JSON.stringify(compactParams(state));

  const [options, setOptions] = useState({ reports: [], customers: [], vendors: [], products: [] });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const seq = useRef(0);

  useEffect(() => {
    getManagementOptions().then(setOptions).catch(() => {});
  }, []);

  // `silent` keeps the figures on screen while they are worked out again.
  const load = (silent) => {
    const mine = ++seq.current;
    if (!silent) setLoading(true);
    getManagementReport(JSON.parse(query))
      .then((data) => {
        if (mine !== seq.current) return;
        setReport(data);
        setError("");
      })
      .catch((err) => mine === seq.current && !silent && setError(getErrorMessage(err, "Couldn't load the report. Please try again.")))
      .finally(() => mine === seq.current && setLoading(false));
  };
  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  useLiveRefresh(["sales", "purchases", "customers", "vendors", "expenses", "products"], () => {
    load(true);
    getManagementOptions().then(setOptions).catch(() => {});
  });

  const selectCls = "h-10 min-w-0 max-w-[14rem] rounded-xl border border-border bg-surface px-3 text-sm font-medium text-text focus:border-primary focus:outline-none";
  const isSales = state.report.startsWith("sales-") && state.report !== "sales-vs-purchase";
  const INVENTORY = ["po-register", "pi-register", "pr-register", "purchase-inward", "supplier-purchase", "current-stock", "stock-movement", "item-stock-ledger"];
  const isPurchase = state.report.startsWith("purchase-") || INVENTORY.includes(state.report);
  const [search, setSearch] = useState("");
  const [printing, setPrinting] = useState(false);
  const current = options.reports.find((r) => r.key === state.report);
  const shown = report && report.key === state.report ? report : null;

  const columns = (shown?.columns || []).map((c, i) => {
    const byRow = c.type === "by-row";
    return {
      key: c.key,
      label: c.label,
      type: byRow ? "money" : c.type,
      tone: c.type === "pct" && c.key.toLowerCase().includes("growth") ? (r) => (r[c.key] > 0 ? "text-success" : r[c.key] < 0 ? "text-danger" : "text-muted") : undefined,
      render:
        byRow
          ? (r) => show(r.type || "money", r[c.key])
          : i <= 1 && c.type === "text"
            ? (r) => {
                const to = admin && ["party", "product", "ref"].includes(c.key) ? linkFor(state.report, r) : null;
                return to ? <Link to={to} className="text-primary hover:underline">{r[c.key] || "—"}</Link> : r[c.key] || "—";
              }
            : undefined,
    };
  });

  // Search narrows the rows on screen (the totals are hidden while searching).
  const searched = (rows) => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => Object.values(r).some((v) => v !== null && typeof v !== "object" && String(v).toLowerCase().includes(q)));
  };

  return (
    <Layout
      toolbar={
        <>
          <button
            type="button"
            onClick={() => update({ from: "2020-01-01", to: todayLocal() })}
            className="hidden h-10 whitespace-nowrap rounded-xl border border-border bg-surface px-3 text-sm font-medium text-text hover:border-primary/30 md:block"
          >
            All time
          </button>
          <DateFilter range={{ from: state.from, to: state.to }} onChange={(r) => update(r)} />
        </>
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">Management Reports</h1>
          <p className="mt-0.5 text-sm text-muted">Always up to date with every bill and purchase.</p>
        </div>
        {can(user, "reports.export") && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setPrinting(true)} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-primary hover:bg-surface">Print</button>
            <ReportDownloadButtons onExport={(format) => exportManagementReport(JSON.parse(query), format, current?.title || "Report")} />
          </div>
        )}
      </div>

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
        {/* Phones: one dropdown. Larger screens: the full list. */}
        <select aria-label="Report" value={state.report} onChange={(e) => update({ report: e.target.value })} className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm font-semibold text-text lg:hidden">
          {GROUPS.map(([g, label]) => (
            <optgroup key={g} label={label}>
              {options.reports.filter((r) => r.group === g).map((r) => (
                <option key={r.key} value={r.key}>{r.title}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <nav aria-label="Reports" className="hidden rounded-2xl bg-surface p-3 shadow-sm lg:block">
          {GROUPS.map(([g, label]) => (
            <div key={g} className="mb-3 last:mb-0">
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
              {options.reports.filter((r) => r.group === g).map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => update({ report: r.key })}
                  aria-current={state.report === r.key ? "page" : undefined}
                  className={`block w-full rounded-lg px-2 py-1.5 text-left text-sm ${state.report === r.key ? "bg-primary-soft font-semibold text-primary" : "text-text hover:bg-bg"}`}
                >
                  {r.title.replace(/ Report$/, "")}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="min-w-0 space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Customer" value={state.customer} onChange={(e) => update({ customer: e.target.value })} disabled={isPurchase} className={`${selectCls} disabled:opacity-40`}>
              <option value="">All customers</option>
              <option value="walk-in">Walk-in</option>
              {options.customers.map((c) => (
                <option key={c._id} value={c._id}>{[c.name, c.phone].filter(Boolean).join(" · ")}</option>
              ))}
            </select>
            <select aria-label="Vendor" value={state.vendor} onChange={(e) => update({ vendor: e.target.value })} disabled={isSales} className={`${selectCls} disabled:opacity-40`}>
              <option value="">All vendors</option>
              <option value="none">No supplier</option>
              {options.vendors.map((v) => (
                <option key={v._id} value={v._id}>{v.name}</option>
              ))}
            </select>
            <select aria-label="Product" value={state.product} onChange={(e) => update({ product: e.target.value })} className={selectCls}>
              <option value="">All products</option>
              {options.products.map((p) => (
                <option key={p._id} value={p._id}>{p.name}</option>
              ))}
            </select>
            <input type="search" aria-label="Search rows" placeholder="Search in report…" value={search} onChange={(e) => setSearch(e.target.value)} className={`${selectCls} w-44`} />
            {FILTERS.some((k) => state[k]) && (
              <button type="button" onClick={() => update({ customer: "", vendor: "", product: "" })} className="h-10 rounded-xl px-3 text-sm font-semibold text-primary hover:bg-surface">
                Clear filters
              </button>
            )}
          </div>

          <div>
            <h2 className="font-display text-lg font-bold text-text">{current?.title || "Report"}</h2>
            <p className="text-xs text-muted">
              {fullDate(state.from)} – {fullDate(state.to)}
              {shown?.note ? ` · ${shown.note}` : ""}
            </p>
          </div>

          {error && (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger" role="alert">
              <span className="flex items-center gap-2"><Icon name="alert" size={17} />{error}</span>
              <button onClick={() => load(false)} className="rounded-lg px-3 py-1 font-semibold hover:bg-danger/10">Retry</button>
            </div>
          )}
          {!shown && !error && <div className="card skeleton h-72" aria-busy="true" aria-label="Loading report" />}

          {shown && (
            <div className={`space-y-5 transition-opacity ${loading ? "opacity-60" : ""}`}>
              {shown.summary && (
                <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                  {shown.summary.map((s) => (
                    <KpiCard key={s.label} label={s.label} {...(s.type === "money" ? { value: s.value } : { display: count(s.value) })} tone={s.value < 0 ? "text-danger" : "text-text"} />
                  ))}
                </div>
              )}
              {shown.chart && shown.rows.length > 0 && <ReportChart title={shown.chart.type === "rank" ? `Top ${shown.chart.series[0].label.toLowerCase()}` : shown.chart.series.map((s) => s.label).join(" and ")} chart={shown.chart} rows={shown.rows} />}
              <section className="card p-5">
                {shown.rows.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted">Nothing recorded for this period{FILTERS.some((k) => state[k]) ? " and filters" : ""}.</p>
                ) : (
                  <DataTable key={shown.key} columns={columns} rows={searched(shown.rows)} totals={search.trim() ? undefined : shown.totals} rowKey={(r, i) => r.id || r.key || i} minWidth={Math.max(420, columns.length * 105)} />
                )}
              </section>
            </div>
          )}
        </div>
      </div>
      {printing && (
        <DocumentViewer
          title={current?.title || "Report"}
          filename={`${(current?.title || "Report").replace(/[^\w]+/g, "_")}.pdf`}
          load={() => managementReportPdf(JSON.parse(query))}
          onClose={() => setPrinting(false)}
        />
      )}
    </Layout>
  );
}
