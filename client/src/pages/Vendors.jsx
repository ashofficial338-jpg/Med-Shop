import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import Layout from "../components/Layout";
import VendorFormModal from "../components/VendorFormModal";
import PurchaseFormModal from "../components/PurchaseFormModal";
import { listVendors, setVendorActive } from "../api/vendors";
import { listProducts } from "../api/products";

function VendorProducts({ vendorId }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    setLoading(true);
    listProducts({ vendor: vendorId, q: q || undefined }).then((data) => {
      setProducts(data);
      setLoading(false);
    });
  }, [vendorId, q]);

  return (
    <div className="mt-3 rounded-xl bg-bg p-3">
      <input
        type="text"
        placeholder="Search this vendor's products…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full max-w-xs rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text focus:border-primary focus:outline-none"
      />
      <div className="mt-2 space-y-1">
        {loading && <p className="text-xs text-muted">Loading…</p>}
        {!loading && products.length === 0 && <p className="text-xs text-muted">No products found.</p>}
        {!loading &&
          products.map((p) => (
            <div key={p._id} className="flex items-center justify-between rounded-lg bg-surface px-2.5 py-1.5 text-xs">
              <span className="text-text">{p.name} <span className="font-mono text-muted">({p.productCode})</span></span>
              <span className="font-mono text-muted">₹{Number(p.packRate).toFixed(2)} · Qty {p.qty}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

export default function Vendors() {
  const [vendors, setVendors] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [editingVendor, setEditingVendor] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [purchaseVendor, setPurchaseVendor] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const load = (q = "") => {
    setLoading(true);
    listVendors(q ? { q } : {}).then((data) => {
      setVendors(data);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
  }, []);

  const handleSearch = (e) => {
    setQuery(e.target.value);
    load(e.target.value);
  };

  const handleSaved = () => {
    setEditingVendor(null);
    setShowAddForm(false);
    load(query);
  };

  const toggleActive = async (v) => {
    await setVendorActive(v._id, !v.isActive);
    load(query);
  };

  return (
    <Layout>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-text">Vendors</h1>
        <div className="flex gap-2">
          <Link
            to="/purchases"
            className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-primary hover:bg-surface"
          >
            Purchase History
          </Link>
          <button
            onClick={() => setShowAddForm(true)}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-95"
          >
            Add Vendor
          </button>
        </div>
      </div>

      <input
        type="text"
        placeholder="Search by name or phone"
        value={query}
        onChange={handleSearch}
        className="mt-4 w-full max-w-sm rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
      />

      <div className="mt-6 space-y-2">
        {loading && <p className="text-sm text-muted">Loading…</p>}
        {!loading && vendors.length === 0 && <p className="text-sm text-muted">No records found.</p>}

        {vendors.map((v) => {
          const isOpen = expandedId === v._id;
          return (
            <div key={v._id} className="rounded-xl bg-surface p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  onClick={() => setExpandedId(isOpen ? null : v._id)}
                  className="flex items-center gap-2 text-left"
                >
                  <span className={`text-muted transition-transform ${isOpen ? "rotate-90" : ""}`}>▶</span>
                  <span>
                    <p className="font-medium text-text">{v.name}</p>
                    <p className="text-sm text-muted">
                      {v.phone} · {v.gstNumber}
                      {v.overallRating != null && (
                        <span className="ml-2 text-warning">{"★".repeat(Math.round(v.overallRating))}<span className="text-muted">{v.overallRating.toFixed(1)}</span></span>
                      )}
                    </p>
                  </span>
                </button>
                <div className="flex items-center gap-2">
                  {v.outstandingPayable > 0 && (
                    <span className="font-mono text-sm font-semibold text-danger">₹{v.outstandingPayable.toFixed(2)} payable</span>
                  )}
                  <Link
                    to={`/vendors/${v._id}/ledger`}
                    className="rounded-lg px-3 py-1.5 text-sm font-semibold text-primary hover:bg-bg"
                  >
                    Ledger
                  </Link>
                  <Link
                    to={`/vendors/${v._id}/analysis`}
                    className="rounded-lg px-3 py-1.5 text-sm font-semibold text-primary hover:bg-bg"
                  >
                    Analysis
                  </Link>
                  <button
                    onClick={() => setPurchaseVendor(v)}
                    className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-dark"
                  >
                    New Purchase
                  </button>
                  <button onClick={() => setEditingVendor(v)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-primary hover:bg-bg">
                    Edit
                  </button>
                  <button onClick={() => toggleActive(v)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-muted hover:bg-bg">
                    Deactivate
                  </button>
                </div>
              </div>
              {isOpen && <VendorProducts vendorId={v._id} />}
            </div>
          );
        })}
      </div>

      {(showAddForm || editingVendor) && (
        <VendorFormModal
          vendor={editingVendor}
          onClose={() => {
            setShowAddForm(false);
            setEditingVendor(null);
          }}
          onSaved={handleSaved}
        />
      )}

      {purchaseVendor && (
        <PurchaseFormModal
          vendor={purchaseVendor}
          onClose={() => setPurchaseVendor(null)}
          onSaved={() => {
            setPurchaseVendor(null);
            toast.success("Purchase recorded — stock updated.");
          }}
        />
      )}
    </Layout>
  );
}
