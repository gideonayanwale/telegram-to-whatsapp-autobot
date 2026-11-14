import { describe, expect, it } from "vitest";

import {
  classifyReminder,
  getEventEndInstant,
  getEventStartInstant,
  isReplayDue,
  reminderLeadLabel,
  zonedWallClockToUtc,
} from "@/lib/event-time";

describe("zonedWallClockToUtc", () => {
  it("converts Africa/Lagos wall clocks (UTC+1, no DST)", () => {
    const d = zonedWallClockToUtc("2026-11-20", "19:00", "Africa/Lagos");
    expect(d?.toISOString()).toBe("2026-11-20T18:00:00.000Z");
  });

  it("handles US DST: EDT in July vs EST in January", () => {
    const summer = zonedWallClockToUtc("2026-07-04", "12:00", "America/New_York");
    expect(summer?.toISOString()).toBe("2026-07-04T16:00:00.000Z"); // UTC-4
    const winter = zonedWallClockToUtc("2026-01-15", "12:00", "America/New_York");
    expect(winter?.toISOString()).toBe("2026-01-15T17:00:00.000Z"); // UTC-5
  });

  it("parses seconds and defaults to midnight when time is missing", () => {
    const withSeconds = zonedWallClockToUtc("2026-11-20", "19:30:15", "Africa/Lagos");
    expect(withSeconds?.toISOString()).toBe("2026-11-20T18:30:15.000Z");
    const midnight = zonedWallClockToUtc("2026-11-20", null, "Africa/Lagos");
    expect(midnight?.toISOString()).toBe("2026-11-19T23:00:00.000Z");
  });

  it("returns null for missing/invalid dates and invalid times", () => {
    expect(zonedWallClockToUtc(null, "19:00", "Africa/Lagos")).toBeNull();
    expect(zonedWallClockToUtc("not-a-date", "19:00", "Africa/Lagos")).toBeNull();
    expect(zonedWallClockToUtc("2026-11-20", "25:99:99", "Africa/Lagos")).toBeNull();
  });

  it("falls back to the default timezone for invalid timezones", () => {
    const d = zonedWallClockToUtc("2026-11-20", "12:00", "Not/AZone");
    // Default Africa/Lagos = UTC+1
    expect(d?.toISOString()).toBe("2026-11-20T11:00:00.000Z");
  });
});

describe("getEventStartInstant / getEventEndInstant", () => {
  it("computes multi-day end as the last day + duration", () => {
    const end = getEventEndInstant({
      conferenceDate: "2026-11-20",
      endDate: "2026-11-22",
      conferenceTime: "19:00",
      timezone: "Africa/Lagos",
    });
    // last day 22nd 19:00 WAT = 18:00 UTC, + 3h default duration
    expect(end?.toISOString()).toBe("2026-11-22T21:00:00.000Z");
  });

  it("single-day events end start + duration", () => {
    const end = getEventEndInstant({
      conferenceDate: "2026-11-20",
      conferenceTime: "19:00",
      timezone: "Africa/Lagos",
    });
    expect(end?.toISOString()).toBe("2026-11-20T21:00:00.000Z");
  });

  it("guards against end dates before start dates", () => {
    const end = getEventEndInstant({
      conferenceDate: "2026-11-20",
      endDate: "2026-11-18",
      conferenceTime: "19:00",
      timezone: "Africa/Lagos",
    });
    const start = getEventStartInstant({
      conferenceDate: "2026-11-20",
      conferenceTime: "19:00",
      timezone: "Africa/Lagos",
    });
    expect(end!.getTime()).toBe(start!.getTime() + 3 * 60 * 60 * 1000);
  });
});

describe("classifyReminder", () => {
  const now = new Date("2026-11-14T08:00:00.000Z");
  const at = (iso: string) => ({
    conferenceDate: iso.slice(0, 10),
    conferenceTime: iso.slice(11, 16),
    timezone: "UTC",
  });

  it("classifies ~3-day lead as the 7-day reminder", () => {
    expect(classifyReminder(at("2026-11-17T18:00"), now)).toBe("reminder_7d");
  });

  it("classifies <=26h lead as the 24-hour reminder", () => {
    expect(classifyReminder(at("2026-11-15T08:00"), now)).toBe("reminder_24h");
  });

  it("returns none for started events, far-future events and bad data", () => {
    expect(classifyReminder(at("2026-11-14T07:00"), now)).toBe("none");
    expect(classifyReminder(at("2026-11-25T18:00"), now)).toBe("none");
    expect(classifyReminder({ conferenceDate: null }, now)).toBe("none");
  });

  it("uses the event's local wall clock — 24h reminders respect timezone", () => {
    // 7pm Lagos on Nov 15 = 18:00 UTC. From Nov 14 08:00 UTC that is a 34h
    // lead → NOT the 24h reminder yet.
    const lead = classifyReminder(
      { conferenceDate: "2026-11-15", conferenceTime: "19:00", timezone: "Africa/Lagos" },
      now
    );
    expect(lead).toBe("reminder_7d");

    // 26 hours later it becomes the 24h reminder.
    const later = new Date("2026-11-15T10:00:00.000Z");
    expect(
      classifyReminder(
        { conferenceDate: "2026-11-15", conferenceTime: "19:00", timezone: "Africa/Lagos" },
        later
      )
    ).toBe("reminder_24h");
  });

  it("reminderLeadLabel matches the classification", () => {
    expect(reminderLeadLabel(at("2026-11-15T08:00"), now)).toBe("tomorrow");
    expect(reminderLeadLabel(at("2026-11-17T18:00"), now)).toBe("in 3 days");
  });
});

describe("isReplayDue", () => {
  const multiDay = {
    conferenceDate: "2026-11-13",
    endDate: "2026-11-15",
    conferenceTime: "19:00",
    timezone: "Africa/Lagos",
    enableReplay: true,
  };

  it("is NOT due while a multi-day event is still running", () => {
    // Mid-event on Nov 14 (event runs 13th–15th)
    expect(isReplayDue(multiDay, new Date("2026-11-14T12:00:00.000Z"))).toBe(false);
  });

  it("is due the morning after the final day ends", () => {
    // Event ends Nov 15 21:00 UTC; due from 22:00 UTC on the 15th.
    expect(isReplayDue(multiDay, new Date("2026-11-15T21:30:00.000Z"))).toBe(false);
    expect(isReplayDue(multiDay, new Date("2026-11-15T22:30:00.000Z"))).toBe(true);
    expect(isReplayDue(multiDay, new Date("2026-11-16T09:00:00.000Z"))).toBe(true);
  });

  it("is not due beyond the replay max age (missed-run protection stays bounded)", () => {
    expect(isReplayDue(multiDay, new Date("2026-11-30T09:00:00.000Z"))).toBe(false);
  });

  it("respects enable_replay=false", () => {
    expect(
      isReplayDue({ ...multiDay, enableReplay: false }, new Date("2026-11-16T09:00:00.000Z"))
    ).toBe(false);
  });
});
