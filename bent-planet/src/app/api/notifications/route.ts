import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiError, requireApiUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const MAX_MARK_READ_IDS = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/notifications — fetch for current church (or platform alerts for super admin)
export async function GET() {
  try {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;

    const adminClient = createAdminClient();

    let query = adminClient
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (auth.isSuperAdmin && !auth.isImpersonating) {
      // Super admin sees notifications where church_id IS NULL (platform-level alerts)
      query = query.is("church_id", null);
    } else {
      // Church admins (and impersonating super admins) only see their own
      // church's rows. A missing church row scopes to nothing.
      query = query.eq("church_id", auth.church?.id ?? "");
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return NextResponse.json({ notifications: data || [] });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH /api/notifications — mark notification(s) as read, scoped to the caller's church
export async function PATCH(request: Request) {
  try {
    const auth = await requireApiUser();
    if (!auth.ok) return auth.response;

    const { ids } = await request.json();
    if (!ids || !Array.isArray(ids)) {
      return NextResponse.json({ error: "ids array required" }, { status: 400 });
    }
    if (ids.length === 0 || ids.length > MAX_MARK_READ_IDS) {
      return apiError(400, `ids must contain between 1 and ${MAX_MARK_READ_IDS} entries.`);
    }
    const invalid = ids.some((id: unknown) => typeof id !== "string" || !UUID_RE.test(id));
    if (invalid) {
      return apiError(400, "Every id must be a valid notification UUID.");
    }

    const adminClient = createAdminClient();

    // Ownership scoping: church users may only update rows of their own
    // church; super admins may only touch platform rows unless impersonating.
    let scoped = adminClient
      .from("notifications")
      .update({ read: true } as any)
      .in("id", ids as string[]);

    if (auth.isSuperAdmin && !auth.isImpersonating) {
      scoped = scoped.is("church_id", null);
    } else {
      scoped = scoped.eq("church_id", auth.church?.id ?? "");
    }

    const { data, error } = await scoped.select("id");
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, updated: data ? data.length : 0 });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
