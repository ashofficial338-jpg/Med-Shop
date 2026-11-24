import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import Layout from "../components/Layout";
import Icon from "../components/Icon";
import { useCart } from "../context/CartContext";
import { useLiveRefresh } from "../context/LiveSync";
import { clearTransactionRecords, createTransactionBackup, getTransactionCounts } from "../api/maintenance";
import { todayLocal } from "../utils/date";

const CONFIRM_WORD = "CLEAR";
const n = (count, what) => `${count} ${what}${count === 1 ? "" : "s"}`;

function saveFile(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function Choice({ type = "checkbox", name, checked, onChange, title, text, tone }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3 hover:bg-bg">
      <input type={type} name={name} checked={checked} onChange={onChange} className="mt-0.5 h-4 w-4 accent-primary" />
      <span>
        <span className={`block text-sm font-semibold ${tone === "danger" && checked ? "text-danger" : "text-text"}`}>{title}</span>
        <span className="block text-xs text-muted">{text}</span>
      </span>
    </label>
  );
}

// Clear All Transaction Records (Admin): see what goes and what stays, take a
// backup, then confirm with the word CLEAR and a password. The server enforces
// every step; user accounts are never part of it.
export default function ClearRecords() {
  const { clearCart, renewBillRef } = useCart();
  const [info, setInfo] = useState(null);
  const [keepStock, setKeepStock] = useState(false);
  const [deleteCustomers, setDeleteCustomers] = useState(false);
  const [deleteVendors, setDeleteVendors] = useState(false);
  const [restartNumbers, setRestartNumbers] = useState(true);
  const [backup, setBackup] = useState(null); // { token, fileName }
  const [backingUp, setBackingUp] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [word, setWord] = useState("");
  const [password, setPassword] = useState("");
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);
  const wordRef = useRef(null);

  const load = () =>
    getTransactionCounts()
      .then(setInfo)
      .catch((err) => setError(err.response?.data?.message || "Could not load the record counts."));
  useEffect(() => {
    load();
  }, []);
  useLiveRefresh(["sales", "purchases", "products", "customers", "vendors", "expenses", "daybook", "stock"], load);

  useEffect(() => {
    if (confirming) wordRef.current?.focus();
  }, [confirming]);

  const total = info ? info.rows.reduce((s, r) => s + r.count, 0) : 0;
  const nothingToDo = info && total === 0 && info.kept.inStock === 0 && !deleteCustomers && !deleteVendors;

  const takeBackup = async () => {
    setBackingUp(true);
    setError("");
    try {
      const { token, file } = await createTransactionBackup();
      const fileName = `GuganMedicals_Backup_${todayLocal()}.json`;
      saveFile(file, fileName);
      setBackup({ token, fileName });
    } catch (err) {
      setError(err.response?.data?.message || "The backup couldn't be made. Please try again.");
    } finally {
      setBackingUp(false);
    }
  };

  const closeConfirm = () => {
    setConfirming(false);
    setWord("");
    setPassword("");
    setError("");
  };

  const clear = async (e) => {
    e.preventDefault();
    if (clearing || word !== CONFIRM_WORD || !password) return;
    setClearing(true);
    setError("");
    try {
      const result = await clearTransactionRecords({ confirm: word, password, backupToken: backup.token, keepStock, deleteCustomers, deleteVendors, restartNumbers });
      // A half-made bill may name stock that is gone.
      clearCart();
      renewBillRef();
      closeConfirm();
      setBackup(null);
      setDone(result.counts);
      toast.success("All transaction records cleared.");
      load();
    } catch (err) {
      const data = err.response?.data;
      setError(data?.message || "No answer from the server. Reload this page to see whether the records were cleared.");
      setPassword("");
      if (data?.needsBackup) {
        setBackup(null);
        setConfirming(false);
        setWord("");
      }
    } finally {
      setClearing(false);
    }
  };

  const kept = info?.kept;
  const alsoDeleted = [deleteCustomers && n(kept?.customers, "customer"), deleteVendors && n(kept?.vendors, "supplier")].filter(Boolean);
  const inputCls = "mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none";
  const step = (num, title) => (
    <h2 className="flex items-center gap-2.5 font-display text-base font-bold text-text">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-soft text-sm text-primary">{num}</span>
      {title}
    </h2>
  );

  return (
    <Layout>
      <div className="max-w-3xl">
        <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-[28px]">Clear All Transaction Records</h1>
        <p className="mt-1 text-sm text-muted">Start again with no sales, purchases or payments. User accounts, passwords, roles and permissions are never touched.</p>
        {info?.lastCleared && (
          <p className="mt-1 text-xs text-muted">
            Last cleared on {new Date(info.lastCleared.at).toLocaleString()}
            {info.lastCleared.by ? ` by ${info.lastCleared.by}` : ""}.
          </p>
        )}

        {done && (
          <div className="mt-4 rounded-xl border border-success/30 bg-success/10 p-4 text-sm text-text" role="status">
            <p className="flex items-center gap-2 font-semibold">
              <Icon name="check" size={18} className="text-success" /> Cleared. The app is ready for fresh entries.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link to="/purchases/new" className="rounded-lg bg-primary px-4 py-1.5 font-semibold text-white hover:bg-primary-dark">New Purchase</Link>
              <Link to="/billing" className="rounded-lg bg-accent px-4 py-1.5 font-semibold text-white hover:brightness-95">New Bill</Link>
              <Link to="/dashboard" className="rounded-lg border border-border bg-surface px-4 py-1.5 font-semibold text-primary hover:bg-bg">Dashboard</Link>
            </div>
          </div>
        )}
        {error && !confirming && <p className="mt-4 text-sm text-danger" role="alert">{error}</p>}
        {!info && !error && <p className="mt-6 text-sm text-muted">Loading…</p>}

        {info && (
          <div className="mt-5 space-y-5">
            <section className="rounded-2xl bg-surface p-5 shadow-sm">
              {step(1, "Check what goes and what stays")}
              <div className="mt-4 grid gap-5 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-danger">Will be cleared</p>
                  <ul className="mt-2 space-y-1.5 text-sm text-text">
                    {info.rows.map((r) => (
                      <li key={r.key} className="flex justify-between gap-3">
                        <span>{r.label}</span>
                        <span className="font-semibold tabular-nums">{r.count}</span>
                      </li>
                    ))}
                    {alsoDeleted.map((t) => (
                      <li key={t} className="font-semibold text-danger">+ {t}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-muted">Balances, reports, sales and purchase analysis and the dashboard all go to zero with them.</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-success">Always kept</p>
                  <ul className="mt-2 space-y-1.5 text-sm text-text">
                    <li>User accounts, logins, roles and permissions</li>
                    <li>{n(kept.products, "product")} with prices and GST</li>
                    {!deleteCustomers && <li>{n(kept.customers, "customer")}</li>}
                    {!deleteVendors && <li>{n(kept.vendors, "supplier")}</li>}
                    <li>Categories, racks and settings</li>
                  </ul>
                </div>
              </div>
            </section>

            <section className="rounded-2xl bg-surface p-5 shadow-sm">
              {step(2, "Choose the options")}
              <div className="mt-4 space-y-2">
                <Choice type="radio" name="stock" checked={!keepStock} onChange={() => setKeepStock(false)} title="Set all stock to zero" text="Stock comes in again through new purchases." />
                <Choice type="radio" name="stock" checked={keepStock} onChange={() => setKeepStock(true)} title="Keep the present stock as opening stock" text={`Quantities, batches, expiry and cost stay as they are (${n(kept.inStock, "product")} in stock).`} />
                <Choice checked={restartNumbers} onChange={(e) => setRestartNumbers(e.target.checked)} title="Restart bill numbers from GM-000001" text="Untick this if customers hold bills already issued, so a number is never used twice." />
                <Choice checked={deleteCustomers} onChange={(e) => setDeleteCustomers(e.target.checked)} tone="danger" title="Also delete the customer list" text={`${n(kept.customers, "customer")}. Not deleted unless ticked.`} />
                <Choice checked={deleteVendors} onChange={(e) => setDeleteVendors(e.target.checked)} tone="danger" title="Also delete the supplier list" text={`${n(kept.vendors, "supplier")}. Not deleted unless ticked.`} />
              </div>
            </section>

            <section className="rounded-2xl bg-surface p-5 shadow-sm">
              {step(3, "Download a backup")}
              <p className="mt-2 text-sm text-muted">Required. Keep this file safe: it is the only way to get these records back.</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button type="button" onClick={takeBackup} disabled={backingUp} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50">
                  <Icon name="download" size={16} />
                  {backingUp ? "Preparing…" : backup ? "Download again" : "Download backup"}
                </button>
                {backup && (
                  <span className="flex items-center gap-1.5 text-sm text-success" role="status">
                    <Icon name="check" size={16} /> {backup.fileName} – check that it is in your Downloads folder
                  </span>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-danger/30 bg-surface p-5 shadow-sm">
              {step(4, "Clear the records")}
              <p className="mt-2 text-sm text-muted">
                {nothingToDo ? "There are no transaction records to clear." : backup ? "You will be asked to confirm once more." : "Download the backup first."}
              </p>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={!backup || nothingToDo}
                className="mt-3 rounded-lg bg-danger px-5 py-2.5 text-sm font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Clear All Transaction Records
              </button>
            </section>
          </div>
        )}
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-10" onKeyDown={(e) => e.key === "Escape" && !clearing && closeConfirm()}>
          <form onSubmit={clear} role="alertdialog" aria-modal="true" aria-labelledby="clear-title" className="w-full max-w-md space-y-4 rounded-2xl bg-surface p-6 shadow-xl">
            <h2 id="clear-title" className="flex items-center gap-2 font-display text-lg font-bold text-danger">
              <Icon name="alert" size={20} /> Clear all transaction records?
            </h2>
            <ul className="list-disc space-y-1 pl-5 text-sm text-text">
              <li>{n(total, "record")} will be permanently erased from the live shop.</li>
              <li>{keepStock ? "Present stock is kept as opening stock." : "All stock becomes zero."}</li>
              {restartNumbers && <li>Bill numbers restart from GM-000001.</li>}
              {alsoDeleted.length > 0 && <li className="font-semibold text-danger">{alsoDeleted.join(" and ")} will also be deleted.</li>}
              <li>User accounts and logins are not affected.</li>
            </ul>
            <div>
              <label htmlFor="clear-word" className="text-sm font-medium text-text">Type {CONFIRM_WORD} to confirm</label>
              <input id="clear-word" ref={wordRef} type="text" autoComplete="off" value={word} onChange={(e) => setWord(e.target.value.toUpperCase())} className={inputCls} />
            </div>
            <div>
              <label htmlFor="clear-password" className="text-sm font-medium text-text">Your password</label>
              <input id="clear-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
            </div>
            {error && <p className="text-sm text-danger" role="alert">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={closeConfirm} disabled={clearing} className="rounded-lg px-5 py-2 text-sm font-semibold text-muted hover:bg-bg disabled:opacity-50">
                Cancel
              </button>
              <button type="submit" disabled={clearing || word !== CONFIRM_WORD || !password} className="rounded-lg bg-danger px-5 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40">
                {clearing ? "Clearing…" : "Yes, clear records"}
              </button>
            </div>
          </form>
        </div>
      )}
    </Layout>
  );
}
