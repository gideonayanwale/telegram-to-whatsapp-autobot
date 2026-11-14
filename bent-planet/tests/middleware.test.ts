import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  user: null as any,
}));

vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({
    SUPER_ADMIN_EMAILS: "root@bentplanet.test",
    NEXT_PUBLIC_SUPABASE_URL: "https://db.test",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    NEXT_PUBLIC_APP_URL: "https://app.test",
    UNSUBSCRIBE_SECRET: "test-secret",
    CRON_SECRET: "cron-secret",
    SUPABASE_SERVICE_ROLE_KEY: "",
  }),
  getPublicEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: "https://db.test",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    NEXT_PUBLIC_APP_URL: "https://app.test",
  }),
}));
vi.mock("@/lib/supabase/middleware", async () => {
  const { NextResponse } = await import("next/server");
  return {
    updateSession: async (_req: any) => ({
      response: NextResponse.next(),
      supabase: { auth: { getUser: async () => ({ data: { user: h.user } }) } },
    }),
  };
});

import { middleware } from "../middleware";

function req(path: string) {
  return new NextRequest(`http://localhost:3000${path}`);
}

beforeEach(() => {
  h.user = null;
});

describe("middleware — public route discovery (regression: public pages used to require login)", () => {
  it.each([
    "/",
    "/register",
    "/request-access",
    "/contact",
    "/privacy",
    "/terms",
    "/docs",
    "/templates",
    "/feedback",
    "/forgot-password",
    "/reset-password",
    "/unsubscribe",
    "/onboarding/abc-token",
    "/c/grace-chapel",
  ])("allows anonymous access to %s", async (path) => {
    const res = await middleware(req(path));
    expect(res.status).toBe(200); // NextResponse.next()
    expect(res.headers.get("x-middleware-next")).toBeTruthy();
  });

  it.each(["/api/subscribe", "/api/og", "/api/webhooks/resend", "/api/cron/email-sequences", "/api/unsubscribe", "/api/feedback", "/api/access-requests"])(
    "allows anonymous access to public API %s",
    async (path) => {
      const res = await middleware(req(path));
      expect(res.status).toBe(200);
      expect(res.headers.get("x-middleware-next")).toBeTruthy();
    }
  );
});

describe("middleware — protected routes (regression: APIs got HTML login redirects)", () => {
  it.each(["/api/notifications", "/api/broadcast", "/api/generate-conference", "/api/complete-tour", "/api/shorten", "/api/generate-email"])(
    "answers 401 JSON (not a login redirect) for anonymous calls to %s",
    async (path) => {
      const res = await middleware(req(path));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    }
  );

  it("redirects anonymous page requests to /login with a redirectTo param", async () => {
    const res = await middleware(req("/dashboard"));
    expect(res.status).toBe(307);
    const location = res.headers.get("location")!;
    expect(location).toContain("/login");
    expect(location).toContain("redirectTo=%2Fdashboard");
  });

  it("redirects unauthenticated users away from /super-admin", async () => {
    const res = await middleware(req("/super-admin"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
});

describe("middleware — authenticated flows", () => {
  it("lets a signed-in church user reach the dashboard but not super-admin", async () => {
    h.user = { email: "admin@a.test" };
    const dash = await middleware(req("/dashboard"));
    expect(dash.status).toBe(200);

    const superAdmin = await middleware(req("/super-admin"));
    expect(superAdmin.status).toBe(307);
    expect(superAdmin.headers.get("location")).toContain("/dashboard");
  });

  it("routes super admins to /super-admin and blocks church-only APIs", async () => {
    h.user = { email: "root@bentplanet.test" };

    const login = await middleware(req("/login"));
    expect(login.status).toBe(307);
    expect(login.headers.get("location")).toContain("/super-admin");

    const dash = await middleware(req("/dashboard"));
    expect(dash.status).toBe(307);
    expect(dash.headers.get("location")).toContain("/super-admin");

    const churchApi = await middleware(req("/api/broadcast"));
    expect(churchApi.status).toBe(403);

    const notifApi = await middleware(req("/api/notifications"));
    expect(notifApi.status).toBe(200); // allowed through; route scopes data
  });

  it("redirects signed-in users away from /login", async () => {
    h.user = { email: "admin@a.test" };
    const res = await middleware(req("/login"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
  });
});
