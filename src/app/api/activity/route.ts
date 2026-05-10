import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/activity?limit=20
 *
 * Recent audit_log events for this org, newest first. Drives the live
 * log overlay used during demo recordings + the future Activity tab
 * stream view.
 */
export async function GET(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Coerce ?limit=foo (NaN) and missing param back to the 20 default;
  // PostgREST rejects .limit(NaN) with a 400 otherwise.
  const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? 20);
  const limit = Math.min(50, Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 20);

  const { data, error } = await supabaseAdmin()
    .from("rgaios_audit_log")
    .select("id, ts, kind, actor_type, actor_id, detail")
    .eq("organization_id", ctx.activeOrgId)
    .order("ts", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ events: data ?? [] });
}
