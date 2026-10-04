import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import Layout from "../components/Layout";
import { listExpenses, createExpense, deleteExpense, exportExpenses } from "../api/expenses";
import ReportDownloadButtons from "../components/ReportDownloadButtons";

// Interest/Taxes/Depreciation/Amortization are the dashboard's EBITDA add-backs.
// Depreciation/Amortization aren't money paid out, so the server always saves
// them as "Non-cash" (kept out of the Day Book's cash/UPI balances).
const CATEGORIES = ["Rent", "Salary", "Utilities", "Other", "Interest", "Taxes", "Depreciation", "Amortization"];
const NON_CASH = ["Depreciation", "Amortization"];
const PAYMENT_MODES = ["Cash", "UPI", "Card", "Other"];

export default function Expenses() {
  // Dashboard links open this page with ?from&to already set.
  const [searchParams] = useSearchParams();
  const [expenses, setExpenses] = useState([]);
  const [from, setFrom] = useState(searchParams.get("from") || "");
  const [to, setTo] = useState(searchParams.get("to") || "");
  const [filterCategory, setFilterCategory] = useState(searchParams.get("category") || "");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const [category, setCategory] = useState("Rent");
  const [amount, setAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState("Cash");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const buildParams = () => {
    const params = {};
    if (from) params.from = from;
    if (to) params.to = to;
    if (filterCategory) params.category = filterCategory;
    return params;
  };

  const load = () => {
    setLoading(true);
    listExpenses(buildParams()).then((data) => {
      setExpenses(data);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, filterCategory]);

  const inputCls =
    "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none";

  const total = expenses.reduce((sum, e) => sum + e.amount, 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!(Number(amount) > 0) || !date || saving) return;
    setSaving(true);
    setError("");
    try {
      await createExpense({ category, amount: Number(amount), paymentMode, date, notes });
      setAmount("");
      setNotes("");
      setShowForm(false);
      toast.success("Expense added.");
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (expense) => {
    const label = `${expense.category} expense of ₹${expense.amount.toFixed(2)} on ${new Date(expense.date).toLocaleDateString()}`;
    if (!window.confirm(`Delete this ${label}? This cannot be undone.`)) return;
    setDeletingId(expense._id);
    try {
      await deleteExpense(expense._id);
      toast.success("Expense deleted.");
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Layout>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-text">Expenses</h1>
        <div className="flex items-center gap-2">
          <ReportDownloadButtons onExport={(format) => exportExpenses(format, buildParams())} />
          <button
            onClick={() => setShowForm((s) => !s)}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-95"
          >
            {showForm ? "Cancel" : "Add Expense"}
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="mt-4 rounded-xl bg-surface p-4 shadow-sm">
          <div className="flex flex-wrap gap-2">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={`${inputCls} w-32`}
            />
            {NON_CASH.includes(category) ? (
              <span className={`${inputCls} text-muted`} title="Depreciation and amortization aren't cash payments">
                Non-cash
              </span>
            ) : (
              <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} className={inputCls}>
                {PAYMENT_MODES.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            )}
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            <input
              type="text"
              placeholder="Notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={`${inputCls} flex-1 min-w-[10rem]`}
            />
            <button
              type="submit"
              disabled={!(Number(amount) > 0) || saving}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-primary-dark"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        </form>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select aria-label="Category" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className={inputCls}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        <span className="text-sm text-muted">to</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        {(from || to || filterCategory) && (
          <button
            onClick={() => {
              setFrom("");
              setTo("");
              setFilterCategory("");
            }}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-primary hover:bg-surface"
          >
            Clear
          </button>
        )}
        <span className="ml-auto font-mono text-sm font-semibold text-text">Total: ₹{total.toFixed(2)}</span>
      </div>

      <div className="mt-4 space-y-2">
        {loading && <p className="text-sm text-muted">Loading…</p>}
        {!loading && expenses.length === 0 && <p className="text-sm text-muted">No records found.</p>}

        {expenses.map((e) => (
          <div key={e._id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface p-4 shadow-sm">
            <div>
              <p className="font-medium text-text">
                {e.category}
                <span className="ml-2 rounded-full bg-bg px-2 py-0.5 text-xs font-semibold text-muted">{e.paymentMode}</span>
              </p>
              <p className="text-xs text-muted">
                {new Date(e.date).toLocaleDateString()}
                {e.notes && ` · ${e.notes}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <p className="font-mono text-sm font-semibold text-text">₹{e.amount.toFixed(2)}</p>
              <button
                onClick={() => handleDelete(e)}
                disabled={deletingId === e._id}
                className="rounded-lg px-3 py-1.5 text-sm font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
              >
                {deletingId === e._id ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </Layout>
  );
}
