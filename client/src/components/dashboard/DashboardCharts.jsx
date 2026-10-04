import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { Link, useNavigate } from "react-router-dom";
import Icon from "../Icon";
import { money2, moneyCompact, shortDate } from "./format";

// Categorical slots 1-3 of the validated default dataviz palette (blue /
// orange / aqua) - this trio clears CVD separation under the all-pairs check,
// so any two of the three lines can sit next to each other.
const COLOR_REVENUE = "#2a78d6";
const COLOR_EXPENSE = "#eb6834";
const COLOR_PROFIT = "#1baf7a";
const BRAND = "#0E7C74"; // sequential hue for single-series magnitude bars

const GRID = "#edf0f3";
const AXIS = { fontSize: 11, fill: "#7b8793" };
const cursorLine = { stroke: "#c9d1d8", strokeWidth: 1, strokeDasharray: "3 3" };

export function ChartCard({ title, subtitle, action, children, className = "" }) {
  return (
    <section className={`card fade-up flex min-w-0 flex-col p-5 ${className}`}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-[15px] font-semibold text-text">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className="mt-4 flex-1">{children}</div>
    </section>
  );
}

function LegendItem({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

export function EmptyChart({ message = "No records found for this period.", height = 240 }) {
  return (
    <div
      style={{ height }}
      className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-bg/60 text-center"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface text-muted shadow-sm">
        <Icon name="chart" size={18} />
      </span>
      <p className="max-w-[16rem] text-xs text-muted">{message}</p>
    </div>
  );
}

function TooltipCard({ active, payload, label, labelFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[10rem] rounded-xl border border-border bg-surface/95 px-3 py-2.5 text-xs shadow-[var(--shadow-lift)] backdrop-blur">
      {label != null && <p className="mb-1.5 font-semibold text-text">{labelFormatter ? labelFormatter(label) : label}</p>}
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-muted">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="font-semibold text-text tnum">{money2(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

function tickInterval(n) {
  if (n <= 10) return 0;
  return Math.ceil(n / 8) - 1;
}

const TREND_SERIES = [
  { key: "revenue", name: "Revenue", color: COLOR_REVENUE },
  { key: "expense", name: "Expense", color: COLOR_EXPENSE },
  { key: "profit", name: "Profit", color: COLOR_PROFIT },
];

export function SalesTrendChart({ data, linkForDay }) {
  const navigate = useNavigate();
  return (
    <ChartCard title="Sales Trend" subtitle="Revenue · Expense · Profit per day · click a day to see its bills">
      <div className="mb-3 flex flex-wrap gap-4">
        {TREND_SERIES.map((s) => (
          <LegendItem key={s.key} color={s.color} label={s.name} />
        ))}
      </div>
      {data.length === 0 ? (
        <EmptyChart height={260} />
      ) : (
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              onClick={(state) => state?.activeLabel && linkForDay && navigate(linkForDay(state.activeLabel))}
              style={{ cursor: linkForDay ? "pointer" : undefined }}
            >
              <defs>
                <linearGradient id="gTrendRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLOR_REVENUE} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={COLOR_REVENUE} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS} axisLine={false} tickLine={false} interval={tickInterval(data.length)} dy={6} />
              <YAxis tickFormatter={moneyCompact} tick={AXIS} axisLine={false} tickLine={false} width={52} />
              <Tooltip content={<TooltipCard labelFormatter={shortDate} />} cursor={cursorLine} />
              {TREND_SERIES.map((s) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.name}
                  stroke={s.color}
                  strokeWidth={2}
                  fill={s.key === "revenue" ? "url(#gTrendRevenue)" : "none"}
                  dot={data.length <= 14 ? { r: 3, strokeWidth: 0, fill: s.color } : false}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

export function CategoryBars({ data, linkFor }) {
  const navigate = useNavigate();
  const sorted = [...data].sort((a, b) => b.total - a.total);
  const height = Math.max(260, sorted.length * 40 + 20);
  return (
    <ChartCard title="Revenue by Category" subtitle="Net of GST, this period · click a bar to see its products">
      {sorted.length === 0 ? (
        <EmptyChart height={260} />
      ) : (
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
              <CartesianGrid stroke={GRID} horizontal={false} />
              <XAxis type="number" tickFormatter={moneyCompact} tick={AXIS} axisLine={false} tickLine={false} />
              <YAxis dataKey="category" type="category" tick={AXIS} axisLine={false} tickLine={false} width={96} />
              <Tooltip content={<TooltipCard />} cursor={{ fill: "rgba(14,124,116,0.06)" }} />
              <Bar
                dataKey="total"
                name="Revenue"
                fill={BRAND}
                radius={[0, 4, 4, 0]}
                maxBarSize={20}
                activeBar={{ fill: "#0A5F59" }}
                cursor={linkFor ? "pointer" : undefined}
                onClick={(entry) => linkFor && entry?.categoryId && navigate(linkFor(entry.categoryId))}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

export function CashFlowChart({ data, to }) {
  const navigate = useNavigate();
  return (
    <ChartCard
      title="Today's Cash Flow"
      subtitle="Money in vs out, by payment mode"
      className="lg:col-span-2"
      action={
        to && (
          <Link to={to} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-primary transition hover:bg-primary-soft">
            Day book
            <Icon name="arrowRight" size={14} />
          </Link>
        )
      }
    >
      <div className="mb-3 flex flex-wrap gap-4">
        <LegendItem color={COLOR_PROFIT} label="In" />
        <LegendItem color={COLOR_EXPENSE} label="Out" />
      </div>
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            barGap={4}
            onClick={() => to && navigate(to)}
            style={{ cursor: to ? "pointer" : undefined }}
          >
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="type" tick={AXIS} axisLine={false} tickLine={false} dy={6} />
            <YAxis tickFormatter={moneyCompact} tick={AXIS} axisLine={false} tickLine={false} width={52} />
            <Tooltip content={<TooltipCard />} cursor={{ fill: "rgba(14,124,116,0.05)" }} />
            <Bar dataKey="in" name="In" fill={COLOR_PROFIT} radius={[4, 4, 0, 0]} maxBarSize={36} />
            <Bar dataKey="out" name="Out" fill={COLOR_EXPENSE} radius={[4, 4, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
