import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/current-user";
import { sendSubscriberWelcomeEmail } from "@/lib/email";
import { buildUnsubscribeUrl } from "@/lib/unsubscribe-token";
import { checkRateLimit, requestIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Public subscribe endpoint.
 *
 * Hardening:
 * - strict input validation (formats + length caps) before any query
 * - the church must exist and the conference (if given) must belong to it
 * - sliding-window rate limits per email and per IP
 * - honeypot field to silently drop bot submissions
 * - re-subscribing re-activates a previously unsubscribed address
 */

const subscribeSchema = z.object({
  churchId: z.string().uuid(),
  conferenceId: z.string().uuid().nullish(),
  fullName: z.string().trim().min(1, "Name is required").max(200),
  email: z.string().trim().email("A valid email is required").max(254).toLowerCase(),
  phone: z.string().trim().max(30).nullish(),
  // Honeypot — real users never fill this hidden field.
  website: z.string().max(500).nullish(),
});

const MAX_SUBSCRIBES_PER_EMAIL_PER_HOUR = 5;
const MAX_SUBSCRIBES_PER_IP_PER_HOUR = 20;

export async function POST(req: Request) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = subscribeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid subscription data" },
        { status: 400 }
      );
    }

    const { churchId, conferenceId, fullName, email, phone, website } = parsed.data;

    // Honeypot triggered — pretend success, persist nothing.
    if (website) {
      return NextResponse.json({ success: true });
    }

    // Abuse protection: sliding window per email and per IP. Authenticated
    // dashboard users (church admins adding their own subscribers) are exempt.
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      const emailLimit = await checkRateLimit(
        `subscribe:${email}`,
        "subscribe",
        60 * 60 * 1000,
        MAX_SUBSCRIBES_PER_EMAIL_PER_HOUR
      );
      if (!emailLimit.allowed) {
        return NextResponse.json(
          { error: "Too many subscription attempts. Please try again later." },
          { status: 429 }
        );
      }
      const ipLimit = await checkRateLimit(
        `subscribe-ip:${requestIp(req)}`,
        "subscribe",
        60 * 60 * 1000,
        MAX_SUBSCRIBES_PER_IP_PER_HOUR
      );
      if (!ipLimit.allowed) {
        return NextResponse.json(
          { error: "Too many subscription attempts from your network. Please try again later." },
          { status: 429 }
        );
      }
    }

    const adminClient = createAdminClient();

    // The church must exist.
    const { data: church, error: churchErr } = await adminClient
      .from("churches")
      .select("id, name, logo_url, whatsapp_group_url, whatsapp_channel_url, whatsapp_url")
      .eq("id", churchId)
      .maybeSingle();
    if (churchErr) {
      console.error("Church lookup error:", churchErr);
      return NextResponse.json({ error: "Failed to save subscription" }, { status: 500 });
    }
    if (!church) {
      return NextResponse.json({ error: "Church not found" }, { status: 404 });
    }

    // If a conference is referenced it must belong to the referenced church.
    let conf: {
      title: string;
      conference_date: string | null;
      conference_time: string | null;
      stream_url: string | null;
      whatsapp_group_url: string | null;
      whatsapp_channel_url: string | null;
      free_resource_url: string | null;
      free_resource_name: string | null;
    } | null = null;
    if (conferenceId) {
      const { data: confRow, error: confErr } = await adminClient
        .from("conferences")
        .select(
          "id, church_id, title, conference_date, conference_time, stream_url, whatsapp_group_url, whatsapp_channel_url, free_resource_url, free_resource_name"
        )
        .eq("id", conferenceId)
        .maybeSingle();
      if (confErr) {
        console.error("Conference lookup error:", confErr);
        return NextResponse.json({ error: "Failed to save subscription" }, { status: 500 });
      }
      // Church/event relationship check: reject cross-church references.
      if (!confRow || confRow.church_id !== churchId) {
        return NextResponse.json(
          { error: "Conference does not belong to this church" },
          { status: 400 }
        );
      }
      conf = confRow;
    }

    // Insert or update subscriber. `unsubscribed: false` re-activates anyone
    // who previously unsubscribed and is now opting back in via the form.
    const { data: subscriber, error: insertError } = await adminClient
      .from("subscribers")
      .upsert(
        {
          church_id: churchId,
          conference_id: conferenceId || null,
          full_name: fullName,
          email,
          phone: phone || null,
          unsubscribed: false,
        },
        { onConflict: "church_id, email" }
      )
      .select("id")
      .single();

    if (insertError) {
      console.error("Subscriber insert error:", insertError);
      return NextResponse.json(
        { error: "Failed to save subscription" },
        { status: 500 }
      );
    }

    // Trigger Welcome Email in background if conference is attached
    if (conferenceId && conf) {
      try {
        // Trigger in-app notification for church admin
        await adminClient.from("notifications").insert({
          church_id: churchId,
          type: "subscriber",
          title: "New Attendee Registered",
          message: `${fullName} registered for ${conf.title}.`,
          action_url: "/dashboard/subscribers",
        });

        const resendId = await sendSubscriberWelcomeEmail({
          toEmail: email,
          subscriberName: fullName,
          churchName: church.name,
          churchLogo: church.logo_url,
          conferenceTitle: conf.title,
          conferenceDate: conf.conference_date,
          conferenceTime: conf.conference_time,
          streamUrl: conf.stream_url,
          whatsappGroupUrl: conf.whatsapp_group_url || church.whatsapp_group_url || church.whatsapp_url,
          whatsappChannelUrl: conf.whatsapp_channel_url || church.whatsapp_channel_url,
          freeResourceUrl: conf.free_resource_url,
          freeResourceName: conf.free_resource_name,
          unsubscribeUrl: subscriber?.id ? buildUnsubscribeUrl(subscriber.id, churchId) : null,
        });

        if (resendId) {
          await adminClient.from("email_log").insert({
            church_id: churchId,
            conference_id: conferenceId,
            subscriber_id: subscriber?.id,
            email_type: "welcome",
            subject: `Welcome to ${church.name}`,
            resend_email_id: resendId,
          });
        }
      } catch (emailErr) {
        console.error("Welcome email / notification error (non-fatal):", emailErr);
      }
    } else {
      // Direct general subscriber without specific conference
      try {
        await adminClient.from("notifications").insert({
          church_id: churchId,
          type: "subscriber",
          title: "New Subscriber",
          message: `${fullName} joined your subscriber list.`,
          action_url: "/dashboard/subscribers",
        });
      } catch (notifErr) {
        console.error("Notification insert error:", notifErr);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("Subscribe API error:", err);
    return NextResponse.json(
      { error: err.message || "Something went wrong" },
      { status: 500 }
    );
  }
}
