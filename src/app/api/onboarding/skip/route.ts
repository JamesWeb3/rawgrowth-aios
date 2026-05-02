import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/onboarding/skip
 * One-click "skip onboarding" - marks onboarding_completed=true on the
 * active org so the dashboard gate stops firing. The owner can come
 * back via the sidebar Onboarding link to redo it.
 */
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await supabaseAdmin()
    .from("rgaios_organizations")
    .update({ onboarding_completed: true } as never)
    .eq("id", ctx.activeOrgId);
  redirect("/");
}
