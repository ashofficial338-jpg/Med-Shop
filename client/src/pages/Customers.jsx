import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Layout from "../components/Layout";
import { searchCustomers, getCustomer } from "../api/customers";

export default function Customers() {
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);

  const load = (q = "") => {
    setLoading(true);
    searchCustomers(q).then((data) => {
      setCustomers(data);
      setLoading(false);
    });
  };

  useEffect(() => {
    // Admin gets the full directory by searching with an empty-but-defined query;
    // the API only restricts the no-query case for Staff.
    load(" ");
  }, []);

  const handleSearch = (e) => {
    const q = e.target.value;
    setQuery(q);
    load(q || " ");
  };

  const openDetail = async (id) => {
    const data = await getCustomer(id);
    setDetail(data);
  };

  return (
    <Layout>
      <h1 className="font-display text-2xl font-semibold text-text">Customers</h1>

      <input
        type="text"
        placeholder="Search by name or phone"
        value={query}
        onChange={handleSearch}
        className="mt-4 w-full max-w-sm rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
      />

      <div className="mt-6 space-y-2">
        {loading && <p className="text-sm text-muted">Loading…</p>}
        {!loading && customers.length === 0 && <p className="text-sm text-muted">No records found.</p>}

        {customers.map((c) => (
          <button
            key={c._id}
            onClick={() => openDetail(c._id)}
            className="flex w-full items-center justify-between rounded-xl bg-surface p-4 text-left shadow-sm hover:bg-bg"
          >
            <div>
              <p className="font-medium text-text">{c.name}</p>
              <p className="text-sm text-muted">{c.phone}</p>
            </div>
            {c.outstandingBalance > 0 && (
              <span className="font-mono text-sm font-semibold text-danger">₹{c.outstandingBalance.toFixed(2)} due</span>
            )}
          </button>
        ))}
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8">
          <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-semibold text-text">{detail.customer.name}</h2>
              <button onClick={() => setDetail(null)} className="text-muted hover:text-text" aria-label="Close">✕</button>
            </div>
            <p className="text-sm text-muted">{detail.customer.phone}{detail.customer.email ? ` · ${detail.customer.email}` : ""}</p>
            {detail.customer.address && <p className="text-sm text-muted">{detail.customer.address}</p>}

            <div className="mt-3 flex items-center justify-between rounded-lg bg-bg p-3">
              <div>
                <p className="text-xs text-muted">Outstanding Balance</p>
                <p className={`font-mono text-lg font-semibold ${detail.outstandingBalance > 0 ? "text-danger" : "text-text"}`}>
                  ₹{detail.outstandingBalance.toFixed(2)}
                </p>
              </div>
              <Link
                to={`/customers/${detail.customer._id}/ledger`}
                className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-dark"
              >
                View Ledger
              </Link>
            </div>

            <h3 className="mt-4 text-sm font-semibold text-text">Purchase History</h3>
            <div className="mt-2 max-h-72 space-y-2 overflow-y-auto">
              {detail.bills.length === 0 && <p className="text-sm text-muted">No records found.</p>}
              {detail.bills.map((b) => (
                <div key={b._id} className="flex justify-between rounded-lg bg-bg p-2 text-sm">
                  <span className="text-text">
                    {b.billNo}
                    {b.paymentStatus === "void" && <span className="ml-2 text-xs text-danger">VOID</span>}
                  </span>
                  <span className="font-mono text-text">₹{b.total.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
