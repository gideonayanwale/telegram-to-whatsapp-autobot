import { NextResponse } from "next/server";
import { requireChurchApiUser } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendBroadcastEmail } from "@/lib/email";
import { buildUnsubscribeUrl } from "@/lib/unsubscribe-token";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const auth = await requireChurchApiUser();
    if (!auth.ok) return auth.response;

    const adminClient = createAdminClient();
    const church = auth.church;

    if (church.status === "suspended") {
      return NextResponse.json({ error: "This workspace has been suspended. Please contact operations support." }, { status: 403 });
    }

    const {
      subject,
      bodyContent,
      ctaUrl,
      ctaText,
      themeStyle,
      badgeLabel,
      preheader,
      scriptureVerse,
      scriptureReference,
      secondaryLinkUrl,
      secondaryLinkText,
    } = await req.json();

    if (!subject || !bodyContent) {
      return NextResponse.json({ error: "Subject and Body content are required." }, { status: 400 });
    }

    // Fetch subscribers for this church
    const { data: subscribers, error: fetchErr } = await adminClient
      .from("subscribers")
      .select("id, full_name, email")
      .eq("church_id", church.id)
      .eq("unsubscribed", false);

    if (fetchErr || !subscribers || subscribers.length === 0) {
      return NextResponse.json({ error: "No active subscribers available to send broadcast." }, { status: 400 });
    }

    // Check monthly email limits
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { count: sentThisMonth } = await adminClient
      .from("email_log")
      .select("id", { count: "exact", head: true })
      .eq("church_id", church.id)
      .gte("sent_at", startOfMonth.toISOString());

    const maxEmails = church.max_emails_limit ?? 5000;
    const currentSent = sentThisMonth ?? 0;

    if (currentSent >= maxEmails) {
      return NextResponse.json({
        error: `Monthly email limit reached. Your church has sent ${currentSent}/${maxEmails} emails this month. Contact support to upgrade your limits.`
      }, { status: 429 });
    }

    if (currentSent + subscribers.length > maxEmails) {
      return NextResponse.json({
        error: `This broadcast exceeds your monthly limit. You have ${maxEmails - currentSent} remaining emails but this batch has ${subscribers.length} recipients.`
      }, { status: 429 });
    }

    let sentCount = 0;

    // Send emails in background
    for (const sub of subscribers) {
      try {
        const resendId = await sendBroadcastEmail({
          toEmail: sub.email,
          subscriberName: sub.full_name,
          churchName: church.name,
          churchLogo: church.logo_url,
          subject,
          bodyContent,
          ctaUrl,
          ctaText,
          themeStyle,
          badgeLabel,
          preheader,
          scriptureVerse,
          scriptureReference,
          secondaryLinkUrl,
          secondaryLinkText,
          unsubscribeUrl: buildUnsubscribeUrl(sub.id, church.id),
        });

        if (resendId) {
          sentCount++;
          await adminClient.from("email_log").insert({
            church_id: church.id,
            subscriber_id: sub.id,
            email_type: "broadcast",
            subject,
            resend_email_id: resendId,
          });
        }
      } catch (e) {
        console.error(`Failed sending broadcast to ${sub.email}:`, e);
      }
    }

    return NextResponse.json({ success: true, count: sentCount });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("Broadcast API error:", err);
    return NextResponse.json({ error: err.message || "Something went wrong" }, { status: 500 });
  }
}
