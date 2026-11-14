import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({
    UNSUBSCRIBE_SECRET: "test-secret",
    CRON_SECRET: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
    NEXT_PUBLIC_APP_URL: "https://app.test",
  }),
}));

import { buildUnsubscribeToken, buildUnsubscribeUrl, verifyUnsubscribeToken } from "@/lib/unsubscribe-token";

const SUB_ID = "11111111-2222-4333-8444-555555555555";
const CHURCH_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHURCH_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("unsubscribe tokens", () => {
  it("round-trips a signed token", () => {
    const token = buildUnsubscribeToken(SUB_ID, CHURCH_A);
    expect(verifyUnsubscribeToken(token)).toEqual({ subscriberId: SUB_ID, churchId: CHURCH_A });
  });

  it("rejects tampered signatures", () => {
    const token = buildUnsubscribeToken(SUB_ID, CHURCH_A);
    const tampered = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA");
    expect(verifyUnsubscribeToken(tampered)).toBeNull();
  });

  it("rejects swapped or substituted ids (no cross-church token reuse)", () => {
    const token = buildUnsubscribeToken(SUB_ID, CHURCH_A);
    const parts = token.split(".");
    // Swap in church B but keep church A's signature.
    const swapped = `${parts[0]}.${CHURCH_B}.${parts[2]}`;
    expect(verifyUnsubscribeToken(swapped)).toBeNull();
    // Swap in another subscriber id.
    const otherSub = `${CHURCH_B}.${parts[1]}.${parts[2]}`;
    expect(verifyUnsubscribeToken(otherSub)).toBeNull();
  });

  it("rejects garbage and malformed input", () => {
    expect(verifyUnsubscribeToken("")).toBeNull();
    expect(verifyUnsubscribeToken("not-a-token")).toBeNull();
    expect(verifyUnsubscribeToken("a.b")).toBeNull();
    expect(verifyUnsubscribeToken(`${SUB_ID}.${CHURCH_A}`)).toBeNull();
    expect(verifyUnsubscribeToken("x".repeat(600))).toBeNull();
    // Valid signature shape but non-uuid ids.
    expect(verifyUnsubscribeToken("foo.bar.baz")).toBeNull();
  });

  it("builds an app-hosted unsubscribe URL carrying the token", () => {
    const url = buildUnsubscribeUrl(SUB_ID, CHURCH_A);
    expect(url.startsWith("https://app.test/unsubscribe?token=")).toBe(true);
    const token = decodeURIComponent(url.split("token=")[1]);
    expect(verifyUnsubscribeToken(token)).toEqual({ subscriberId: SUB_ID, churchId: CHURCH_A });
  });
});
