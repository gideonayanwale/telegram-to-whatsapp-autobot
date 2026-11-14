import { NextResponse } from "next/server";
import { generateConferenceContentWithFallbacks } from "@/lib/ai-generator";
import { requireChurchApiUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    // Church-only API: require an authenticated church admin at the route
    // level too (defense in depth beyond the middleware gate).
    const auth = await requireChurchApiUser();
    if (!auth.ok) return auth.response;

    const body = await req.json();
    const { name, caption, theme, speaker, date, startTime } = body;
    const churchName = body.churchName || auth.church.name;

    if (!name) {
      return NextResponse.json({ error: "Conference name is required" }, { status: 400 });
    }

    const generatedContent = await generateConferenceContentWithFallbacks({
      name,
      caption,
      theme,
      speaker,
      date,
      startTime,
      churchName: churchName || "Our Church",
    });

    return NextResponse.json(generatedContent);
  } catch (error: unknown) {
    const err = error as Error;
    console.error("Error in AI conference generation API:", err);
    return NextResponse.json(
      { error: err.message || "Failed to generate conference content" },
      { status: 500 }
    );
  }
}
