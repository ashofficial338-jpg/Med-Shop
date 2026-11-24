import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { ChartCard, EmptyChart, LegendItem, TooltipCard } from "../dashboard/DashboardCharts";
import { moneyCompact } from "../dashboard/format";
import { COLORS, axisLabel } from "./ReportCharts";

// Sales are always blue and purchases always orange, whatever else is shown.
const SERIES = { sales: COLORS.revenue, purchases: COLORS.costs };
const colorOf = (key) => SERIES[key] || COLORS.brand;
const GRID = "#edf0f3";
const AXIS = { fontSize: 11, fill: "#7b8793" };
const short = (s) => (String(s).length > 18 ? `${String(s).slice(0, 17)}…` : s);

// The chart of a management report, as the report describes it:
//   { type: "bar" | "line" | "rank", x, series: [{ key, label }], rows? }
export default function ReportChart({ title, chart, rows: tableRows }) {
  const rows = chart.rows || tableRows;
  const empty = !rows.length || rows.every((r) => chart.series.every((s) => !r[s.key]));
  const legend = chart.series.length > 1;

  const body = () => {
    if (chart.type === "rank") {
      return (
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" tickFormatter={moneyCompact} tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis dataKey={chart.x} type="category" tickFormatter={short} tick={AXIS} axisLine={false} tickLine={false} width={128} interval={0} />
          <Tooltip content={<TooltipCard />} cursor={{ fill: "rgba(11,74,143,0.06)" }} />
          {chart.series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={colorOf(s.key)} radius={[0, 4, 4, 0]} maxBarSize={18} />
          ))}
        </BarChart>
      );
    }
    const axes = [
      <CartesianGrid key="g" stroke={GRID} vertical={false} />,
      <XAxis key="x" dataKey={chart.x} tickFormatter={axisLabel} tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={14} dy={6} />,
      <YAxis key="y" tickFormatter={moneyCompact} tick={AXIS} axisLine={false} tickLine={false} width={56} />,
    ];
    if (chart.type === "line") {
      return (
        <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          {axes}
          <Tooltip content={<TooltipCard />} cursor={{ stroke: "#c9d1d8", strokeDasharray: "3 3" }} />
          {chart.series.map((s) => (
            <Line key={s.key} dataKey={s.key} name={s.label} stroke={colorOf(s.key)} strokeWidth={2} dot={rows.length <= 31 ? { r: 4, strokeWidth: 2, stroke: "#fff", fill: colorOf(s.key) } : false} activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }} />
          ))}
        </LineChart>
      );
    }
    return (
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
        {axes}
        <Tooltip content={<TooltipCard />} cursor={{ fill: "rgba(11,74,143,0.05)" }} />
        {chart.series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={colorOf(s.key)} radius={[4, 4, 0, 0]} maxBarSize={28} />
        ))}
      </BarChart>
    );
  };

  return (
    <ChartCard title={title}>
      {legend && !empty && (
        <div className="mb-3 flex flex-wrap gap-4">
          {chart.series.map((s) => (
            <LegendItem key={s.key} color={colorOf(s.key)} label={s.label} />
          ))}
        </div>
      )}
      {empty ? (
        <EmptyChart height={220} />
      ) : (
        <div style={{ height: chart.type === "rank" ? Math.max(160, rows.length * 34 + 30) : 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            {body()}
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}
