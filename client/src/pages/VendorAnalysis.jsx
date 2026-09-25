import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import Layout from "../components/Layout";
import { getVendorReport, rateVendor } from "../api/vendors";

const COLOR_PRIMARY = "#0F6B66";
const AXIS_TEXT = { fontSize: 12, fill: "#5B7A77" };

const RATING_AXES = [
  { key: "quality", label: "Product Quality" },
  { key: "reliability", label: "Trust / Reliability" },
  { key: "costEfficiency", label: "Cost Efficiency" },
];

function Stars({ value }) {
  if (value == null) return <span className="text-sm text-muted">Not yet rated</span>;
  const rounded = Math.round(value);
  return (
    <span className="text-lg text-warning" aria-label={`${value} out of 5 stars`}>
      {"★".repeat(rounded)}
      <span className="text-border">{"★".repeat(5 - rounded)}</span>
      <span className="ml-1 font-mono text-sm text-muted">{value.toFixed(1)}</span>
    </span>
  );
}

function StarPicker({ value, onChange }) {
  return (
    <span className="text-xl">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={n <= (value || 0) ? "text-warning" : "text-border hover:text-warning/50"}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
        >
          ★
        </button>
      ))}
    </span>
  );
}

export default function VendorAnalysis() {
  const { id } = useParams();
  const [period, setPeriod] = useState("month");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [draftRatings, setDraftRatings] = useState({ quality: null, reliability: null, costEfficiency: null });
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    getVendorReport(id, period).then((d) => {
      setData(d);
      setDraftRatings({
        quality: d.vendor.ratings?.quality ?? null,
        reliability: d.vendor.ratings?.reliability ?? null,
        costEfficiency: d.vendor.ratings?.costEfficiency ?? null,
      });
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, period]);

  const handleSaveRating = async () => {
    setSaving(true);
    try {
      const vendor = await rateVendor(id, draftRatings);
      setData((d) => ({ ...d, vendor: { ...d.vendor, ratings: vendor.ratings, overallRating: vendor.overallRating } }));
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

  const { vendor, report } = data;

  return (
    <Layout>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-text">{vendor.name} — Analysis</h1>
          <p className="text-sm text-muted">{vendor.phone} · {vendor.gstNumber}</p>
        </div>
        <Stars value={vendor.overallRating} />
      </div>

      <div className="mt-6 rounded-xl bg-surface p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-text">Rate This Vendor</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {RATING_AXES.map((axis) => (
            <div key={axis.key}>
              <p className="text-xs font-medium text-muted">{axis.label}</p>
              <StarPicker
                value={draftRatings[axis.key]}
                onChange={(n) => setDraftRatings((d) => ({ ...d, [axis.key]: n }))}
              />
            </div>
          ))}
        </div>
        <button
          onClick={handleSaveRating}
          disabled={saving}
          className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-primary-dark"
        >
          {saving ? "Saving…" : "Save Rating"}
        </button>
      </div>

      <div className="mt-6 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-text">Purchase Report</h2>
        <div className="ml-auto flex gap-1">
          {["month", "quarter"].map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize ${
                period === p ? "bg-primary text-white" : "border border-border text-text hover:bg-bg"
              }`}
            >
              {p}-wise
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 rounded-xl bg-surface p-4 shadow-sm" style={{ height: 240 }}>
        {report.length === 0 ? (
          <p className="text-sm text-muted">No records found.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={report} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid stroke="#e1e0d9" vertical={false} />
              <XAxis dataKey="period" tick={AXIS_TEXT} axisLine={{ stroke: "#c3c2b7" }} tickLine={false} />
              <YAxis tick={AXIS_TEXT} axisLine={false} tickLine={false} width={50} />
              <Tooltip formatter={(v) => `₹${Number(v).toFixed(2)}`} />
              <Bar dataKey="totalPurchases" name="Purchases" fill={COLOR_PRIMARY} radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl bg-surface shadow-sm">
        <table className="w-full text-left text-sm text-text">
          <thead className="border-b border-border text-xs uppercase text-muted">
            <tr>
              <th className="px-4 py-2">Period</th>
              <th className="px-4 py-2 text-right">Invoices</th>
              <th className="px-4 py-2 text-right">Purchases</th>
              <th className="px-4 py-2 text-right">Paid</th>
              <th className="px-4 py-2 text-right">Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {report.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted">No records found.</td>
              </tr>
            )}
            {report.map((row) => (
              <tr key={row.period} className="border-b border-border last:border-0">
                <td className="px-4 py-2 font-mono">{row.period}</td>
                <td className="px-4 py-2 text-right">{row.invoiceCount}</td>
                <td className="px-4 py-2 text-right font-mono">₹{row.totalPurchases.toFixed(2)}</td>
                <td className="px-4 py-2 text-right font-mono">₹{row.totalPaid.toFixed(2)}</td>
                <td className="px-4 py-2 text-right font-mono font-semibold">₹{row.outstanding.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
