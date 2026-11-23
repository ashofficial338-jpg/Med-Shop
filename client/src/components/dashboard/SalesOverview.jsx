import { Link } from "react-router-dom";
import { StatTile } from "./DashboardWidgets";

// Dashboard "Sales overview": today / this month / this year, and for the
// dashboard's period: sales by payment mode, top customers, top products and
// GST. Includes POS bills and Sales Entries (server utils/salesOverview.js).

const fmt = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function List({ title, rows, empty, render }) {
  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-text">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm">{rows.map(render)}</ul>
      )}
    </div>
  );
}

export default function SalesOverview({ data, links }) {
  if (!data) return null;
  const maxMode = Math.max(1, ...data.byPaymentMode.map((m) => m.total));
  return (
    <div className="space-y-4">
      <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Sales Today" value={data.today.total} icon="receipt" tone="success" note={`${data.today.count} bill${data.today.count === 1 ? "" : "s"} · GST ${fmt(data.today.gst)}`} to={links?.sales} />
        <StatTile label="Sales This Month" value={data.month.total} icon="calendar" tone="blue" note={`${data.month.count} bills · GST ${fmt(data.month.gst)}`} to={links?.sales} />
        <StatTile label="Sales This Year" value={data.year.total} icon="chart" tone="violet" note={`${data.year.count} bills · GST ${fmt(data.year.gst)}`} to={links?.sales} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <List
          title="Sales by payment mode (this period)"
          rows={data.byPaymentMode}
          empty="No sales in this period."
          render={(m) => (
            <li key={m.mode}>
              <div className="flex justify-between">
                <span className="text-text">{m.mode}</span>
                <span className="font-mono tabular-nums text-text">{fmt(m.total)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-bg">
                <div className="h-1.5 rounded-full bg-primary" style={{ width: `${(m.total / maxMode) * 100}%` }} />
              </div>
            </li>
          )}
        />
        <List
          title="Top customers (this period)"
          rows={data.topCustomers}
          empty="No sales in this period."
          render={(c) => (
            <li key={c.customerId || "walkin"} className="flex justify-between gap-2">
              {c.customerId ? (
                <Link to={`/customers/${c.customerId}/ledger`} className="truncate text-primary hover:underline">
                  {c.name}
                </Link>
              ) : (
                <span className="truncate text-text">{c.name}</span>
              )}
              <span className="whitespace-nowrap font-mono tabular-nums text-text">
                {fmt(c.total)} <span className="text-xs text-muted">({c.count})</span>
              </span>
            </li>
          )}
        />
        <List
          title="Top products (this period)"
          rows={data.topProducts}
          empty="No sales in this period."
          render={(p) => (
            <li key={p.productId} className="flex justify-between gap-2">
              <span className="truncate text-text">{p.name}</span>
              <span className="whitespace-nowrap font-mono tabular-nums text-text">
                {fmt(p.total)} <span className="text-xs text-muted">× {p.qty}</span>
              </span>
            </li>
          )}
        />
      </div>
      <p className="text-xs text-muted">
        This period: taxable {fmt(data.gst.taxable)} + GST {fmt(data.gst.gst)} = {fmt(data.gst.total)} (POS bills and Sales Entries).
      </p>
    </div>
  );
}
