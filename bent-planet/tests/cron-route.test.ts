import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeSupabase } from "./helpers/fake-supabase";

const h = vi.hoisted(() => ({
  fake: null as any,
  env: {
    CRON_SECRET: "cron-secret-value",
    UNSUBSCRIBE_SECRET: "test-secret",
    SUPABASE_SERVICE_ROLE_KEY: "",
    NEXT_PUBLIC_APP_URL: "https://app.test",
    SUPER_ADMIN_EMAILS: "",
  } as Record<string, string>,
  reminders: [] as any[],
  replays: [] as any[],
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => h.fake,
}));
vi.mock("@/lib/env", () => ({
  getServerEnv: () => h.env,
}));
vi.mock("@/lib/email", () => ({
  sendConferenceReminderEmail: vi.fn(async (input: any) => {
    h.reminders.push(input);
    return `reminder-${h.reminders.length}`;
  }),
  sendReplayEmail: vi.fn(async (input: any) => {
    h.replays.push(input);
    return `replay-${h.replays.length}`;
  }),
}));

import { GET } from "@/app/api/cron/email-sequences/route";

const CHURCH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// Fixed "now": the daily cron run at 08:00 UTC on 2026-11-14.
const NOW = new Date("2026-11-14T08:00:00.000Z");

function cronRequest(auth?: string) {
  const headers: Record<string, string> = {};
  if (auth) headers.authorization = auth;
  return new Request("http://localhost/api/cron/email-sequences", { headers });
}

function seedBase() {
  h.fake = new FakeSupabase();
  h.fake.seed("churches", [
    { id: CHURCH, name: "Grace Chapel", logo_url: null, timezone: "Africa/Lagos", admin_email: "admin@a.test" },
  ]);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  seedBase();
  h.env.CRON_SECRET = "cron-secret-value";
  h.reminders.length = 0;
  h.replays.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/cron/email-sequences — authentication (fail closed)", () => {
  it("refuses to run when CRON_SECRET is not configured (regression: used to run open)", async () => {
    h.env.CRON_SECRET = "";
    const res = await GET(cronRequest("Bearer anything"));
    expect(res.status).toBe(500);
    expect(h.reminders).toHaveLength(0);
    expect(h.replays).toHaveLength(0);
  });

  it("rejects requests without or with a wrong secret", async () => {
    expect((await GET(cronRequest())).status).toBe(401);
    expect((await GET(cronRequest("Bearer wrong"))).status).toBe(401);
    expect((await GET(cronRequest("Basic dXNlcg=="))).status).toBe(401);
    expect(h.reminders).toHaveLength(0);
    expect(h.replays).toHaveLength(0);
  });

  it("runs with the correct bearer secret", async () => {
    const res = await GET(cronRequest("Bearer cron-secret-value"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});

describe("GET /api/cron/email-sequences — reminders (timezone aware)", () => {
  function seedReminderConference(overrides: Record<string, unknown> = {}) {
    h.fake.seed("conferences", [
      {
        id: "conf-1",
        church_id: CHURCH,
        title: "Revival Night",
        // 3 days out at 19:00 Lagos (18:00 UTC) → ~3.4 day lead → 7-day reminder.
        conference_date: "2026-11-17",
        conference_time: "19:00",
        end_date: null,
        timezone: "Africa/Lagos",
        stream_url: "https://stream.test/live",
        status: "published",
        churches: { name: "Grace Chapel", logo_url: null, timezone: "Africa/Lagos" },
        ...overrides,
      },
    ]);
  }

  it("sends a 7-day reminder with honest lead-time copy and flips the flag", async () => {
    seedReminderConference();
    h.fake.seed("subscribers", [
      {
        id: "11111111-1111-4111-8111-111111111111",
        church_id: CHURCH,
        conference_id: "conf-1",
        full_name: "Jane",
        email: "jane@example.com",
        unsubscribed: false,
        reminder_7d_sent: false,
        reminder_24h_sent: false,
        replay_email_sent: false,
      },
    ]);

    const res = await GET(cronRequest("Bearer cron-secret-value"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reminders7d).toBe(1);
    expect(body.reminders24h).toBe(0);

    expect(h.reminders).toHaveLength(1);
    expect(h.reminders[0].leadLabel).toBe("in 3 days");
    expect(h.reminders[0].unsubscribeUrl).toContain("/unsubscribe?token=");
    expect(h.fake.rows("subscribers")[0].reminder_7d_sent).toBe(true);
  });

  it("uses the 24-hour reminder inside 26h of the start, in event-local time", async () => {
    seedReminderConference({
      // 19:00 Lagos today = 18:00 UTC, 10h after NOW → 24h bucket.
      conference_date: "2026-11-14",
    });
    h.fake.seed("subscribers", [
      {
        id: "11111111-1111-4111-8111-111111111111",
        church_id: CHURCH,
        conference_id: "conf-1",
        full_name: "Jane",
        email: "jane@example.com",
        unsubscribed: false,
        reminder_7d_sent: false,
        reminder_24h_sent: false,
        replay_email_sent: false,
      },
    ]);

    await GET(cronRequest("Bearer cron-secret-value"));
    expect(h.reminders).toHaveLength(1);
    expect(h.reminders[0].leadLabel).toBe("tomorrow");
    expect(h.fake.rows("subscribers")[0].reminder_24h_sent).toBe(true);
  });

  it("does not re-send reminders already flagged as sent", async () => {
    seedReminderConference({ conference_date: "2026-11-14" });
    h.fake.seed("subscribers", [
      {
        id: "11111111-1111-4111-8111-111111111111",
        church_id: CHURCH,
        conference_id: "conf-1",
        full_name: "Jane",
        email: "jane@example.com",
        unsubscribed: false,
        reminder_7d_sent: true,
        reminder_24h_sent: true,
        replay_email_sent: false,
      },
    ]);

    const res = await GET(cronRequest("Bearer cron-secret-value"));
    const body = await res.json();
    expect(body.reminders24h).toBe(0);
    expect(h.reminders).toHaveLength(0);
  });

  it("never emails unsubscribed subscribers", async () => {
    seedReminderConference({ conference_date: "2026-11-14" });
    h.fake.seed("subscribers", [
      {
        id: "11111111-1111-4111-8111-111111111111",
        church_id: CHURCH,
        conference_id: "conf-1",
        full_name: "Gone",
        email: "gone@example.com",
        unsubscribed: true,
        reminder_7d_sent: false,
        reminder_24h_sent: false,
        replay_email_sent: false,
      },
    ]);

    const res = await GET(cronRequest("Bearer cron-secret-value"));
    const body = await res.json();
    expect(h.reminders).toHaveLength(0);
    expect(body.skippedUnsubscribed).toBe(1);
  });
});

describe("GET /api/cron/email-sequences — replay emails (multi-day aware)", () => {
  const subscriberRow = (overrides: Record<string, unknown> = {}) => ({
    id: "22222222-2222-4222-8222-222222222222",
    church_id: CHURCH,
    conference_id: "conf-r",
    full_name: "Jane",
    email: "jane@example.com",
    unsubscribed: false,
    reminder_7d_sent: true,
    reminder_24h_sent: true,
    replay_email_sent: false,
    ...overrides,
  });

  function seedConference(overrides: Record<string, unknown> = {}) {
    h.fake.seed("conferences", [
      {
        id: "conf-r",
        church_id: CHURCH,
        title: "Healing Conference",
        conference_date: "2026-11-13",
        conference_time: "19:00",
        end_date: null,
        timezone: "Africa/Lagos",
        stream_url: "https://stream.test/replay",
        free_resource_url: "https://files.test/notes.pdf",
        free_resource_name: "Sermon Notes",
        enable_replay: true,
        status: "published",
        churches: { name: "Grace Chapel", logo_url: null, timezone: "Africa/Lagos" },
        ...overrides,
      },
    ]);
  }

  it("does not send replay emails while a multi-day event is still running", async () => {
    // Runs 13th–15th; now is the 14th → mid-event.
    seedConference({
      conference_date: "2026-11-13",
      end_date: "2026-11-15",
    });
    h.fake.seed("subscribers", [subscriberRow()]);

    const res = await GET(cronRequest("Bearer cron-secret-value"));
    const body = await res.json();
    expect(body.replayEmails).toBe(0);
    expect(h.replays).toHaveLength(0);
    expect(h.fake.rows("subscribers")[0].replay_email_sent).toBe(false);
  });

  it("sends replay emails the morning after the event ends, with an unsubscribe link", async () => {
    // Single-day event yesterday (13th) at 19:00 Lagos → ends 21:00 UTC on
    // the 13th; due from 22:00 UTC on the 13th. NOW is 14th 08:00 UTC.
    seedConference();
    h.fake.seed("subscribers", [subscriberRow()]);

    const res = await GET(cronRequest("Bearer cron-secret-value"));
    const body = await res.json();
    expect(body.replayEmails).toBe(1);

    expect(h.replays).toHaveLength(1);
    expect(h.replays[0].conferenceTitle).toBe("Healing Conference"); // no "[REPLAY]" title hack
    expect(h.replays[0].freeResourceName).toBe("Sermon Notes");
    expect(h.replays[0].unsubscribeUrl).toContain("/unsubscribe?token=");
    expect(h.fake.rows("subscribers")[0].replay_email_sent).toBe(true);
  });

  it("does not resurrect replays for very old events (missed-run protection stays bounded)", async () => {
    // Ended more than 14 days ago.
    seedConference({ conference_date: "2026-10-25" });
    h.fake.seed("subscribers", [subscriberRow()]);

    await GET(cronRequest("Bearer cron-secret-value"));
    expect(h.replays).toHaveLength(0);
    expect(h.fake.rows("subscribers")[0].replay_email_sent).toBe(false);
  });

  it("skips events with enable_replay=false and unsubscribed subscribers", async () => {
    seedConference({ enable_replay: false });
    h.fake.seed("subscribers", [subscriberRow()]);
    await GET(cronRequest("Bearer cron-secret-value"));
    expect(h.replays).toHaveLength(0);

    seedBase();
    seedConference();
    h.fake.seed("subscribers", [subscriberRow({ unsubscribed: true })]);
    const res = await GET(cronRequest("Bearer cron-secret-value"));
    const body = await res.json();
    expect(h.replays).toHaveLength(0);
    expect(body.skippedUnsubscribed).toBe(1);
  });
});
