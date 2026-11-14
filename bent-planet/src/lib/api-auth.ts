import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isSuperAdmin } from "@/lib/auth";
import { getChurchByAdminEmail } from "@/lib/churches";
import { getCurrentUser } from "@/lib/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

type User = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
type ChurchRow = Database["public"]["Tables"]["churches"]["Row"];

/**
 * Authentication helpers for API route handlers.
 *
 * Unlike `requireChurchUser` (which redirects and is meant for pages), these
 * helpers return proper JSON 401/403 responses. They also never swallow
 * auth failures inside a route's try/catch: callers branch on `ok`.
 */

export type ApiUserAuth =
  | {
      ok: true;
      user: User;
      isSuperAdmin: boolean;
      /** The church workspace this call is scoped to (null for super admins
       *  acting at platform level). */
      church: ChurchRow | null;
      isImpersonating: boolean;
    }
  | { ok: false; response: NextResponse };

export type ChurchApiAuth =
  | { ok: true; user: User; church: ChurchRow; isImpersonating: boolean }
  | { ok: false; response: NextResponse };

export function apiError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Resolve the calling user. Super admins may impersonate a church via the
 * `impersonate_church_email` cookie, in which case `church` is set and
 * `isImpersonating` is true.
 *
 * - Unauthenticated -> 401
 */
export async function requireApiUser(): Promise<ApiUserAuth> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, response: apiError(401, "Authentication required.") };
  }

  if (isSuperAdmin(user.email)) {
    const cookieStore = cookies();
    const impersonateEmail = cookieStore.get("impersonate_church_email")?.value;

    if (!impersonateEmail) {
      return {
        ok: true,
        user,
        isSuperAdmin: true,
        church: null,
        isImpersonating: false,
      };
    }

    const adminClient = createAdminClient();
    const church = await getChurchByAdminEmail(adminClient, impersonateEmail);
    return {
      ok: true,
      user,
      isSuperAdmin: true,
      church,
      isImpersonating: true,
    };
  }

  const adminClient = createAdminClient();
  const church = await getChurchByAdminEmail(adminClient, user.email!);
  return {
    ok: true,
    user,
    isSuperAdmin: false,
    church,
    isImpersonating: false,
  };
}

/**
 * Resolve the calling user AND their church workspace, for church-only APIs.
 *
 * - Unauthenticated          -> 401
 * - Super admin (no cookie)  -> 403 (church-only APIs)
 * - Super admin impersonating-> scoped to the impersonated church
 * - Church admin without row -> 403
 */
export async function requireChurchApiUser(): Promise<ChurchApiAuth> {
  const auth = await requireApiUser();
  if (!auth.ok) return auth;

  if (auth.isSuperAdmin && !auth.isImpersonating) {
    return {
      ok: false,
      response: apiError(403, "Super admin cannot call church-only API routes."),
    };
  }

  if (!auth.church) {
    return { ok: false, response: apiError(403, "No church workspace is linked to this account.") };
  }

  return {
    ok: true,
    user: auth.user,
    church: auth.church,
    isImpersonating: auth.isImpersonating,
  };
}
