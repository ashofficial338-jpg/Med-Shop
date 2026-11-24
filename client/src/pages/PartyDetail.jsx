import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import Layout from "../components/Layout";
import CustomerFormModal from "../components/CustomerFormModal";
import VendorFormModal from "../components/VendorFormModal";
import ReportDownloadButtons from "../components/ReportDownloadButtons";
import ReportChart from "../components/reports/ReportChart";
import { DataTable } from "../components/reports/ReportTables";
import { KpiCard } from "../components/reports/ReportCharts";
import { count, fullDate, money2 } from "../components/dashboard/format";
import { useLiveRefresh } from "../context/LiveSync";
import { deleteCustomer, getCustomerSummary } from "../api/customers";
import { deleteVendor, getVendorSummary } from "../api/vendors";
import { exportManagementReport } from "../api/reports";
import { getErrorMessage } from "../api/client";
import { todayLocal } from "../utils/date";

const SIDES = {
  customer: {
    list: "/customers",
    listName: "Customer Management",
    load: getCustomerSummary,
    remove: deleteCustomer,
    report: "sales-daily",
    entry: (id) => `/bills/${id}`,
    words: { total: "Total sales", count: "Bills", owes: "Owes you", history: "Sales history", products: "What they buy", ref: "Bill no", paid: "Received", none: "No bills yet." },
  },
  vendor: {
    list: "/vendors",
    listName: "Vendor Management",
    load: getVendorSummary,
    remove: deleteVendor,
    report: "purchase-daily",
    entry: (id) => `/purchases/${id}/edit`,
    words: { total: "Total purchases", count: "Purchases", owes: "You owe", history: "Purchase history", products: "What they supply", ref: "Invoice no", paid: "Paid", none: "No purchases yet." },
  },
};

// One customer or one vendor in full: totals, every transaction, the products,
// month by month. `side` is "customer" or "vendor".
export default function PartyDetail({ side }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const s = SIDES[side];
  const w = s.words;
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [editing, setEditing] = useState(false);

  const load = () =>
    s
      .load(id)
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((err) => setError(getErrorMessage(err, "Could not load this record.")));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, side]);
  useLiveRefresh(["customers", "vendors", "sales", "purchases"], load);

  if (!data) {
    return (
      <Layout>
        <p className={`text-sm ${error ? "text-danger" : "text-muted"}`}>{error || "Loading…"}</p>
      </Layout>
    );
  }

  const { party, totals, outstanding, months, products } = data;
  const inRange = (d) => (!from || d >= from) && (!to || d <= to);
  const entries = data.entries.filter((e) => inRange(new Date(e.date).toLocaleDateString("en-CA")));
  const sum = (k) => Number(entries.reduce((t, e) => t + e[k], 0).toFixed(2));

  const remove = async () => {
    if (!window.confirm(`Delete ${party.name}?${totals.count ? " Past records stay." : ""}`)) return;
    try {
      await s.remove(id);
      toast.success(`${party.name} deleted.`);
      navigate(s.list);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const btn = "rounded-lg border border-border px-4 py-2 text-sm font-semibold text-primary hover:bg-surface";
  const inputCls = "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text focus:border-primary focus:outline-none";
  const FormModal = side === "customer" ? CustomerFormModal : VendorFormModal;

  return (
    <Layout>
      <Link to={s.list} className="text-sm font-semibold text-primary hover:underline">← {s.listName}</Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">{party.name}</h1>
          <p className="text-sm text-muted">
            {[party.contactPerson, party.phone, party.email, party.gstNumber, party.address].filter(Boolean).join(" · ") || "No contact details yet"}
            {party.isActive === false && <span className="ml-2 font-semibold text-danger">Deleted</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ReportDownloadButtons onExport={(format) => exportManagementReport({ report: s.report, from: from || "2020-01-01", to: to || todayLocal(), [side]: id }, format, `${party.name}_${w.history}`)} />
          {side === "vendor" && <Link to={`/vendors/${id}/analysis`} className={btn}>Ratings</Link>}
          <Link to={`${s.list}/${id}/ledger`} className={btn}>{side === "customer" ? "Receive / ledger" : "Pay / ledger"}</Link>
          {side === "vendor" && party.isActive !== false && <Link to={`/purchases/new?vendor=${id}`} className={btn}>New purchase</Link>}
          <button type="button" onClick={() => setEditing(true)} className={btn}>Edit</button>
          <button type="button" onClick={remove} className="rounded-lg border border-danger/40 px-4 py-2 text-sm font-semibold text-danger hover:bg-danger/10">Delete</button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label={w.total} value={totals.total} />
        <KpiCard label={w.count} display={count(totals.count)} note={totals.last ? `Last on ${fullDate(totals.last)}` : ""} />
        <KpiCard label={side === "customer" ? "Average bill" : "Average purchase"} value={totals.average} />
        <KpiCard label={w.owes} value={outstanding} tone={outstanding > 0 ? "text-danger" : "text-text"} />
      </div>

      {months.length > 0 && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <ReportChart title={`${w.total} by month`} chart={{ type: "bar", x: "period", series: [{ key: "total", label: w.total }] }} rows={months} />
          <section className="card p-5">
            <h2 className="font-display text-base font-bold text-text">{w.products}</h2>
            <div className="mt-3 max-h-[300px] overflow-y-auto">
              <DataTable
                minWidth={420}
                rows={products}
                rowKey={(r) => r.id}
                columns={[
                  { key: "product", label: "Product" },
                  { key: "packs", label: "Qty (packs)", type: "qty" },
                  { key: "total", label: "Amount", type: "money" },
                  { key: "last", label: "Last", type: "date" },
                ]}
              />
            </div>
          </section>
        </div>
      )}

      <section className="card mt-6 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-display text-base font-bold text-text">{w.history}</h2>
          <input type="date" aria-label="From" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
          <input type="date" aria-label="To" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={inputCls} />
          {(from || to) && (
            <button type="button" onClick={() => { setFrom(""); setTo(""); }} className="text-sm font-semibold text-primary hover:underline">
              Clear
            </button>
          )}
        </div>
        <div className="mt-3">
          {entries.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">{data.entries.length ? "Nothing in these dates." : w.none}</p>
          ) : (
            <DataTable
              minWidth={760}
              rows={entries}
              rowKey={(r) => r.id}
              totals={{ total: sum("total"), paid: sum("paid"), balance: sum("balance") }}
              columns={[
                { key: "date", label: "Date", type: "date" },
                { key: "ref", label: w.ref, render: (r) => <Link to={s.entry(r.id)} className="font-mono text-xs font-semibold text-primary hover:underline">{r.ref}</Link> },
                { key: "items", label: "Products", sortable: false, render: (r) => <span title={r.items.map((i) => `${i.name} × ${i.packs}`).join(", ")}>{r.items.map((i) => i.name).join(", ")}</span> },
                { key: "mode", label: "Payment" },
                { key: "total", label: "Total", type: "money" },
                { key: "paid", label: w.paid, type: "money" },
                { key: "balance", label: "Pending", type: "money", tone: (r) => (r.balance > 0 ? "text-danger" : "text-text") },
              ]}
            />
          )}
        </div>
      </section>
      <p className="mt-3 text-xs text-muted">Balance now: {money2(outstanding)}. Figures follow every bill, purchase and payment as they are saved, edited or deleted.</p>

      {editing && (
        <FormModal
          {...{ [side]: party }}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            toast.success("Saved.");
            load();
          }}
        />
      )}
    </Layout>
  );
}
