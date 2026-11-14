import { describe, expect, it } from "vitest";

import { buildGrowthSeries } from "@/lib/analytics-data";

const NOW = new Date("2026-11-14T12:00:00.000Z"); // Nov 2026

describe("buildGrowthSeries", () => {
  it("buckets new subscribers and conferences per calendar month", () => {
    const subscribers = [
      { subscribed_at: "2026-06-10T10:00:00.000Z" }, // Jun
      { subscribed_at: "2026-10-01T10:00:00.000Z" }, // Oct
      { subscribed_at: "2026-10-20T10:00:00.000Z" }, // Oct
      { subscribed_at: "2026-11-02T10:00:00.000Z" }, // Nov (current)
      { subscribed_at: "2026-11-14T10:00:00.000Z" }, // Nov
    ];
    const conferences = [{ created_at: "2026-11-05T10:00:00.000Z" }];

    const series = buildGrowthSeries(subscribers, conferences, NOW);

    expect(series.monthly).toHaveLength(7);
    expect(series.monthly.map((p: any) => p.label)).toEqual(["May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov"]);
    const oct = series.monthly.find((p: any) => p.label === "Oct")!;
    const nov = series.monthly.find((p: any) => p.label === "Nov")!;
    expect(oct.subscribers).toBe(2);
    expect(nov.subscribers).toBe(2);
    expect(nov.conferences).toBe(1);
  });

  it("buckets the weekly series by day", () => {
    const subscribers = [
      { subscribed_at: "2026-11-14T10:00:00.000Z" }, // today (Sat)
      { subscribed_at: "2026-11-14T11:00:00.000Z" }, // today
    ];
    const series = buildGrowthSeries(subscribers, [], NOW);
    expect(series.weekly).toHaveLength(7);
    expect(series.weekly[6].label).toBe("Sat");
    expect(series.weekly[6].subscribers).toBe(2);
  });

  it("computes honest month-over-month growth", () => {
    // Oct: 4, Nov: 6 → +50%
    const subscribers = [
      ...Array.from({ length: 4 }, () => ({ subscribed_at: "2026-10-05T10:00:00.000Z" })),
      ...Array.from({ length: 6 }, () => ({ subscribed_at: "2026-11-05T10:00:00.000Z" })),
    ];
    const series = buildGrowthSeries(subscribers, [], NOW);
    expect(series.monthlyGrowthPct).toBe(50);
  });

  it("reports null growth instead of fake percentages when history is missing", () => {
    // Previous month has zero signups — never claim +100% or +28%.
    const fromZero = buildGrowthSeries([{ subscribed_at: "2026-11-05T10:00:00.000Z" }], [], NOW);
    expect(fromZero.monthlyGrowthPct).toBeNull();

    const empty = buildGrowthSeries([], [], NOW);
    expect(empty.monthlyGrowthPct).toBeNull();
    expect(empty.monthly.every((p: any) => p.subscribers === 0 && p.conferences === 0)).toBe(true);
  });

  it("ignores null and unparseable timestamps", () => {
    const series = buildGrowthSeries(
      [{ subscribed_at: null }, { subscribed_at: "garbage" }, { subscribed_at: "2026-11-05T10:00:00.000Z" }],
      [{ created_at: undefined }],
      NOW
    );
    const nov = series.monthly[6];
    expect(nov.subscribers).toBe(1);
    expect(nov.conferences).toBe(0);
  });
});
