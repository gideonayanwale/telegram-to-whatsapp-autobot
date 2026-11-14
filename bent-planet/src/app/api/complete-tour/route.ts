import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireChurchApiUser } from "@/lib/api-auth";

import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const auth = await requireChurchApiUser();
    if (!auth.ok) return auth.response;

    const adminClient = createAdminClient();
    const church = auth.church;

    const body = await request.json();
    const { templatePreference, whatsappNumber } = body;

    const updates: Database["public"]["Tables"]["churches"]["Update"] = {
      onboarding_tour_completed: true,
    };

    if (templatePreference) {
      updates.theme_preference = templatePreference;
    }

    if (whatsappNumber) {
      updates.whatsapp_number = whatsappNumber;
    }

    const { error } = await adminClient
      .from("churches")
      .update(updates)
      .eq("id", church.id);

    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
