import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import Layout from "../components/Layout";
import ReportDownloadButtons from "../components/ReportDownloadButtons";
import VendorFormModal from "../components/VendorFormModal";
import PartyTable from "../components/PartyTable";
import { useLiveRefresh } from "../context/LiveSync";
import { listVendors, exportVendors, deleteVendor } from "../api/vendors";
import { getErrorMessage } from "../api/client";
import { compactParams } from "../utils/query";

const FILTERS = [
  ["all", "All suppliers"],
  ["due", "You owe them"],
  ["clear", "Nothing owed"],
  ["new", "No purchases yet"],
];

// Vendor Management. Suppliers are added here, or by themselves from the
// purchases (typed or Excel) that name them.
export default function Vendors() {
  const [vendors, setVendors] = useState([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // a vendor, or {} for a new one

  const load = () =>
    listVendors()
      .then(setVendors)
      .catch((err) => toast.error(getErrorMessage(err, "Could not load suppliers.")))
      .finally(() => setLoading(false));
  useEffect(() => {
    load();
  }, []);
  useLiveRefresh(["vendors", "purchases"], load);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vendors.filter(
      (v) =>
        (!q || [v.name, v.phone, v.contactPerson, v.gstNumber, v.email].some((x) => String(x || "").toLowerCase().includes(q))) &&
        (filter === "all" || (filter === "due" ? v.outstandingPayable > 0 : filter === "clear" ? !(v.outstandingPayable > 0) : v.purchaseCount === 0))
    );
  }, [vendors, query, filter]);
  const sum = (k) => shown.reduce((s, v) => s + (v[k] || 0), 0);

  const remove = async (v) => {
    if (!window.confirm(`Delete ${v.name}?${v.purchaseCount ? " Their past purchases stay on record." : ""}`)) return;
    try {
      toast.success((await deleteVendor(v._id)).message);
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
          <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">Vendor Management</h1>
          <p className="mt-0.5 text-sm text-muted">New suppliers on your purchases and Excel uploads are added here by themselves.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/reports/management?report=vendor-performance" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-primary hover:bg-surface">
            Vendor reports
          </Link>
          <ReportDownloadButtons onExport={(format) => exportVendors(format, compactParams({ q: query.trim(), show: filter === "all" ? "" : filter }))} />
          <button onClick={() => setEditing({})} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
            + Add Vendor
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input type="search" aria-label="Search suppliers" placeholder="Search name, phone, GSTIN" value={query} onChange={(e) => setQuery(e.target.value)} className={`${inputCls} w-full max-w-xs`} />
        <select aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value)} className={inputCls}>
          {FILTERS.map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
        <p className="ml-auto text-sm text-muted">
          {shown.length} supplier{shown.length === 1 ? "" : "s"} · purchases ₹{sum("totalPurchases").toFixed(2)} · <span className="font-semibold text-danger">you owe ₹{sum("outstandingPayable").toFixed(2)}</span>
        </p>
      </div>

      <PartyTable
        loading={loading}
        rows={shown}
        base="/vendors"
        columns={[
          { key: "purchaseCount", label: "Purchases", type: "int" },
          { key: "totalPurchases", label: "Total purchases", type: "money" },
          { key: "outstandingPayable", label: "You owe", type: "due" },
          { key: "lastPurchase", label: "Last purchase", type: "date" },
        ]}
        sub={(v) => [v.contactPerson, v.phone, v.gstNumber].filter(Boolean).join(" · ")}
        actions={(v) => [
          { label: "New purchase", to: `/purchases/new?vendor=${v._id}` },
          { label: "Pay / ledger", to: `/vendors/${v._id}/ledger` },
          { label: "Edit", onClick: () => setEditing(v) },
          { label: "Delete", onClick: () => remove(v), danger: true },
        ]}
      />

      {editing && (
        <VendorFormModal
          vendor={editing._id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={(v) => {
            toast.success(`${v.name} saved.`);
            setEditing(null);
            load();
          }}
        />
      )}
    </Layout>
  );
}
