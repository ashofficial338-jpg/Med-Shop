import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import { listSales } from "../api/sales";
import { useAuth } from "../context/AuthContext";

export default function BillHistory() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [sales, setSales] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const load = (q = "") => {
    setLoading(true);
    listSales(q ? { q } : {}).then((data) => {
      setSales(data);
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

  return (
    <Layout>
      <h1 className="font-display text-2xl font-semibold text-text">
        {user.role === "admin" ? "Bill History" : "My Bills"}
      </h1>

      <input
        type="text"
        placeholder="Search by bill number"
        value={query}
        onChange={handleSearch}
        className="mt-4 w-full max-w-sm rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
      />

      <div className="mt-6 space-y-2">
        {loading && <p className="text-sm text-muted">Loading…</p>}
        {!loading && sales.length === 0 && <p className="text-sm text-muted">No records found.</p>}

        {sales.map((s) => (
          <button
            key={s._id}
            onClick={() => navigate(`/bills/${s._id}`)}
            className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl bg-surface p-4 text-left shadow-sm hover:bg-bg"
          >
            <div>
              <p className="font-medium text-text">
                {s.billNo}
                {s.paymentStatus === "void" && (
                  <span className="ml-2 rounded-full bg-danger/15 px-2 py-0.5 text-xs font-semibold text-danger">VOID</span>
                )}
              </p>
              <p className="text-xs text-muted">
                {new Date(s.createdAt).toLocaleString()} · {s.customer?.name || "Walk-in"}
                {user.role === "admin" && ` · by ${s.createdBy?.username}`}
              </p>
            </div>
            <p className="font-mono text-sm font-semibold text-text">₹{s.total.toFixed(2)}</p>
          </button>
        ))}
      </div>
    </Layout>
  );
}
