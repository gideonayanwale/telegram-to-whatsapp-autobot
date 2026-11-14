"use client";

import { useMemo, useState } from "react";
import { CalendarIcon, UsersIcon } from "lucide-react";

import { buildGrowthSeries, type GrowthPoint } from "@/lib/analytics-data";

interface AnalyticsChartProps {
  subscribers: { subscribed_at: string | null }[];
  conferences: { created_at: string | null }[];
}

/**
 * Church dashboard growth chart. Renders real per-period counts of NEW
 * subscribers and conferences — no mock data — with an honest growth badge
 * (only shown when there is enough history to compute one).
 */
export function AnalyticsChart({ subscribers, conferences }: AnalyticsChartProps) {
  const [timeframe, setTimeframe] = useState<"monthly" | "weekly">("monthly");
  const [activeMetric, setActiveMetric] = useState<"subscribers" | "conferences">("subscribers");

  const series = useMemo(
    () => buildGrowthSeries(subscribers, conferences),
    [subscribers, conferences]
  );

  const data: GrowthPoint[] = timeframe === "monthly" ? series.monthly : series.weekly;
  const maxValue = Math.max(...data.map((d) => d[activeMetric]), 5);

  const points = data
    .map((d, index) => {
      const x = (index / (data.length - 1)) * 100;
      const y = 100 - (d[activeMetric] / maxValue) * 80;
      return `${x},${y}`;
    })
    .join(" ");

  const areaPoints = `0,100 ${points} 100,100`;
  const periodTotal = data.reduce((sum, d) => sum + d[activeMetric], 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-heading text-lg font-bold text-slate-900">Audience Growth</h3>
            {series.monthlyGrowthPct !== null ? (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                  series.monthlyGrowthPct >= 0
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200/60"
                    : "bg-rose-50 text-rose-700 border-rose-200/60"
                }`}
              >
                {series.monthlyGrowthPct >= 0 ? "+" : ""}
                {series.monthlyGrowthPct}% new subscribers this month
              </span>
            ) : null}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            New subscribers and conferences per {timeframe === "monthly" ? "month" : "day"} — live from
            your workspace. {periodTotal} {activeMetric} in the current view.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-slate-100 rounded-lg p-1 text-xs font-medium">
            <button
              onClick={() => setActiveMetric("subscribers")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
                activeMetric === "subscribers"
                  ? "bg-white text-indigo-600 shadow-xs font-semibold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <UsersIcon className="h-3.5 w-3.5" />
              Subscribers
            </button>
            <button
              onClick={() => setActiveMetric("conferences")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
                activeMetric === "conferences"
                  ? "bg-white text-indigo-600 shadow-xs font-semibold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <CalendarIcon className="h-3.5 w-3.5" />
              Conferences
            </button>
          </div>

          <div className="flex bg-slate-100 rounded-lg p-1 text-xs font-medium">
            <button
              onClick={() => setTimeframe("monthly")}
              className={`px-2.5 py-1.5 rounded-md transition-all ${
                timeframe === "monthly"
                  ? "bg-white text-slate-900 shadow-xs font-semibold"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setTimeframe("weekly")}
              className={`px-2.5 py-1.5 rounded-md transition-all ${
                timeframe === "weekly"
                  ? "bg-white text-slate-900 shadow-xs font-semibold"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              Weekly
            </button>
          </div>
        </div>
      </div>

      {/* SVG Chart */}
      <div className="relative pt-4">
        <div className="h-48 w-full">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible">
            <defs>
              <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.0" />
              </linearGradient>
            </defs>
            <polyline points={areaPoints} fill="url(#chartGradient)" stroke="none" />
            <polyline
              points={points}
              fill="none"
              stroke="#4f46e5"
              strokeWidth="0.6"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
        </div>

        {/* X-axis labels */}
        <div className="flex justify-between mt-2 text-[10px] text-slate-400 font-medium">
          {data.map((d, i) => (
            <span key={`${d.label}-${i}`}>{d.label}</span>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-slate-500">
        <div className="flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-full bg-indigo-500" />
          New {activeMetric === "subscribers" ? "subscribers" : "conferences"}
        </div>
        <div className="text-slate-400">
          {data.map((d) => d[activeMetric]).join(" · ")}
        </div>
      </div>
    </div>
  );
}
