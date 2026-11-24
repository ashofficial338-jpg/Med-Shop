import { Link } from "react-router-dom";
import Icon from "../Icon";
import { StatTile } from "./DashboardWidgets";
import { todayLocal } from "../../utils/date";
import { withQuery } from "../../utils/query";

function EntryButton({ to, icon, title, text, className }) {
  return (
    <Link to={to} className={`group flex items-center gap-4 rounded-2xl p-5 text-white shadow-sm transition hover:-translate-y-0.5 hover:brightness-105 ${className}`}>
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/20">
        <Icon name={icon} size={24} />
      </span>
      <span className="min-w-0">
        <span className="block font-display text-lg font-bold">{title}</span>
        <span className="block text-sm text-white/85">{text}</span>
      </span>
      <Icon name="arrowRight" size={20} className="ml-auto shrink-0 transition-transform group-hover:translate-x-1" />
    </Link>
  );
}

// The top of the dashboard: the two entries that run the shop, and where
// things stand right now. Each figure comes straight from the bills, purchases
// and payments (and shows only if this user may see it).
export default function TodaySummary({ summary, shows, interactive }) {
  const today = todayLocal();
  const { salesOverview: sales, purchasesOverview: purchases, cashToday: cash } = summary;
  const link = (to) => (interactive ? to : undefined);
  const bills = (n) => `${n} bill${n === 1 ? "" : "s"}`;
  return (
    <section className="space-y-4" aria-label="Today">
      <div className={`grid gap-4 ${interactive ? "sm:grid-cols-2" : ""}`}>
        <EntryButton to="/billing" icon="receipt" title="New Bill" text="Sell goods – stock and sales update by themselves" className="bg-gradient-to-r from-[#12A06A] to-[#0E9C8A]" />
        {interactive && (
          <EntryButton to="/purchases/new" icon="truck" title="New Purchase" text="Buy goods – stock and supplier balance update by themselves" className="bg-gradient-to-r from-[#0E86B5] to-primary" />
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shows("dashboard.sales") && sales && (
          <StatTile label="Sales today" value={sales.today.total} icon="receipt" tone="success" note={bills(sales.today.count)} to={link(withQuery("/bills", { from: today, to: today, status: "completed" }))} />
        )}
        {shows("dashboard.profit") && purchases && (
          <StatTile
            label="Purchases today"
            value={purchases.today.total}
            icon="truck"
            tone="blue"
            note={`This month ₹${purchases.month.total.toLocaleString("en-IN", { maximumFractionDigits: 0 })} in ${purchases.month.count}`}
            to={link(withQuery("/purchases", { from: today, to: today }))}
          />
        )}
        {shows("dashboard.cash") && cash && <StatTile label="Cash in hand" value={cash.cash.closing} icon="wallet" tone="teal" note={`UPI ₹${cash.upi.closing.toFixed(2)}`} to={link("/day-book")} />}
        {shows("dashboard.receivables") && <StatTile label="Customers owe you" value={summary.receivables} icon="users" tone="warning" to={link("/customers")} />}
        {shows("dashboard.receivables") && <StatTile label="You owe suppliers" value={summary.totalPayables} icon="building" tone="danger" to={link("/vendors")} />}
        {shows("dashboard.stock") && <StatTile label="Stock value" value={summary.totalStockValue} icon="boxes" tone="slate" note="At purchase cost" to={link("/stock?tab=report")} />}
      </div>
    </section>
  );
}
