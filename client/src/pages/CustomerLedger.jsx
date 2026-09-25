import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Layout from "../components/Layout";
import { getCustomerLedger, recordCustomerPayment } from "../api/customers";

export default function CustomerLedger() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("Cash");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [saleId, setSaleId] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    getCustomerLedger(id).then((d) => {
      setData(d);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const inputCls =
    "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none";

  const handleRecordPayment = async (e) => {
    e.preventDefault();
    const amountNum = Number(amount);
    if (!(amountNum > 0) || saving) return;
    setSaving(true);
    setError("");
    try {
      const updated = await recordCustomerPayment(id, {
        amount: amountNum,
        mode,
        date,
        note,
        saleId: saleId || undefined,
      });
      setData(updated);
      setAmount("");
      setNote("");
      setSaleId("");
    } catch (err) {
      setError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !data) {
    return (
      <Layout>
        <p className="text-sm text-muted">Loading…</p>
      </Layout>
    );
  }

  const { customer, entries, outstandingBalance, openSales } = data;

  return (
    <Layout>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-text">{customer.name} — Ledger</h1>
          <p className="text-sm text-muted">{customer.phone}</p>
        </div>
        <div className="rounded-xl bg-surface px-4 py-3 text-right shadow-sm">
          <p className="text-xs text-muted">Outstanding Balance</p>
          <p className={`font-mono text-xl font-semibold ${outstandingBalance > 0 ? "text-danger" : "text-text"}`}>
            ₹{outstandingBalance.toFixed(2)}
          </p>
        </div>
      </div>

      <form onSubmit={handleRecordPayment} className="mt-6 rounded-xl bg-surface p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-text">Record Payment</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            type="number"
            min="0.01"
            step="0.01"
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={`${inputCls} w-32`}
          />
          <select value={mode} onChange={(e) => setMode(e.target.value)} className={inputCls}>
            <option>Cash</option>
            <option>Card</option>
            <option>UPI</option>
            <option>Other</option>
          </select>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          <select value={saleId} onChange={(e) => setSaleId(e.target.value)} className={inputCls}>
            <option value="">On account (oldest bill first)</option>
            {openSales.map((s) => (
              <option key={s._id} value={s._id}>
                {s.billNo} — due ₹{s.balanceDue.toFixed(2)}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={`${inputCls} flex-1 min-w-[10rem]`}
          />
          <button
            type="submit"
            disabled={!(Number(amount) > 0) || saving}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-primary-dark"
          >
            {saving ? "Saving…" : "Record Payment"}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </form>

      <div className="mt-6 overflow-x-auto rounded-xl bg-surface shadow-sm">
        <table className="w-full text-left text-sm text-text">
          <thead className="border-b border-border text-xs uppercase text-muted">
            <tr>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Ref</th>
              <th className="px-4 py-2 text-right">Debit</th>
              <th className="px-4 py-2 text-right">Credit</th>
              <th className="px-4 py-2 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted">No records found.</td>
              </tr>
            )}
            {entries.map((entry, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                <td className="px-4 py-2">{new Date(entry.date).toLocaleDateString()}</td>
                <td className="px-4 py-2">{entry.type}</td>
                <td className="px-4 py-2 font-mono text-xs">{entry.ref}</td>
                <td className="px-4 py-2 text-right font-mono">{entry.debit > 0 ? `₹${entry.debit.toFixed(2)}` : ""}</td>
                <td className="px-4 py-2 text-right font-mono">{entry.credit > 0 ? `₹${entry.credit.toFixed(2)}` : ""}</td>
                <td className="px-4 py-2 text-right font-mono font-semibold">₹{entry.balance.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
