import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeSupabase } from "./helpers/fake-supabase";

const h = vi.hoisted(() => ({
  fake: null as any,
  currentUser: null as any,
  cookieValues: {} as Record<string, string>,
  env: {
    SUPER_ADMIN_EMAILS: "root@bentplanet.test",
    UNSUBSCRIBE_SECRET: "test-secret",
    CRON_SECRET: "",
    NEXT_PUBLIC_APP_URL: "https://app.test",
  } as Record<string, string>,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => h.fake,
}));
vi.mock("@/lib/current-user", () => ({
  getCurrentUser: async () => h.currentUser,
}));
vi.mock("@/lib/env", () => ({
  getServerEnv: () => h.env,
}));
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (h.cookieValues[name] ? { name, value: h.cookieValues[name] } : undefined),
  }),
}));

import { GET, PATCH } from "@/app/api/notifications/route";

const CHURCH_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHURCH_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOTIF_A1 = "11111111-1111-4111-8111-111111111111";
const NOTIF_A2 = "22222222-2222-4222-8222-222222222222";
const NOTIF_B1 = "33333333-3333-4333-8333-333333333333";
const NOTIF_PLATFORM = "44444444-4444-4444-8444-444444444444";

function seed() {
  h.fake = new FakeSupabase();
  h.fake.seed("churches", [
    { id: CHURCH_A, name: "Church A", admin_email: "admin@a.test", status: "active" },
    { id: CHURCH_B, name: "Church B", admin_email: "admin@b.test", status: "active" },
  ]);
  h.fake.seed("notifications", [
    { id: NOTIF_A1, church_id: CHURCH_A, read: false, title: "A one", created_at: "2026-11-01T10:00:00.000Z" },
    { id: NOTIF_A2, church_id: CHURCH_A, read: false, title: "A two", created_at: "2026-11-02T10:00:00.000Z" },
    { id: NOTIF_B1, church_id: CHURCH_B, read: false, title: "B one", created_at: "2026-11-03T10:00:00.000Z" },
    { id: NOTIF_PLATFORM, church_id: null, read: false, title: "Platform", created_at: "2026-11-04T10:00:00.000Z" },
  ]);
}

beforeEach(() => {
  seed();
  h.currentUser = null;
  h.cookieValues = {};
});

function churchUser(email: string) {
  return { id: "user-1", email };
}

function patchRequest(ids: unknown[]) {
  return new Request("http://localhost/api/notifications", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  });
}

describe("GET /api/notifications", () => {
  it("returns 401 JSON when unauthenticated (regression: no redirect swallow)", async () => {
    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("scopes church admins to their own church's notifications (two-church isolation)", async () => {
    h.currentUser = churchUser("admin@a.test");
    const res = await GET();
    expect(res.status).toBe(200);
    const { notifications } = await res.json();
    expect(notifications).toHaveLength(2);
    expect(notifications.every((n: any) => n.church_id === CHURCH_A)).toBe(true);
  });

  it("scopes super admins to platform-level notifications", async () => {
    h.currentUser = churchUser("root@bentplanet.test");
    const res = await GET();
    expect(res.status).toBe(200);
    const { notifications } = await res.json();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].id).toBe(NOTIF_PLATFORM);
  });
});

describe("PATCH /api/notifications", () => {
  it("rejects unauthenticated mark-as-read (regression: this used to be world-writable)", async () => {
    const res = await PATCH(patchRequest([NOTIF_A1]));
    expect(res.status).toBe(401);
    // Nothing changed.
    expect(h.fake.rows("notifications").find((n: any) => n.id === NOTIF_A1)!.read).toBe(false);
  });

  it("lets a church admin mark their own notifications read", async () => {
    h.currentUser = churchUser("admin@a.test");
    const res = await PATCH(patchRequest([NOTIF_A1, NOTIF_A2]));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updated).toBe(2);
    expect(h.fake.rows("notifications").find((n: any) => n.id === NOTIF_A1)!.read).toBe(true);
    expect(h.fake.rows("notifications").find((n: any) => n.id === NOTIF_A2)!.read).toBe(true);
  });

  it("CANNOT mark another church's notifications (two-church isolation)", async () => {
    h.currentUser = churchUser("admin@a.test");
    const res = await PATCH(patchRequest([NOTIF_B1]));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updated).toBe(0);
    // Church B's row untouched.
    expect(h.fake.rows("notifications").find((n: any) => n.id === NOTIF_B1)!.read).toBe(false);
  });

  it("mixed id lists only update rows the caller owns", async () => {
    h.currentUser = churchUser("admin@a.test");
    const res = await PATCH(patchRequest([NOTIF_A1, NOTIF_B1, NOTIF_PLATFORM]));
    const body = await res.json();
    expect(body.updated).toBe(1);
    expect(h.fake.rows("notifications").find((n: any) => n.id === NOTIF_A1)!.read).toBe(true);
    expect(h.fake.rows("notifications").find((n: any) => n.id === NOTIF_B1)!.read).toBe(false);
    expect(h.fake.rows("notifications").find((n: any) => n.id === NOTIF_PLATFORM)!.read).toBe(false);
  });

  it("super admins only touch platform rows, impersonating admins act as their church", async () => {
    h.currentUser = churchUser("root@bentplanet.test");
    let res = await PATCH(patchRequest([NOTIF_PLATFORM, NOTIF_A1]));
    let body = await res.json();
    expect(body.updated).toBe(1);
    expect(h.fake.rows("notifications").find((n: any) => n.id === NOTIF_PLATFORM)!.read).toBe(true);
    expect(h.fake.rows("notifications").find((n: any) => n.id === NOTIF_A1)!.read).toBe(false);

    // Now impersonating church B: scoped to church B only.
    h.cookieValues.impersonate_church_email = "admin@b.test";
    res = await PATCH(patchRequest([NOTIF_B1, NOTIF_A1]));
    body = await res.json();
    expect(body.updated).toBe(1);
    expect(h.fake.rows("notifications").find((n: any) => n.id === NOTIF_B1)!.read).toBe(true);
    expect(h.fake.rows("notifications").find((n: any) => n.id === NOTIF_A1)!.read).toBe(false);
  });

  it("validates the payload shape and id formats", async () => {
    h.currentUser = churchUser("admin@a.test");
    expect((await PATCH(patchRequest([]))).status).toBe(400);
    expect((await PATCH(patchRequest(["not-a-uuid"]))).status).toBe(400);
    expect((await PATCH(patchRequest([123, null]))).status).toBe(400);
    expect((await PATCH(patchRequest(Array.from({ length: 101 }, () => NOTIF_A1)))).status).toBe(400);
    const badBody = new Request("http://localhost/api/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: "nope" }),
    });
    expect((await PATCH(badBody)).status).toBe(400);
  });
});
