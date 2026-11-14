import { NextResponse } from "next/server";

import { unsubscribeByToken } from "@/lib/unsubscribe";

export const dynamic = "force-dynamic";

/**
 * Public unsubscribe endpoint.
 *
 * - GET  /api/unsubscribe?token=...  (link clicks)
 * - POST /api/unsubscribe            (RFC 8058 one-click; token in query or body)
 */
async function handle(token: string | null) {
  if (!token || typeof token !== "string" || token.length > 512) {
    return NextResponse.json({ error: "Missing or invalid unsubscribe token" }, { status: 400 });
  }

  const result = await unsubscribeByToken(token);
  switch (result) {
    case "done":
      return NextResponse.json({ success: true, status: "unsubscribed" });
    case "already":
      return NextResponse.json({ success: true, status: "already_unsubscribed" });
    case "invalid":
      return NextResponse.json({ error: "This unsubscribe link is invalid or expired" }, { status: 400 });
    default:
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  return handle(url.searchParams.get("token"));
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  let token = url.searchParams.get("token");
  if (!token) {
    try {
      const contentType = request.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const body = await request.json();
        token = typeof body?.token === "string" ? body.token : null;
      } else {
        const form = await request.formData();
        const formToken = form.get("token");
        token = typeof formToken === "string" ? formToken : null;
      }
    } catch {
      token = null;
    }
  }
  return handle(token);
}
