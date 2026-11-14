import { createHmac, timingSafeEqual } from "crypto";

import { getServerEnv } from "@/lib/env";

/**
 * Svix-style webhook signature verification (Resend signs its webhooks
 * with `svix-id` / `svix-timestamp` / `svix-signature` headers).
 *
 * Prevents forged POSTs from flipping `opened`/`clicked` on email_log rows,
 * which would corrupt engagement metrics.
 */

const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function verifyResendWebhookSignature(
  headers: Headers,
  rawBody: string,
  now: Date = new Date()
): boolean {
  const env = getServerEnv();
  const secret = env.RESEND_WEBHOOK_SECRET;
  if (!secret) return false;

  const svixId = headers.get("svix-id");
  const svixTimestamp = headers.get("svix-timestamp");
  const svixSignature = headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  // Reject replayed or stale deliveries.
  const ts = Number(svixTimestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Math.floor(now.getTime() / 1000) - ts) > TIMESTAMP_TOLERANCE_SECONDS) return false;

  // Secret format: "whsec_<base64>" (raw base64 also accepted).
  const secretBytes = base64UrlDecode(secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret);

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = createHmac("sha256", secretBytes).update(signedContent).digest();

  // Header may carry several space-separated "v1,<base64>" signatures.
  const signatures = svixSignature.split(" ");
  for (const sig of signatures) {
    const [version, payload] = sig.split(",");
    if (version !== "v1" || !payload) continue;
    const actual = base64UrlDecode(payload);
    if (actual.length === expected.length && timingSafeEqual(actual, expected)) {
      return true;
    }
  }
  return false;
}
