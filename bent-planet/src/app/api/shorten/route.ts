import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/current-user";
import { shortenUrl } from "@/lib/bitly";

export const dynamic = "force-dynamic";

// Lightweight in-memory sliding window per user, to protect the Bitly quota.
const MAX_SHORTENS_PER_15_MIN = 30;
const WINDOW_MS = 15 * 60 * 1000;
const hits = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((ts) => now - ts < WINDOW_MS);
  if (recent.length >= MAX_SHORTENS_PER_15_MIN) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  return false;
}

export async function POST(request: Request) {
  try {
    // Authentication required — this endpoint consumes third-party API quota.
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    if (rateLimited(user.id)) {
      return NextResponse.json(
        { error: "Too many shorten requests. Please wait a few minutes and try again." },
        { status: 429 }
      );
    }

    const { url } = await request.json();
    if (!url || typeof url !== "string" || url.length > 2048) {
      return NextResponse.json({ error: "Missing or invalid url parameter" }, { status: 400 });
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    const shortUrl = await shortenUrl(url);
    return NextResponse.json({ shortUrl });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to shorten URL" }, { status: 500 });
  }
}
