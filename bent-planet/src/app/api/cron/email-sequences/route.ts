import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  sendConferenceReminderEmail,
  sendReplayEmail,
} from "@/lib/email";
import {
  classifyReminder,
  isReplayDue,
  reminderLeadLabel,
  REPLAY_MAX_AGE_MS,
} from "@/lib/event-time";
import { buildUnsubscribeUrl } from "@/lib/unsubscribe-token";
import { getServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Coarse date-string window used to limit DB rows before precise filtering. */
function dayString(offsetDays: number, from: Date): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type ChurchJoin = { name: string; logo_url: string | null; timezone: string | null } | null;

type ReminderConference = {
  id: string;
  title: string;
  conference_date: string | null;
  conference_time: string | null;
  end_date: string | null;
  timezone: string | null;
  stream_url: string | null;
  church_id: string | null;
  churches: ChurchJoin;
};

type ReplayConference = ReminderConference & {
  free_resource_url: string | null;
  free_resource_name: string | null;
  enable_replay: boolean | null;
};

type ReminderFlagColumn = "reminder_7d_sent" | "reminder_24h_sent";

/**
 * Vercel Cron Job: runs daily at 8am UTC
 * Handles:
 *   1. 7-day reminders (event-local time, multi-day aware)
 *   2. 24-hour reminders
 *   3. Post-conference replay emails (after the event's final day ends)
 *
 * All scheduling is computed from the event's timezone and start/end times,
 * deduplicated per subscriber via flags, and honors `unsubscribed`.
 */
export async function GET(request: Request) {
  // Secure with CRON_SECRET header — fail CLOSED when unconfigured.
  const authHeader = request.headers.get("authorization");
  const cronSecret = getServerEnv().CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured. Refusing to run unauthenticated." },
      { status: 500 }
    );
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const results = {
    reminders7d: 0,
    reminders24h: 0,
    replayEmails: 0,
    skippedUnsubscribed: 0,
    errors: 0,
  };

  try {
    const now = new Date();

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // REMINDERS (7-day and 24-hour)
    //
    // Coarse window: events starting between yesterday and ~9 days out
    // (covers timezone skew); precise classification happens in JS against
    // the event's local wall clock.
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const { data: reminderConfs, error: reminderErr } = await adminClient
      .from("conferences")
      .select(
        "id, title, conference_date, conference_time, end_date, timezone, stream_url, church_id, churches(name, logo_url, timezone)"
      )
      .eq("status", "published")
      .gte("conference_date", dayString(-1, now))
      .lte("conference_date", dayString(9, now));

    if (reminderErr) throw new Error(reminderErr.message);

    for (const conf of (reminderConfs || []) as unknown as ReminderConference[]) {
      const church = conf.churches as unknown as ChurchJoin;
      const timing = {
        conferenceDate: conf.conference_date,
        endDate: conf.end_date,
        conferenceTime: conf.conference_time,
        timezone: conf.timezone || church?.timezone || null,
      };

      const kind = classifyReminder(timing, now);
      if (kind === "none") continue;

      const flagColumn: ReminderFlagColumn =
        kind === "reminder_7d" ? "reminder_7d_sent" : "reminder_24h_sent";
      const leadLabel = reminderLeadLabel(timing, now);

      const { data: subscribers, error: subErr } = await adminClient
        .from("subscribers")
        .select("id, full_name, email, unsubscribed")
        .eq("conference_id", conf.id)
        .eq(flagColumn, false);

      if (subErr) {
        results.errors++;
        continue;
      }

      for (const sub of subscribers || []) {
        if (!sub.email) continue;
        if (sub.unsubscribed) {
          results.skippedUnsubscribed++;
          continue;
        }

        try {
          await sendConferenceReminderEmail({
            toEmail: sub.email,
            subscriberName: sub.full_name || "Friend",
            churchName: church?.name || "",
            churchLogo: church?.logo_url,
            conferenceTitle: conf.title,
            conferenceDate: conf.conference_date,
            conferenceTime: conf.conference_time,
            streamUrl: conf.stream_url,
            leadLabel,
            unsubscribeUrl: buildUnsubscribeUrl(sub.id, conf.church_id ?? ""),
          });

          await adminClient
            .from("subscribers")
            .update(
              flagColumn === "reminder_7d_sent"
                ? { reminder_7d_sent: true }
                : { reminder_24h_sent: true }
            )
            .eq("id", sub.id);

          if (kind === "reminder_7d") {
            results.reminders7d++;
          } else {
            results.reminders24h++;
          }
        } catch {
          results.errors++;
        }
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // POST-CONFERENCE REPLAY EMAILS
    //
    // Due at the first run after the event's final day has ended (multi-day
    // events are never replayed while still running), within REPLAY_MAX_AGE_MS.
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const replayWindowStart = dayString(-Math.ceil(REPLAY_MAX_AGE_MS / (24 * 60 * 60 * 1000)) - 2, now);
    const replayWindowEnd = dayString(1, now);

    const replayQueries = await Promise.all([
      // Single-day events (no end_date)
      adminClient
        .from("conferences")
        .select(
          "id, title, conference_date, conference_time, end_date, timezone, stream_url, church_id, free_resource_url, free_resource_name, enable_replay, churches(name, logo_url, timezone)"
        )
        .eq("status", "published")
        .eq("enable_replay", true)
        .is("end_date", null)
        .gte("conference_date", replayWindowStart)
        .lte("conference_date", replayWindowEnd),
      // Multi-day events: filter on the last day
      adminClient
        .from("conferences")
        .select(
          "id, title, conference_date, conference_time, end_date, timezone, stream_url, church_id, free_resource_url, free_resource_name, enable_replay, churches(name, logo_url, timezone)"
        )
        .eq("status", "published")
        .eq("enable_replay", true)
        .not("end_date", "is", null)
        .gte("end_date", replayWindowStart)
        .lte("end_date", replayWindowEnd),
    ]);

    const seenReplayIds = new Set<string>();
    for (const { data, error: replayErr } of replayQueries) {
      if (replayErr) {
        results.errors++;
        continue;
      }

      for (const conf of (data || []) as unknown as ReplayConference[]) {
        if (seenReplayIds.has(conf.id)) continue;
        seenReplayIds.add(conf.id);

        const church = conf.churches as unknown as ChurchJoin;
        const timing = {
          conferenceDate: conf.conference_date,
          endDate: conf.end_date,
          conferenceTime: conf.conference_time,
          timezone: conf.timezone || church?.timezone || null,
          enableReplay: conf.enable_replay,
        };

        if (!isReplayDue(timing, now)) continue;

        const { data: subscribers, error: subErr } = await adminClient
          .from("subscribers")
          .select("id, full_name, email, unsubscribed")
          .eq("conference_id", conf.id)
          .eq("replay_email_sent", false);

        if (subErr) {
          results.errors++;
          continue;
        }

        for (const sub of subscribers || []) {
          if (!sub.email) continue;
          if (sub.unsubscribed) {
            results.skippedUnsubscribed++;
            continue;
          }

          try {
            await sendReplayEmail({
              toEmail: sub.email,
              subscriberName: sub.full_name || "Friend",
              churchName: church?.name || "",
              churchLogo: church?.logo_url,
              conferenceTitle: conf.title,
              streamUrl: conf.stream_url,
              freeResourceUrl: conf.free_resource_url,
              freeResourceName: conf.free_resource_name,
              unsubscribeUrl: buildUnsubscribeUrl(sub.id, conf.church_id ?? ""),
            });

            await adminClient
              .from("subscribers")
              .update({ replay_email_sent: true })
              .eq("id", sub.id);

            results.replayEmails++;
          } catch {
            results.errors++;
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      ran_at: now.toISOString(),
      ...results,
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("Cron job error:", err);
    return NextResponse.json({ error: err.message || "Cron job failed" }, { status: 500 });
  }
}
