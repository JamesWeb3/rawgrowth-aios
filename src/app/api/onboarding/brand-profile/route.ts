import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

export async function GET() {
  try {
    const ctx = await getOrgContext();
    if (!ctx?.activeOrgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = { id: ctx.activeOrgId, userId: ctx.userId };

    // Match what the executor's loadBrandVoice reads (highest-version
    // approved row). Without the status filter the UI would render an
    // unapproved 'ready' draft while runs use the previous approved one.
    const { data: profile } = await supabaseAdmin()
      .from("rgaios_brand_profiles")
      .select("*")
      .eq("organization_id", user.id)
      .eq("status", "approved")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({ profile });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
