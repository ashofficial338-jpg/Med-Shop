import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { useLiveRefresh } from "../../context/LiveSync";
import ReportDownloadButtons from "../ReportDownloadButtons";
import ExtraStockModal from "../ExtraStockModal";
import { EXTRA_STOCK_REASONS } from "../../utils/stock";
import { listExtraStock, exportExtraStock, getInwardReport, exportInwardReport } from "../../api/stock";
import { compactParams } from "../../utils/query";

const selectCls = "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none";
const fmtDay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

function DateRange({ from, to, onChange }) {
  return (
    <>
      <label className="flex items-center gap-1.5 text-xs text-muted">
        From
        <input type="date" aria-label="From date" value={from} max={to || undefined} onChange={(e) => onChange({ from: e.target.value })} className={selectCls} />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-muted">
        To
        <input type="date" aria-label="To date" value={to} min={from || undefined} onChange={(e) => onChange({ to: e.target.value })} className={selectCls} />
      </label>
    </>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-sm">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold text-text">{value}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Table({ head, children, empty, cols }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-xl bg-surface shadow-sm">
      <table className="w-full text-left text-sm text-text">
        <thead className="border-b border-border text-xs uppercase text-muted">
          <tr>{head.map((h) => <th key={h} className={`px-3 py-2 ${h.startsWith("Qty") ? "text-right" : ""}`}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {empty ? (
            <tr><td colSpan={cols} className="px-3 py-6 text-center text-muted">No records found.</td></tr>
          ) : children}
        </tbody>
      </table>
    </div>
  );
}

const td = "px-3 py-2 align-top";

function ExtraRows({ rows }) {
  return rows.map((r) => (
    <tr key={r.id} className="border-b border-border last:border-0">
      <td className={`${td} whitespace-nowrap`}>{fmtDay(r.date)}</td>
      <td className={td}>{r.product} <span className="font-mono text-xs text-muted">({r.productCode})</span>{r.batchNo && <p className="text-xs text-muted">Batch {r.batchNo}</p>}</td>
      <td className={`${td} text-right font-mono font-semibold text-success`}>+{r.qty}</td>
      <td className={td}><span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{r.reason}</span></td>
      <td className={`${td} text-xs text-muted`}>{r.remarks || "—"}</td>
      <td className={`${td} text-xs`}>{r.user}<p className="text-muted">{r.recordedAt}</p></td>
    </tr>
  ));
}
const EXTRA_HEAD = ["Date", "Item", "Qty Added", "Reason", "Remarks", "Added By"];

// Extra Stock tab: the add button and the full history of additions.
export function ExtraStockTab({ params, setParam }) {
  const { from = "", to = "", reason = "" } = params;
  const query = compactParams({ from, to, reason });
  const [data, setData] = useState(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = () => listExtraStock(query).then(setData).catch(() => setData({ rows: [], totalQty: 0 }));
  useEffect(() => {
    setData(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, reason]);
  useLiveRefresh(["stock"], load);

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => setShowAdd(true)} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
          + Add Extra Stock
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <DateRange from={from} to={to} onChange={setParam} />
          <select aria-label="Reason" value={reason} onChange={(e) => setParam({ reason: e.target.value })} className={selectCls}>
            <option value="">All reasons</option>
            {EXTRA_STOCK_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <ReportDownloadButtons onExport={(format) => exportExtraStock(format, query)} />
        </div>
      </div>

      {!data && <p className="mt-4 text-sm text-muted">Loading…</p>}
      {data && (
        <>
          <div className="mt-4 flex flex-wrap gap-3">
            <Stat label="Entries" value={data.rows.length} />
            <Stat label="Quantity Added" value={data.totalQty} />
          </div>
          <Table head={EXTRA_HEAD} cols={6} empty={data.rows.length === 0}>
            <ExtraRows rows={data.rows} />
          </Table>
        </>
      )}

      {showAdd && (
        <ExtraStockModal
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            load();
            toast.success("Extra stock added.");
          }}
        />
      )}
    </div>
  );
}

// Stock In report: Purchase Inward and Extra Stock Additions kept apart.
export function InwardReportTab({ params, setParam }) {
  const { from = "", to = "" } = params;
  const query = compactParams({ from, to });
  const [data, setData] = useState(null);
  const [view, setView] = useState("purchase");

  const load = () => getInwardReport(query).then(setData).catch(() => setData(null));
  useEffect(() => {
    setData(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);
  useLiveRefresh(["stock", "purchases"], load);

  const tabCls = (v) => `rounded-lg px-3 py-1.5 text-sm font-semibold ${view === v ? "bg-primary text-white" : "bg-surface text-muted shadow-sm"}`;

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <DateRange from={from} to={to} onChange={setParam} />
        </div>
        <ReportDownloadButtons onExport={(format) => exportInwardReport(format, query)} />
      </div>

      {!data && <p className="mt-4 text-sm text-muted">Loading…</p>}
      {data && (
        <>
          <div className="mt-4 flex flex-wrap gap-3">
            <Stat label="Purchase Inward" value={data.purchase.totalQty} hint={`${data.purchase.rows.length} lines · ${data.purchase.invoices} invoices`} />
            <Stat label="Extra Stock Additions" value={data.extra.totalQty} hint={`${data.extra.rows.length} entries`} />
            <Stat label="Total Stock In" value={data.totalQty} />
          </div>
          {data.extra.byReason.length > 0 && (
            <p className="mt-2 text-xs text-muted">
              Extra stock by reason: {data.extra.byReason.map((b) => `${b.reason} ${b.qty}`).join(" · ")}
            </p>
          )}

          <div className="mt-4 flex gap-2">
            <button className={tabCls("purchase")} onClick={() => setView("purchase")}>Purchase Inward ({data.purchase.rows.length})</button>
            <button className={tabCls("extra")} onClick={() => setView("extra")}>Extra Stock ({data.extra.rows.length})</button>
          </div>

          {view === "purchase" && (
            <Table head={["Date", "Invoice", "Supplier", "Item", "Qty In", "Entered By"]} cols={6} empty={data.purchase.rows.length === 0}>
              {data.purchase.rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className={`${td} whitespace-nowrap`}>{fmtDay(r.date)}</td>
                  <td className={`${td} font-mono text-xs`}>{r.invoiceNo}</td>
                  <td className={td}>{r.supplier}</td>
                  <td className={td}>{r.product} <span className="font-mono text-xs text-muted">({r.productCode})</span>{r.batchNo && <p className="text-xs text-muted">Batch {r.batchNo}</p>}</td>
                  <td className={`${td} text-right font-mono font-semibold ${r.qty >= 0 ? "text-success" : "text-danger"}`}>{r.qty >= 0 ? "+" : ""}{r.qty}</td>
                  <td className={`${td} text-xs`}>{r.user}</td>
                </tr>
              ))}
            </Table>
          )}
          {view === "extra" && (
            <Table head={EXTRA_HEAD} cols={6} empty={data.extra.rows.length === 0}>
              <ExtraRows rows={data.extra.rows} />
            </Table>
          )}
        </>
      )}
    </div>
  );
}
