import { useEffect, useState } from "react";
import Layout from "../components/Layout";
import { listPurchases } from "../api/purchases";
import { listVendors } from "../api/vendors";

export default function PurchaseHistory() {
  const [purchases, setPurchases] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [vendor, setVendor] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    const params = {};
    if (vendor) params.vendor = vendor;
    if (from) params.from = from;
    if (to) params.to = to;
    listPurchases(params).then((data) => {
      setPurchases(data);
      setLoading(false);
    });
  };

  useEffect(() => {
    listVendors().then(setVendors);
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor, from, to]);

  const selectCls =
    "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none";

  return (
    <Layout>
      <h1 className="font-display text-2xl font-semibold text-text">Purchase History</h1>

      <div className="mt-4 flex flex-wrap gap-2">
        <select value={vendor} onChange={(e) => setVendor(e.target.value)} className={selectCls}>
          <option value="">All Vendors</option>
          {vendors.map((v) => (
            <option key={v._id} value={v._id}>{v.name}</option>
          ))}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={selectCls} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={selectCls} />
      </div>

      <div className="mt-6 space-y-2">
        {loading && <p className="text-sm text-muted">Loading…</p>}
        {!loading && purchases.length === 0 && <p className="text-sm text-muted">No records found.</p>}

        {purchases.map((p) => (
          <div key={p._id} className="rounded-xl bg-surface p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium text-text">{p.vendor?.name} — {p.invoiceNo}</p>
                <p className="text-xs text-muted">{new Date(p.date).toLocaleDateString()}</p>
              </div>
              <p className="font-mono text-sm font-semibold text-text">₹{p.total.toFixed(2)}</p>
            </div>
            <ul className="mt-2 space-y-0.5 text-xs text-muted">
              {p.items.map((item, i) => (
                <li key={i}>
                  {item.product?.name} ({item.product?.productCode}) — {item.qtyPacks} × ₹{item.costPrice}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Layout>
  );
}
