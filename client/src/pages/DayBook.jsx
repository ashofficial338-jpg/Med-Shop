import { useEffect, useState } from "react";
import Layout from "../components/Layout";
import { getDayBookSummary, recordDayBookAdjustment, exportDayBook } from "../api/daybook";
import ExportButtons from "../components/ExportButtons";

const TYPES = [
  { key: "cash", label: "Cash", type: "Cash" },
  { key: "upi", label: "UPI", type: "UPI" },
  { key: "credit", label: "Credit (Receivables)", type: "Credit" },
];

function currency(n) {
  return `₹${Number(n || 0).toFixed(2)}`;
}

function BalanceCard({ label, type, date, data, onAdjusted }) {
  const [showForm, setShowForm] = useState(false);
  const [balance, setBalance] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const handleAdjust = async (e) => {
    e.preventDefault();
    if (!(Number(balance) >= 0) || saving) return;
    setSaving(true);
    try {
      const updated = await recordDayBookAdjustment({ type, date, balance: Number(balance), note });
      onAdjusted(updated);
      setShowForm(false);
      setBalance("");
      setNote("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl bg-surface p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-text">{label}</h2>
      <div className="mt-3 space-y-1.5 text-sm">
        <div className="flex justify-between text-muted"><span>Opening</span><span className="font-mono">{currency(data.opening)}</span></div>
        <div className="flex justify-between text-success"><span>In</span><span className="font-mono">+{currency(data.in)}</span></div>
        <div className="flex justify-between text-danger"><span>Out</span><span className="font-mono">-{currency(data.out)}</span></div>
        <div className="flex justify-between border-t border-border pt-1.5 font-semibold text-text"><span>Closing</span><span className="font-mono">{currency(data.closing)}</span></div>
      </div>

      <button
        onClick={() => setShowForm((s) => !s)}
        className="mt-3 text-xs font-semibold text-primary hover:underline"
      >
        {showForm ? "Cancel" : "Correct Balance"}
      </button>

      {showForm && (
        <form onSubmit={handleAdjust} className="mt-2 space-y-2 rounded-lg bg-bg p-3">
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="True balance as of this date"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text"
          />
          <input
            type="text"
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text"
          />
          <button
            type="submit"
            disabled={!(Number(balance) >= 0) || saving}
            className="w-full rounded-lg bg-primary py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Correction"}
          </button>
        </form>
      )}
    </div>
  );
}

export default function DayBook() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    getDayBookSummary(date).then((d) => {
      setData(d);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  return (
    <Layout>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-text">Day Book</h1>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
          />
          <ExportButtons onExport={(format) => exportDayBook(date, format)} />
        </div>
      </div>

      {loading && <p className="mt-6 text-sm text-muted">Loading…</p>}

      {!loading && data && (
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {TYPES.map((t) => (
            <BalanceCard key={t.key} label={t.label} type={t.type} date={date} data={data[t.key]} onAdjusted={load} />
          ))}
        </div>
      )}
    </Layout>
  );
}
