import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from "recharts";
import Icon from "../Icon";
import CountUp from "../CountUp";
import { ChartCard, EmptyChart, LegendItem, TooltipCard } from "../dashboard/DashboardCharts";
import { money2, moneyCompact, percent } from "../dashboard/format";

// Same validated palette slots as the dashboard: revenue blue, costs orange,
// profit aqua; single-series magnitude bars use the brand teal.
export const COLORS = { revenue: "#2a78d6", costs: "#eb6834", profit: "#1baf7a", brand: "#0E7C74" };
const GRID = "#edf0f3";
const AXIS = { fontSize: 11, fill: "#7b8793" };


// Compact axis labels; the tooltip keeps the full one ("Wk of 20 Jul" -> "20 Jul",
// "01 Oct 2026" -> "01 Oct", "Oct 2026" -> "Oct '26").
export function axisLabel(label) {
  const s = String(label).replace(/^Wk of /, "");
  if (/^\d{2} \w{3} \d{4}$/.test(s)) return s.slice(0, 6);
  if (/^\w{3} \d{4}$/.test(s)) return `${s.slice(0, 3)} '${s.slice(-2)}`;
  return s;
}

// Change vs the previous period. Costs going up read as bad (red).
export function changeOf(cur, prev, { costLike = false, points = false } = {}) {
  if (prev === null || prev === undefined || cur === null || cur === undefined) return null;
  if (points) {
    const d = Number((cur - prev).toFixed(1));
    return { text: `${d > 0 ? "+" : ""}${d} pts`, good: d === 0 ? null : (d > 0) !== costLike };
  }
  if (prev === 0) return cur === 0 ? { text: "No change", good: null } : { text: "New", good: null };
  const d = Number((((cur - prev) / Math.abs(prev)) * 100).toFixed(1));
  return { text: `${d > 0 ? "+" : ""}${d}%`, good: d === 0 ? null : (d > 0) !== costLike, up: d > 0 };
}

export function DeltaBadge({ change }) {
  if (!change) return null;
  const tone = change.good === null ? "bg-bg text-muted" : change.good ? "bg-success/10 text-success" : "bg-danger/10 text-danger";
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold tnum ${tone}`}>
      {change.up !== undefined && <Icon name={change.up ? "trendUp" : "trendDown"} size={12} />}
      {change.text}
    </span>
  );
}

// KPI tile with the change vs the previous period underneath.
export function KpiCard({ label, value, display, change, note, tone = "text-text", accent }) {
  return (
    <div className="card fade-up relative min-w-0 overflow-hidden p-4 sm:p-5">
      {accent && <span className="absolute inset-y-4 left-0 w-1 rounded-r-full" style={{ background: accent }} />}
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <p className={`mt-2 font-display text-[22px] font-bold leading-tight tracking-tight tnum sm:text-2xl ${tone}`}>
        {display ?? <CountUp value={value} format={money2} />}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <DeltaBadge change={change} />
        {note && <span className="text-[11px] text-muted">{note}</span>}
      </div>
    </div>
  );
}

// Revenue vs total costs (COGS + expenses + write-offs) per period - the gap
// between the two bars is that period's net profit.
export function RevenueCostChart({ trend, granularity }) {
  const data = trend.map((t) => ({ ...t, costs: Number((t.cogs + t.expenses + t.writeOff).toFixed(2)) }));
  const empty = data.every((d) => !d.revenue && !d.costs);
  return (
    <ChartCard title="Revenue vs Expenses" subtitle={`Per ${granularity} · costs = cost of goods sold + expenses + expired write-offs`}>
      <div className="mb-3 flex flex-wrap gap-4">
        <LegendItem color={COLORS.revenue} label="Revenue" />
        <LegendItem color={COLORS.costs} label="Total costs" />
      </div>
      {empty ? (
        <EmptyChart height={260} />
      ) : (
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tickFormatter={axisLabel} tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={14} dy={6} />
              <YAxis tickFormatter={moneyCompact} tick={AXIS} axisLine={false} tickLine={false} width={56} />
              <Tooltip content={<TooltipCard />} cursor={{ fill: "rgba(14,124,116,0.05)" }} />
              <Bar dataKey="revenue" name="Revenue" fill={COLORS.revenue} radius={[4, 4, 0, 0]} maxBarSize={22} />
              <Bar dataKey="costs" name="Total costs" fill={COLORS.costs} radius={[4, 4, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

function ProfitTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="min-w-[11rem] rounded-xl border border-border bg-surface/95 px-3 py-2.5 text-xs shadow-[var(--shadow-lift)] backdrop-blur">
      <p className="mb-1.5 font-semibold text-text">{label}</p>
      <Row label="Net profit" value={money2(p.profit)} />
      <Row label="Net margin" value={percent(p.marginPct)} />
      <Row label="Growth" value={p.growthPct === null ? "—" : `${p.growthPct > 0 ? "+" : ""}${p.growthPct}%`} />
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <span className="text-muted">{label}</span>
      <span className="font-semibold text-text tnum">{value}</span>
    </div>
  );
}

export function ProfitTrendChart({ trend, granularity }) {
  const empty = trend.every((t) => !t.profit);
  return (
    <ChartCard title="Profit Growth Trend" subtitle={`Net profit per ${granularity} · hover for margin and growth vs the ${granularity} before`}>
      {empty ? (
        <EmptyChart height={260} />
      ) : (
        <div className="h-[284px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gReportProfit" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.profit} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={COLORS.profit} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tickFormatter={axisLabel} tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={14} dy={6} />
              <YAxis tickFormatter={moneyCompact} tick={AXIS} axisLine={false} tickLine={false} width={56} />
              <ReferenceLine y={0} stroke="#c9d1d8" />
              <Tooltip content={<ProfitTooltip />} cursor={{ stroke: "#c9d1d8", strokeDasharray: "3 3" }} />
              <Area
                type="monotone"
                dataKey="profit"
                name="Net profit"
                stroke={COLORS.profit}
                strokeWidth={2}
                fill="url(#gReportProfit)"
                dot={trend.length <= 31 ? { r: 3, strokeWidth: 0, fill: COLORS.profit } : false}
                activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

// Ranked horizontal bars (categories, brands, payment modes...). onSelect
// makes each bar a filter shortcut.
export function RankBars({ title, subtitle, rows, labelKey, valueKey = "revenue", color = COLORS.brand, onSelect, max = 10, action }) {
  const data = rows.slice(0, max);
  const height = Math.max(200, data.length * 34 + 24);
  return (
    <ChartCard title={title} subtitle={subtitle} action={action}>
      {data.length === 0 ? (
        <EmptyChart height={200} />
      ) : (
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
              <CartesianGrid stroke={GRID} horizontal={false} />
              <XAxis type="number" tickFormatter={moneyCompact} tick={AXIS} axisLine={false} tickLine={false} />
              <YAxis dataKey={labelKey} type="category" tick={AXIS} axisLine={false} tickLine={false} width={112} />
              <Tooltip content={<TooltipCard />} cursor={{ fill: "rgba(14,124,116,0.06)" }} />
              <Bar
                dataKey={valueKey}
                name="Revenue"
                fill={color}
                radius={[0, 4, 4, 0]}
                maxBarSize={18}
                cursor={onSelect ? "pointer" : undefined}
                onClick={(entry) => onSelect?.(entry?.payload ?? entry)}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}
