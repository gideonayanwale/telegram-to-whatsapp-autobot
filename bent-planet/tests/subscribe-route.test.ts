import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeSupabase } from "./helpers/fake-supabase";

const h = vi.hoisted(() => ({
  fake: null as any,
  currentUser: null as any,
  sentEmails: [] as any[],
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => h.fake,
}));
vi.mock("@/lib/current-user", () => ({
  getCurrentUser: async () => h.currentUser,
}));
vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({
    UNSUBSCRIBE_SECRET: "test-secret",
    CRON_SECRET: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
    NEXT_PUBLIC_APP_URL: "https://app.test",
    SUPER_ADMIN_EMAILS: "",
  }),
}));
vi.mock("@/lib/email", () => ({
  sendSubscriberWelcomeEmail: vi.fn(async (input: any) => {
    h.sentEmails.push(input);
    return "resend-123";
  }),
}));

import { POST } from "@/app/api/subscribe/route";

const CHURCH_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHURCH_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONF_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CONF_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function seed() {
  h.fake = new FakeSupabase();
  h.fake.seed("churches", [
    { id: CHURCH_A, name: "Church A", slug: "church-a", admin_email: "admin@a.test", logo_url: null },
    { id: CHURCH_B, name: "Church B", slug: "church-b", admin_email: "admin@b.test", logo_url: null },
  ]);
  h.fake.seed("conferences", [
    {
      id: CONF_A,
      church_id: CHURCH_A,
      title: "Conference A",
      conference_date: "2026-12-01",
      conference_time: "18:00",
      status: "published",
    },
    {
      id: CONF_B,
      church_id: CHURCH_B,
      title: "Conference B",
      conference_date: "2026-12-05",
      conference_time: "18:00",
      status: "published",
    },
  ]);
}

beforeEach(() => {
  seed();
  h.currentUser = null;
  h.sentEmails.length = 0;
});

function subscribe(body: Record<string, unknown>, ip = "10.0.0.1") {
  return POST(
    new Request("http://localhost/api/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    })
  );
}

const validBody = {
  churchId: CHURCH_A,
  conferenceId: CONF_A,
  fullName: "Jane Doe",
  email: "jane@example.com",
  phone: "+2348012345678",
};

describe("POST /api/subscribe — validation", () => {
  it("accepts a valid subscription and sends the welcome email with an unsubscribe link", async () => {
    const res = await subscribe(validBody);
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);

    const subs = h.fake.rows("subscribers");
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({
      church_id: CHURCH_A,
      conference_id: CONF_A,
      email: "jane@example.com",
      unsubscribed: false,
    });

    expect(h.sentEmails).toHaveLength(1);
    expect(h.sentEmails[0].unsubscribeUrl).toContain("https://app.test/unsubscribe?token=");

    // Welcome email logged + admin notification created.
    expect(h.fake.rows("email_log")).toHaveLength(1);
    expect(h.fake.rows("email_log")[0].email_type).toBe("welcome");
    expect(h.fake.rows("notifications")).toHaveLength(1);
  });

  it("rejects malformed input before touching the database", async () => {
    const cases = [
      { ...validBody, email: "not-an-email" },
      { ...validBody, email: "" },
      { ...validBody, fullName: "" },
      { ...validBody, fullName: "x".repeat(201) },
      { ...validBody, churchId: "nope" },
      { ...validBody, conferenceId: "nope" },
      { ...validBody, phone: "x".repeat(31) },
    ];
    for (const body of cases) {
      const res = await subscribe(body);
      expect(res.status).toBe(400);
    }
    expect(h.fake.rows("subscribers")).toHaveLength(0);
  });

  it("silently drops honeypot submissions", async () => {
    const res = await subscribe({ ...validBody, website: "http://spam.example" });
    expect(res.status).toBe(200);
    expect(h.fake.rows("subscribers")).toHaveLength(0);
    expect(h.sentEmails).toHaveLength(0);
  });
});

describe("POST /api/subscribe — church/event relationship (two-church isolation)", () => {
  it("rejects a conference that belongs to a different church", async () => {
    const res = await subscribe({ ...validBody, churchId: CHURCH_A, conferenceId: CONF_B });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/does not belong to this church/i);
    // Nothing persisted, no email sent.
    expect(h.fake.rows("subscribers")).toHaveLength(0);
    expect(h.sentEmails).toHaveLength(0);
    expect(h.fake.rows("notifications")).toHaveLength(0);
  });

  it("rejects unknown churches and unknown conferences", async () => {
    const unknownChurch = await subscribe({ ...validBody, churchId: "99999999-9999-4999-8999-999999999999" });
    expect(unknownChurch.status).toBe(404);

    const unknownConf = await subscribe({
      ...validBody,
      conferenceId: "99999999-9999-4999-8999-999999999999",
    });
    expect(unknownConf.status).toBe(400);

    expect(h.fake.rows("subscribers")).toHaveLength(0);
  });

  it("allows conference-less subscriptions to a real church", async () => {
    const res = await subscribe({ ...validBody, conferenceId: null });
    expect(res.status).toBe(200);
    expect(h.fake.rows("subscribers")[0].conference_id).toBeNull();
    // General subscriber: notification but no welcome email.
    expect(h.sentEmails).toHaveLength(0);
    expect(h.fake.rows("notifications")).toHaveLength(1);
  });
});

describe("POST /api/subscribe — unsubscribed handling", () => {
  it("re-activates a previously unsubscribed subscriber who signs up again", async () => {
    h.fake.seed("subscribers", [
      {
        id: "sub-1",
        church_id: CHURCH_A,
        conference_id: null,
        full_name: "Old Name",
        email: "jane@example.com",
        unsubscribed: true,
        subscribed_at: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const res = await subscribe({ ...validBody, conferenceId: null });
    expect(res.status).toBe(200);

    const subs = h.fake.rows("subscribers");
    expect(subs).toHaveLength(1); // upserted, not duplicated
    expect(subs[0].unsubscribed).toBe(false);
    expect(subs[0].full_name).toBe("Jane Doe");
  });

  it("keeps subscribers separate across churches (same email, two churches)", async () => {
    await subscribe({ ...validBody, conferenceId: null });
    await subscribe({ ...validBody, churchId: CHURCH_B, conferenceId: null, email: "jane@example.com" });

    const subs = h.fake.rows("subscribers");
    expect(subs).toHaveLength(2);
    expect(subs.map((s: any) => s.church_id).sort()).toEqual([CHURCH_A, CHURCH_B].sort());
  });
});

describe("POST /api/subscribe — abuse protection", () => {
  it("rate limits anonymous submissions per email", async () => {
    let last: Response | null = null;
    for (let i = 0; i < 5; i++) {
      last = await subscribe({ ...validBody, conferenceId: null }, `10.0.0.${i}`);
      expect(last.status).toBe(200);
    }
    const blocked = await subscribe({ ...validBody, conferenceId: null }, "10.0.0.9");
    expect(blocked.status).toBe(429);
  });

  it("rate limits anonymous submissions per IP", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await subscribe(
        { ...validBody, conferenceId: null, email: `person${i}@example.com` },
        "203.0.113.5"
      );
      expect(res.status).toBe(200);
    }
    const blocked = await subscribe(
      { ...validBody, conferenceId: null, email: "overflow@example.com" },
      "203.0.113.5"
    );
    expect(blocked.status).toBe(429);
  });

  it("exempts authenticated dashboard users (church admins adding subscribers)", async () => {
    h.currentUser = { id: "admin-user", email: "admin@a.test" };
    for (let i = 0; i < 8; i++) {
      const res = await subscribe({ ...validBody, conferenceId: null, email: `member${i}@example.com` });
      expect(res.status).toBe(200);
    }
  });
});
