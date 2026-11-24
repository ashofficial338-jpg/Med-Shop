import { useState } from "react";
import { Link } from "react-router-dom";
import { fullDate, money2 } from "./dashboard/format";

const show = (type, v) => (type === "money" || type === "due" ? money2(v) : type === "date" ? (v ? fullDate(v) : "—") : v || 0);

// The list on Vendor and Customer Management: click a heading to sort, a name
// to open everything about them.
export default function PartyTable({ rows, columns, base, sub, badge, actions, loading }) {
  const [sort, setSort] = useState({ key: "name", dir: 1 });
  const sorted = [...rows].sort((a, b) => {
    const [x, y] = [a[sort.key], b[sort.key]];
    if (sort.key === "name") return String(x).localeCompare(String(y)) * sort.dir;
    const n = (v) => (v === null || v === undefined ? 0 : typeof v === "string" ? new Date(v).getTime() : v);
    return (n(x) - n(y)) * sort.dir;
  });
  const by = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : key === "name" ? 1 : -1 }));
  const head = (key, label, right) => (
    <th key={key} className={`px-4 py-2.5 font-semibold ${right ? "text-right" : "text-left"}`} aria-sort={sort.key === key ? (sort.dir > 0 ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => by(key)} className="uppercase tracking-wide hover:text-primary">
        {label}
        {sort.key === key ? (sort.dir > 0 ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );

  return (
    <div className="mt-4 overflow-x-auto rounded-2xl bg-surface shadow-sm">
      <table className="w-full min-w-[820px] text-sm text-text">
        <thead className="border-b border-border text-[11px] text-muted">
          <tr>
            {head("name", "Name")}
            {columns.map((c) => head(c.key, c.label, true))}
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {(loading || rows.length === 0) && (
            <tr>
              <td colSpan={columns.length + 2} className="px-4 py-10 text-center text-muted">{loading ? "Loading…" : "No records found."}</td>
            </tr>
          )}
          {sorted.map((r) => (
            <tr key={r._id} className="hover:bg-bg/60">
              <td className="px-4 py-3">
                <Link to={`${base}/${r._id}`} className="font-semibold text-primary hover:underline">
                  {r.name}
                </Link>
                {badge?.(r)}
                {sub(r) && <p className="text-xs text-muted">{sub(r)}</p>}
              </td>
              {columns.map((c) => (
                <td key={c.key} className={`whitespace-nowrap px-4 py-3 text-right tabular-nums ${c.type === "due" && r[c.key] > 0 ? "font-semibold text-danger" : ""}`}>
                  {show(c.type, r[c.key])}
                </td>
              ))}
              <td className="px-4 py-3">
                <div className="flex justify-end gap-1 whitespace-nowrap">
                  {actions(r).map((a) =>
                    a.to ? (
                      <Link key={a.label} to={a.to} className="rounded-lg px-2 py-1 text-xs font-semibold text-primary hover:bg-primary-soft">
                        {a.label}
                      </Link>
                    ) : (
                      <button key={a.label} type="button" onClick={a.onClick} className={`rounded-lg px-2 py-1 text-xs font-semibold ${a.danger ? "text-danger hover:bg-danger/10" : "text-primary hover:bg-primary-soft"}`}>
                        {a.label}
                      </button>
                    )
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
