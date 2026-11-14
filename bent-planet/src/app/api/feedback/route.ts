import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, requestIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const MAX_FEEDBACK_PER_IP_PER_HOUR = 10;

export async function POST(req: Request) {
  try {
    const { email, name, category, message, churchId, church_id } = await req.json();
    const targetChurchId = churchId || church_id || null;

    if (!email || !message) {
      return NextResponse.json(
        { error: "Email and message are required." },
        { status: 400 }
      );
    }

    // Basic input caps + abuse protection for this public endpoint.
    if (
      typeof email !== "string" || email.length > 254 ||
      typeof message !== "string" || message.length > 5000 ||
      (name && (typeof name !== "string" || name.length > 200)) ||
      (category && (typeof category !== "string" || category.length > 50))
    ) {
      return NextResponse.json({ error: "Invalid feedback payload" }, { status: 400 });
    }

    const ipLimit = await checkRateLimit(
      `feedback:${requestIp(req)}`,
      "feedback",
      60 * 60 * 1000,
      MAX_FEEDBACK_PER_IP_PER_HOUR
    );
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: "Too many feedback submissions. Please try again later." },
        { status: 429 }
      );
    }

    const adminClient = createAdminClient();

    const { data: insertedFeedback, error: insertError } = await adminClient
      .from("feedback_messages")
      .insert({
        church_id: targetChurchId,
        user_email: email,
        user_name: name || null,
        category: category || "feedback",
        message,
        status: "unread",
      })
      .select()
      .single();

    if (insertError) {
      console.error("Feedback insert error:", insertError);
      return NextResponse.json(
        { error: "Failed to submit feedback." },
        { status: 500 }
      );
    }

    // Trigger notification (church-specific or super-admin)
    try {
      await adminClient
        .from("notifications")
        .insert({
          church_id: targetChurchId,
          type: "feedback",
          title: `New Feedback (${category || "General"})`,
          message: `${name ? `${name} (${email})` : email}: ${message.slice(0, 80)}${message.length > 80 ? "..." : ""}`,
          action_url: targetChurchId ? "/dashboard" : "/super-admin",
          read: false,
        });
    } catch (notifErr) {
      console.error("Failed to create feedback notification:", notifErr);
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("Feedback API error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to submit feedback." },
      { status: 500 }
    );
  }
}
