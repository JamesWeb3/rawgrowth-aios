import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

// Each value is a real JSONB column on rgaios_brand_intakes. Typing the map
// values as that table's column keys lets `col` narrow to a valid column
// name so the computed-key upsert below type-checks.
type IntakeColumn = keyof Database["public"]["Tables"]["rgaios_brand_intakes"]["Insert"];

const SECTION_TO_COLUMN: Record<string, IntakeColumn> = {
  basicInfo: "basic_info",
  socialPresence: "social_presence",
  originStory: "origin_story",
  businessModel: "business_model",
  targetAudience: "target_audience",
  goals: "goals",
  challenges: "challenges",
  brandVoice: "brand_voice",
  competitors: "competitors",
  contentMessaging: "content_messaging",
  sales: "sales",
  toolsSystems: "tools_systems",
  additionalContext: "additional_context",
};

export async function GET() {
  try {
    const ctx = await getOrgContext();
    if (!ctx?.activeOrgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = { id: ctx.activeOrgId, userId: ctx.userId };

    const { data: intake } = await supabaseAdmin()
      .from("rgaios_brand_intakes")
      .select("*")
      .eq("organization_id", user.id)
      .single();

    return NextResponse.json({ intake });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getOrgContext();
    if (!ctx?.activeOrgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = { id: ctx.activeOrgId, userId: ctx.userId };

    const { section_id, data } = await req.json();
    const col = SECTION_TO_COLUMN[section_id];
    if (!col) return NextResponse.json({ error: "Invalid section" }, { status: 400 });

    const upsertRow: Database["public"]["Tables"]["rgaios_brand_intakes"]["Insert"] =
      {
        organization_id: user.id,
        [col]: data,
      };

    await supabaseAdmin()
      .from("rgaios_brand_intakes")
      .upsert(upsertRow, { onConflict: "organization_id" });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
