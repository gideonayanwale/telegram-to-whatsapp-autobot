import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyResendWebhookSignature } from "@/lib/webhook-signature";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    // Authenticate the webhook: only Resend's signed deliveries are accepted.
    // Raw body is required for the signature check.
    const rawBody = await req.text();
    if (!verifyResendWebhookSignature(req.headers, rawBody)) {
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
    }

    const payload = JSON.parse(rawBody);

    // Resend sends webhooks as arrays or single objects depending on config
    const events = Array.isArray(payload) ? payload : [payload];
    const adminClient = createAdminClient();

    for (const event of events) {
      if (!event.type || !event.data || !event.data.email_id) continue;

      const emailId = event.data.email_id;

      if (event.type === "email.opened") {
        await adminClient
          .from("email_log")
          .update({ opened: true })
          .eq("resend_email_id", emailId);
      } else if (event.type === "email.clicked") {
        await adminClient
          .from("email_log")
          .update({ clicked: true })
          .eq("resend_email_id", emailId);
      } else if (event.type === "email.delivered") {
        await adminClient
          .from("email_log")
          .update({ delivered: true, delivered_at: new Date().toISOString() })
          .eq("resend_email_id", emailId);
      } else if (event.type === "email.bounced") {
        await adminClient
          .from("email_log")
          .update({ bounced: true, bounced_at: new Date().toISOString() })
          .eq("resend_email_id", emailId);
      } else if (event.type === "email.complained") {
        await adminClient
          .from("email_log")
          .update({ complained: true })
          .eq("resend_email_id", emailId);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("Resend Webhook error:", err);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
