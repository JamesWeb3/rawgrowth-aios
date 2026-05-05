import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/insights/[id]/reject body { reason?: string }
 *
 * Operator killed the proposed plan. Marks the insight rejected, logs
 * the reason for the trace timeline. The agent loop won't retry a
 * rejected insight - if the metric stays bad, the next sweep will
 * create a NEW insight from a fresh angle.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { reason?: string };

  const db = supabaseAdmin();
  const now = new Date().toISOString();
  const { error } = await db
    .from("rgaios_insights")
    .update({
      status: "rejected",
      rejected_at: now,
    } as never)
    .eq("organization_id", ctx.activeOrgId)
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await db.from("rgaios_audit_log").insert({
    organization_id: ctx.activeOrgId,
    kind: "insight_rejected",
    actor_type: "user",
    actor_id: ctx.userId ?? "unknown",
    detail: {
      insight_id: id,
      reason: body.reason ?? "(none provided)",
    },
  } as never);

  return NextResponse.json({ ok: true });
}
