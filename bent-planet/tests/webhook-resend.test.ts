import { createHmac } from "crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeSupabase } from "./helpers/fake-supabase";

const h = vi.hoisted(() => ({
  fake: null as any,
  env: {
    RESEND_WEBHOOK_SECRET: "",
  } as Record<string, string>,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => h.fake,
}));
vi.mock("@/lib/env", () => ({
  getServerEnv: () => h.env,
}));

import { POST } from "@/app/api/webhooks/resend/route";

const SECRET_BYTES = Buffer.from("resend-webhook-signing-key-32byte!");
const SECRET_B64 = SECRET_BYTES.toString("base64");
const EMAIL_ID = "resend-email-42";

function signedRequest(body: string, opts: { id?: string; ts?: number; sig?: string } = {}) {
  const id = opts.id ?? "msg_abc123";
  const ts = opts.ts ?? Math.floor(Date.now() / 1000);
  const signature =
    opts.sig ??
    createHmac("sha256", SECRET_BYTES).update(`${id}.${ts}.${body}`).digest("base64");
  return new Request("http://localhost/api/webhooks/resend", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": String(ts),
      "svix-signature": `v1,${signature}`,
    },
    body,
  });
}

const openedEvent = JSON.stringify({
  type: "email.opened",
  data: { email_id: EMAIL_ID },
});

beforeEach(() => {
  h.fake = new FakeSupabase();
  h.fake.seed("email_log", [
    { id: "log-1", resend_email_id: EMAIL_ID, opened: false, clicked: false },
    { id: "log-2", resend_email_id: "other-email", opened: false, clicked: false },
  ]);
  h.env.RESEND_WEBHOOK_SECRET = `whsec_${SECRET_B64}`;
});

describe("POST /api/webhooks/resend — signature verification", () => {
  it("accepts correctly signed deliveries and records the engagement", async () => {
    const res = await POST(signedRequest(openedEvent));
    expect(res.status).toBe(200);
    const log1 = h.fake.rows("email_log").find((r: any) => r.id === "log-1");
    expect(log1.opened).toBe(true);
    // Only the referenced row changes.
    expect(h.fake.rows("email_log").find((r: any) => r.id === "log-2").opened).toBe(false);
  });

  it("records true delivery, bounce and complaint events", async () => {
    const delivered = JSON.stringify({ type: "email.delivered", data: { email_id: EMAIL_ID } });
    expect((await POST(signedRequest(delivered))).status).toBe(200);
    const log1 = h.fake.rows("email_log").find((r: any) => r.id === "log-1");
    expect(log1.delivered).toBe(true);
    expect(log1.delivered_at).toBeTruthy();

    const bounced = JSON.stringify({ type: "email.bounced", data: { email_id: "other-email" } });
    expect((await POST(signedRequest(bounced))).status).toBe(200);
    const log2 = h.fake.rows("email_log").find((r: any) => r.id === "log-2");
    expect(log2.bounced).toBe(true);
    expect(log2.bounced_at).toBeTruthy();

    const complained = JSON.stringify({ type: "email.complained", data: { email_id: EMAIL_ID } });
    expect((await POST(signedRequest(complained))).status).toBe(200);
    expect(h.fake.rows("email_log").find((r: any) => r.id === "log-1").complained).toBe(true);
  });

  it("rejects forged deliveries (regression: unsigned POSTs used to fake opens)", async () => {
    const forged = new Request("http://localhost/api/webhooks/resend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: openedEvent,
    });
    const res = await POST(forged);
    expect(res.status).toBe(401);
    expect(h.fake.rows("email_log").every((r: any) => r.opened === false)).toBe(true);
  });

  it("rejects bad signatures and missing headers", async () => {
    const badSig = await POST(signedRequest(openedEvent, { sig: Buffer.from("nope").toString("base64") }));
    expect(badSig.status).toBe(401);

    const noHeaders = new Request("http://localhost/api/webhooks/resend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: openedEvent,
    });
    expect((await POST(noHeaders)).status).toBe(401);
  });

  it("rejects stale timestamps (replay protection)", async () => {
    const stale = await POST(
      signedRequest(openedEvent, { ts: Math.floor(Date.now() / 1000) - 60 * 10 })
    );
    expect(stale.status).toBe(401);
    expect(h.fake.rows("email_log").every((r: any) => r.opened === false)).toBe(true);
  });

  it("fails closed when no webhook secret is configured", async () => {
    h.env.RESEND_WEBHOOK_SECRET = "";
    const res = await POST(signedRequest(openedEvent));
    expect(res.status).toBe(401);
    expect(h.fake.rows("email_log").every((r: any) => r.opened === false)).toBe(true);
  });
});
