import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import Layout from "../components/Layout";
import RequiredMark from "../components/RequiredMark";
import ReportDownloadButtons from "../components/ReportDownloadButtons";
import { searchCustomers, getCustomer, createCustomer, deleteCustomer, exportCustomers } from "../api/customers";

const PHONE_RE = /^\d{10}$/;

export default function Customers() {
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

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

  const isValid = name.trim() && PHONE_RE.test(phone);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!isValid || saving) return;
    setSaving(true);
    setError("");
    try {
      const customer = await createCustomer({ name: name.trim(), phone, email: email.trim(), address: address.trim() });
      toast.success(`Customer ${customer.name} added.`);
      setName("");
      setPhone("");
      setEmail("");
      setAddress("");
      setShowForm(false);
      load(query || " ");
    } catch (err) {
      setError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const { customer } = detail;
    if (!window.confirm(`Delete ${customer.name} (${customer.phone})? Their past bills stay on record.`)) return;
    setDeleting(true);
    try {
      await deleteCustomer(customer._id);
      toast.success(`${customer.name} deleted.`);
      setDetail(null);
      load(query || " ");
    } catch (err) {
      toast.error(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setDeleting(false);
    }
  };

  const inputCls =
    "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none";

  return (
    <Layout>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">Customers</h1>
        <div className="flex flex-wrap items-center gap-2">
          <ReportDownloadButtons onExport={(format) => exportCustomers(format, query.trim() ? { q: query.trim() } : {})} />
          <button
          onClick={() => {
            setShowForm((s) => !s);
            setError("");
          }}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-95"
        >
          {showForm ? "Cancel" : "Add Customer"}
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mt-4 rounded-xl bg-surface p-4 shadow-sm">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-muted">
              Name<RequiredMark />
              <input type="text" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} mt-1 w-full`} />
            </label>
            <label className="text-xs text-muted">
              Phone<RequiredMark />
              <input
                type="tel"
                inputMode="numeric"
                maxLength={10}
                placeholder="10-digit number"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                className={`${inputCls} mt-1 w-full`}
              />
            </label>
            <label className="text-xs text-muted">
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputCls} mt-1 w-full`} />
            </label>
            <label className="text-xs text-muted">
              Address
              <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className={`${inputCls} mt-1 w-full`} />
            </label>
          </div>
          <div className="mt-3 flex items-center justify-end gap-3">
            {error && <p className="mr-auto text-sm text-danger">{error}</p>}
            <button
              type="submit"
              disabled={!isValid || saving}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-primary-dark"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}

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

            <div className="mt-4 flex justify-end border-t border-border pt-4">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete Customer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
