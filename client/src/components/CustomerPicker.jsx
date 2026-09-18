import { useEffect, useRef, useState } from "react";
import { searchCustomers, createCustomer, getCustomer } from "../api/customers";
import RequiredMark from "./RequiredMark";

const PHONE_RE = /^\d{10}$/;

export default function CustomerPicker({ selected, onSelect, isAdmin }) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    // Reset the purchase-history accordion whenever the picked customer changes.
    setHistoryOpen(false);
    setHistory(null);
  }, [selected?._id]);

  useEffect(() => {
    if (selected || !query.trim()) {
      setMatches([]);
      return;
    }
    setSearching(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const results = await searchCustomers(query.trim());
      setMatches(results);
      setSearching(false);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, selected]);

  const openAddForm = () => {
    const isPhoneLike = /^\d+$/.test(query.trim());
    setNewName(isPhoneLike ? "" : query.trim());
    setNewPhone(isPhoneLike ? query.trim().slice(0, 10) : "");
    setError("");
    setShowAddForm(true);
  };

  const handleCreate = async () => {
    if (!newName.trim() || !PHONE_RE.test(newPhone)) return;
    setSaving(true);
    setError("");
    try {
      const customer = await createCustomer({ name: newName.trim(), phone: newPhone });
      onSelect(customer);
      setShowAddForm(false);
      setQuery("");
      setMatches([]);
    } catch (err) {
      setError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const toggleHistory = async () => {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    setHistoryOpen(true);
    if (history) return;
    setLoadingHistory(true);
    const data = await getCustomer(selected._id);
    setHistory(data.bills);
    setLoadingHistory(false);
  };

  if (selected) {
    return (
      <div>
        <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-sm">
          <span className="text-text">{selected.name} · {selected.phone}</span>
          <button
            type="button"
            onClick={() => {
              onSelect(null);
              setQuery("");
            }}
            className="text-xs font-semibold text-primary hover:underline"
          >
            Change
          </button>
        </div>

        {isAdmin && (
          <div className="mt-2 overflow-hidden rounded-lg border border-border">
            <button
              type="button"
              onClick={toggleHistory}
              className="flex w-full items-center justify-between bg-bg px-3 py-2 text-left text-xs font-semibold text-text hover:bg-border/40"
            >
              Purchase History
              <span className="text-muted">{historyOpen ? "▲" : "▼"}</span>
            </button>
            {historyOpen && (
              <div className="max-h-56 space-y-1.5 overflow-y-auto p-2">
                {loadingHistory && <p className="p-2 text-xs text-muted">Loading…</p>}
                {!loadingHistory && history?.length === 0 && (
                  <p className="p-2 text-xs text-muted">No previous purchases.</p>
                )}
                {!loadingHistory &&
                  history?.map((b) => (
                    <div key={b._id} className="flex justify-between rounded-lg bg-bg px-2.5 py-1.5 text-xs">
                      <span className="text-text">
                        {b.billNo}
                        {b.paymentStatus === "void" && <span className="ml-2 text-danger">VOID</span>}
                        <span className="ml-2 text-muted">{new Date(b.createdAt).toLocaleDateString()}</span>
                      </span>
                      <span className="font-mono text-text">₹{b.total.toFixed(2)}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        type="text"
        placeholder="Search by name or phone (optional — Walk-in if blank)"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setShowAddForm(false);
        }}
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
      />

      {query.trim() && !showAddForm && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-surface shadow-lg">
          {searching && <p className="px-3 py-2 text-xs text-muted">Searching…</p>}
          {!searching &&
            matches.map((c) => (
              <button
                key={c._id}
                type="button"
                onClick={() => {
                  onSelect(c);
                  setQuery("");
                  setMatches([]);
                }}
                className="block w-full px-3 py-2 text-left text-sm text-text hover:bg-bg"
              >
                {c.name} · {c.phone}
              </button>
            ))}
          {!searching && (
            <button
              type="button"
              onClick={openAddForm}
              className="block w-full border-t border-border px-3 py-2 text-left text-sm font-semibold text-primary hover:bg-bg"
            >
              + Add "{query.trim()}" as new customer
            </button>
          )}
        </div>
      )}

      {showAddForm && (
        <div className="mt-2 rounded-lg border border-border bg-surface p-3">
          <p className="text-xs text-muted">New customer</p>
          <div className="mt-1.5 space-y-1.5">
            <div>
              <label className="block text-xs font-medium text-text">Name<RequiredMark /></label>
              <input
                type="text"
                maxLength={100}
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="mt-0.5 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text">Phone<RequiredMark /></label>
              <input
                type="tel"
                maxLength={10}
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value.replace(/\D/g, ""))}
                className="mt-0.5 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text"
              />
            </div>
          </div>
          {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={handleCreate}
              disabled={!newName.trim() || !PHONE_RE.test(newPhone) || saving}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save & Select"}
            </button>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-muted hover:bg-bg"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
