import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import Layout from "../components/Layout";
import CustomerFormModal from "../components/CustomerFormModal";
import PartyTable from "../components/PartyTable";
import ReportDownloadButtons from "../components/ReportDownloadButtons";
import { useLiveRefresh } from "../context/LiveSync";
import { searchCustomers, deleteCustomer, exportCustomers } from "../api/customers";
import { getErrorMessage } from "../api/client";
import { compactParams } from "../utils/query";

const FILTERS = [
  ["all", "All customers"],
  ["due", "They owe you"],
  ["top", "Top 10 by sales"],
  ["new", "No bills yet"],
];

// Customer Management. Customers are added here, or by themselves from the
// bills (typed or Excel) that name them.
export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // a customer, or {} for a new one

  // A single space asks for the whole directory (Admin).
  const load = () =>
    searchCustomers(" ")
      .then(setCustomers)
      .catch((err) => toast.error(getErrorMessage(err, "Could not load customers.")))
      .finally(() => setLoading(false));
  useEffect(() => {
    load();
  }, []);
  useLiveRefresh(["customers", "sales"], load);

  const ranks = useMemo(() => {
    const top = [...customers].filter((c) => c.totalSales > 0).sort((a, b) => b.totalSales - a.totalSales).slice(0, 10);
    return new Map(top.map((c, i) => [c._id, i + 1]));
  }, [customers]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers.filter(
      (c) =>
        (!q || [c.name, c.phone, c.email, c.address].some((x) => String(x || "").toLowerCase().includes(q))) &&
        (filter === "all" || (filter === "due" ? c.outstandingBalance > 0 : filter === "top" ? ranks.has(c._id) : c.billCount === 0))
    );
  }, [customers, query, filter, ranks]);
  const sum = (k) => shown.reduce((s, c) => s + (c[k] || 0), 0);

  const remove = async (c) => {
    if (!window.confirm(`Delete ${c.name}?${c.billCount ? " Their past bills stay on record." : ""}`)) return;
    try {
      await deleteCustomer(c._id);
      toast.success(`${c.name} deleted.`);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const inputCls = "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none";

  return (
    <Layout>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">Customer Management</h1>
          <p className="mt-0.5 text-sm text-muted">New customers on your bills and Excel uploads are added here by themselves.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/reports/management?report=customer-performance" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-primary hover:bg-surface">
            Customer reports
          </Link>
          <ReportDownloadButtons onExport={(format) => exportCustomers(format, compactParams({ q: query.trim(), show: filter === "all" ? "" : filter }))} />
          <button onClick={() => setEditing({})} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
            + Add Customer
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input type="search" aria-label="Search customers" placeholder="Search name, phone, address" value={query} onChange={(e) => setQuery(e.target.value)} className={`${inputCls} w-full max-w-xs`} />
        <select aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value)} className={inputCls}>
          {FILTERS.map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
        <p className="ml-auto text-sm text-muted">
          {shown.length} customer{shown.length === 1 ? "" : "s"} · sales ₹{sum("totalSales").toFixed(2)} · <span className="font-semibold text-danger">they owe ₹{sum("outstandingBalance").toFixed(2)}</span>
        </p>
      </div>

      <PartyTable
        loading={loading}
        rows={shown}
        base="/customers"
        columns={[
          { key: "billCount", label: "Bills", type: "int" },
          { key: "totalSales", label: "Total sales", type: "money" },
          { key: "outstandingBalance", label: "Owes you", type: "due" },
          { key: "lastSale", label: "Last bill", type: "date" },
        ]}
        sub={(c) => [c.phone, c.address].filter(Boolean).join(" · ")}
        badge={(c) => ranks.has(c._id) && <span className="ml-2 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary">Top {ranks.get(c._id)}</span>}
        actions={(c) => [
          { label: "Receive / ledger", to: `/customers/${c._id}/ledger` },
          { label: "Edit", onClick: () => setEditing(c) },
          { label: "Delete", onClick: () => remove(c), danger: true },
        ]}
      />

      {editing && (
        <CustomerFormModal
          customer={editing._id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={(c) => {
            toast.success(`${c.name} saved.`);
            setEditing(null);
            load();
          }}
        />
      )}
    </Layout>
  );
}
