/**
 * Growth analytics aggregation — pure functions over subscriber/conference
 * timestamps so the dashboard can chart real numbers instead of mock data.
 */

export type GrowthPoint = {
  label: string;
  subscribers: number;
  conferences: number;
};

export type GrowthSeries = {
  monthly: GrowthPoint[];
  weekly: GrowthPoint[];
  /**
   * Percent change of new subscribers this month vs. previous month.
   * null when there is not enough data to compute an honest figure.
   */
  monthlyGrowthPct: number | null;
};

type DatedInput = { subscribed_at?: string | null; created_at?: string | null };

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toValidDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function countByKey(dates: (Date | null)[], keyOf: (d: Date) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const d of dates) {
    if (!d) continue;
    const key = keyOf(d);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Build monthly (last 7 calendar months) and weekly (last 7 days) series of
 * NEW subscribers and conferences, plus an honest month-over-month growth
 * percentage for new subscribers (null when the previous month has no data).
 */
export function buildGrowthSeries(
  subscribers: DatedInput[],
  conferences: DatedInput[],
  now: Date = new Date()
): GrowthSeries {
  const subDates = subscribers.map((s) => toValidDate(s.subscribed_at));
  const confDates = conferences.map((c) => toValidDate(c.created_at));

  const subByMonth = countByKey(subDates, monthKey);
  const confByMonth = countByKey(confDates, monthKey);
  const subByDay = countByKey(subDates, dayKey);
  const confByDay = countByKey(confDates, dayKey);

  // Monthly: last 7 calendar months including the current one.
  const monthly: GrowthPoint[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKey(d);
    monthly.push({
      label: MONTH_LABELS[d.getMonth()],
      subscribers: subByMonth.get(key) ?? 0,
      conferences: confByMonth.get(key) ?? 0,
    });
  }

  // Weekly: last 7 days including today.
  const weekly: GrowthPoint[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = dayKey(d);
    weekly.push({
      label: DAY_LABELS[d.getDay()],
      subscribers: subByDay.get(key) ?? 0,
      conferences: confByDay.get(key) ?? 0,
    });
  }

  const currentMonth = monthly[monthly.length - 1]?.subscribers ?? 0;
  const previousMonth = monthly[monthly.length - 2]?.subscribers ?? 0;
  const monthlyGrowthPct =
    previousMonth > 0
      ? Math.round(((currentMonth - previousMonth) / previousMonth) * 100)
      : currentMonth > 0
        ? null // grew from zero — an honest "new this month" is better than ∞%
        : null;

  return { monthly, weekly, monthlyGrowthPct };
}
