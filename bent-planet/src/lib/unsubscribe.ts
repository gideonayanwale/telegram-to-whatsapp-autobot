import { createAdminClient } from "@/lib/supabase/admin";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe-token";

export type UnsubscribeResult = "done" | "already" | "invalid" | "error";

/**
 * Mark a subscriber as unsubscribed using a signed token.
 * Verifies the token AND that the subscriber row still belongs to the
 * church embedded in the token (no cross-church tampering).
 */
export async function unsubscribeByToken(token: string): Promise<UnsubscribeResult> {
  const parsed = verifyUnsubscribeToken(token);
  if (!parsed) return "invalid";

  const adminClient = createAdminClient();
  const { data: subscriber, error: fetchErr } = await adminClient
    .from("subscribers")
    .select("id, full_name, church_id, unsubscribed")
    .eq("id", parsed.subscriberId)
    .maybeSingle();

  if (fetchErr) return "error";
  if (!subscriber || subscriber.church_id !== parsed.churchId) return "invalid";
  if (subscriber.unsubscribed) return "already";

  const { error: updateErr } = await adminClient
    .from("subscribers")
    .update({ unsubscribed: true, unsubscribed_at: new Date().toISOString() })
    .eq("id", subscriber.id)
    .eq("church_id", parsed.churchId);

  if (updateErr) return "error";

  // Let the church know (non-fatal).
  try {
    await adminClient.from("notifications").insert({
      church_id: parsed.churchId,
      type: "subscriber",
      title: "Subscriber Unsubscribed",
      message: `${subscriber.full_name || "A subscriber"} unsubscribed from email updates.`,
      action_url: "/dashboard/subscribers",
    });
  } catch {
    // ignore
  }

  return "done";
}
