import { createHmac, timingSafeEqual } from "crypto";

import { getServerEnv } from "@/lib/env";

/**
 * Signed unsubscribe tokens.
 *
 * Format: `<subscriberId>.<churchId>.<base64url hmac>` where the HMAC covers
 * both ids. No database migration is required; the `subscribers.unsubscribed`
 * flag is flipped on use. Tokens are stable (no expiry) so links in old emails
 * keep working.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getUnsubscribeSecret(): string {
  const env = getServerEnv();
  // Prefer a dedicated secret; fall back to other server secrets so the
  // feature works without extra configuration. All are server-side only.
  const secret = env.UNSUBSCRIBE_SECRET || env.CRON_SECRET || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error(
      "No server secret available for unsubscribe tokens. Set UNSUBSCRIBE_SECRET (or CRON_SECRET / SUPABASE_SERVICE_ROLE_KEY)."
    );
  }
  return secret;
}

function signPayload(subscriberId: string, churchId: string): string {
  return createHmac("sha256", getUnsubscribeSecret())
    .update(`unsubscribe:${subscriberId}:${churchId}`)
    .digest("base64url");
}

export function buildUnsubscribeToken(subscriberId: string, churchId: string): string {
  return `${subscriberId}.${churchId}.${signPayload(subscriberId, churchId)}`;
}

export function verifyUnsubscribeToken(token: string): { subscriberId: string; churchId: string } | null {
  if (!token || typeof token !== "string" || token.length > 512) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [subscriberId, churchId, signature] = parts;
  if (!UUID_RE.test(subscriberId) || !UUID_RE.test(churchId)) return null;

  const expected = signPayload(subscriberId, churchId);
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length) return null;
  if (!timingSafeEqual(expectedBuf, actualBuf)) return null;

  return { subscriberId, churchId };
}

export function buildUnsubscribeUrl(subscriberId: string, churchId: string): string {
  const env = getServerEnv();
  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const token = buildUnsubscribeToken(subscriberId, churchId);
  return `${base}/unsubscribe?token=${encodeURIComponent(token)}`;
}
