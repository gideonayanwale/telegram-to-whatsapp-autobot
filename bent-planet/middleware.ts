import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getAppRouteForEmail, isSuperAdmin } from "@/lib/auth";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Public API routes (no session required). These are webhooks, the cron
 * endpoint (secret-authenticated in-route), and forms served on public pages.
 * Everything else under /api/ requires a session.
 */
const PUBLIC_API_ROUTES = new Set([
  "/api/subscribe",
  "/api/og",
  "/api/webhooks/resend",
  "/api/cron/email-sequences",
  "/api/unsubscribe",
  "/api/feedback",
  "/api/access-requests",
]);

/** Public page routes (marketing, legal, auth flows, token-gated pages). */
const PUBLIC_PAGE_ROUTES = new Set([
  "/",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/request-access",
  "/contact",
  "/privacy",
  "/terms",
  "/docs",
  "/templates",
  "/feedback",
  "/unsubscribe",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
]);

const PUBLIC_PAGE_PREFIXES = ["/onboarding/", "/c/", "/_next/"];

function isApiRoute(pathname: string) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function isPublicPage(pathname: string) {
  return PUBLIC_PAGE_ROUTES.has(pathname) || PUBLIC_PAGE_PREFIXES.some((p) => pathname.startsWith(p));
}

function isSuperAdminRoute(pathname: string) {
  return pathname.startsWith("/super-admin");
}

function isDashboardRoute(pathname: string) {
  return pathname.startsWith("/dashboard");
}

function isChurchOnlyApiRoute(pathname: string) {
  return pathname === "/api/generate-conference" || pathname === "/api/broadcast";
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public pages: never require a session.
  if (isPublicPage(pathname)) {
    return NextResponse.next();
  }

  // Public APIs: let the route handlers authenticate themselves (secrets etc.).
  if (isApiRoute(pathname)) {
    if (PUBLIC_API_ROUTES.has(pathname)) {
      return NextResponse.next();
    }

    // All other APIs require a session; answer with JSON, never an HTML
    // login redirect, so clients get a proper 401.
    const { response, supabase } = await updateSession(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    if (isChurchOnlyApiRoute(pathname) && isSuperAdmin(user.email)) {
      return NextResponse.json({ error: "Super admin cannot call church-only API routes." }, { status: 403 });
    }

    return response;
  }

  // Everything else is a page route.
  const { response, supabase } = await updateSession(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (pathname === "/login") {
    if (!user) {
      return response;
    }

    return NextResponse.redirect(new URL(getAppRouteForEmail(user.email), request.url));
  }

  if (!user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isSuperAdminRoute(pathname)) {
    if (!isSuperAdmin(user.email)) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }

    return response;
  }

  if (isDashboardRoute(pathname)) {
    if (isSuperAdmin(user.email)) {
      return NextResponse.redirect(new URL("/super-admin", request.url));
    }

    return response;
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|woff|woff2|mp4|webmanifest)$).*)",
  ],
};
