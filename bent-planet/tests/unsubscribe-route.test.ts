import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeSupabase } from "./helpers/fake-supabase";

const h = vi.hoisted(() => ({
  fake: null as any,
  env: {
    UNSUBSCRIBE_SECRET: "test-secret",
    CRON_SECRET: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
    NEXT_PUBLIC_APP_URL: "https://app.test",
    SUPER_ADMIN_EMAILS: "",
  } as Record<string, string>,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => h.fake,
}));
vi.mock("@/lib/env", () => ({
  getServerEnv: () => h.env,
}));

import { GET, POST } from "@/app/api/unsubscribe/route";
import { buildUnsubscribeToken } from "@/lib/unsubscribe-token";

const SUB_ID = "11111111-2222-4333-8444-555555555555";
const CHURCH_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHURCH_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(() => {
  h.fake = new FakeSupabase();
  h.fake.seed("subscribers", [
    {
      id: SUB_ID,
      church_id: CHURCH_A,
      full_name: "Jane Doe",
      email: "jane@example.com",
      unsubscribed: false,
    },
    {
      id: "22222222-2222-4333-8444-555555555555",
      church_id: CHURCH_B,
      full_name: "Other Person",
      email: "other@example.com",
      unsubscribed: false,
    },
  ]);
});

describe("unsubscribe endpoint", () => {
  it("unsubscribes via a GET link click and records a notification", async () => {
    const token = buildUnsubscribeToken(SUB_ID, CHURCH_A);
    const res = await GET(new Request(`http://localhost/api/unsubscribe?token=${encodeURIComponent(token)}`));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("unsubscribed");

    const row = h.fake.rows("subscribers").find((s: any) => s.id === SUB_ID);
    expect(row.unsubscribed).toBe(true);
    expect(row.unsubscribed_at).toBeTruthy();
    expect(h.fake.rows("notifications")).toHaveLength(1);
    expect(h.fake.rows("notifications")[0].church_id).toBe(CHURCH_A);
  });

  it("is idempotent", async () => {
    const token = buildUnsubscribeToken(SUB_ID, CHURCH_A);
    await GET(new Request(`http://localhost/api/unsubscribe?token=${encodeURIComponent(token)}`));
    const res = await GET(new Request(`http://localhost/api/unsubscribe?token=${encodeURIComponent(token)}`));
    expect((await res.json()).status).toBe("already_unsubscribed");
  });

  it("supports RFC 8058 one-click POST", async () => {
    const token = buildUnsubscribeToken(SUB_ID, CHURCH_A);
    const res = await POST(
      new Request(`http://localhost/api/unsubscribe?token=${encodeURIComponent(token)}`, { method: "POST" })
    );
    expect(res.status).toBe(200);
    expect(h.fake.rows("subscribers").find((s: any) => s.id === SUB_ID).unsubscribed).toBe(true);
  });

  it("rejects forged tokens without touching any subscriber (two-church isolation)", async () => {
    // Valid signature for (SUB_ID, CHURCH_A) but claiming church B.
    const tokenA = buildUnsubscribeToken(SUB_ID, CHURCH_A);
    const forged = `${SUB_ID}.${CHURCH_B}.${tokenA.split(".")[2]}`;
    const res = await GET(new Request(`http://localhost/api/unsubscribe?token=${encodeURIComponent(forged)}`));
    expect(res.status).toBe(400);
    expect(h.fake.rows("subscribers").every((s: any) => s.unsubscribed === false)).toBe(true);
  });

  it("rejects garbage and missing tokens", async () => {
    expect((await GET(new Request("http://localhost/api/unsubscribe"))).status).toBe(400);
    expect((await GET(new Request("http://localhost/api/unsubscribe?token=junk"))).status).toBe(400);
    expect((await POST(new Request("http://localhost/api/unsubscribe", { method: "POST" }))).status).toBe(400);
    expect(h.fake.rows("subscribers").every((s: any) => s.unsubscribed === false)).toBe(true);
  });
});
