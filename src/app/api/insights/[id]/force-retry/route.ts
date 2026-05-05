import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { retryInsight } from "@/lib/insights/generator";

export const runtime = "nodejs";
export const maxDuration = 90;

/**
 * POST /api/insights/[id]/force-retry
 *
 * Demo / debug endpoint. Bypasses the cooldown + cap checks in
 * checkAndRetryOpen and fires retryInsight directly so the user can
 * watch the autoresearch loop iterate ON DEMAND (instead of waiting 30
 * minutes for the natural cron tick).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const db = supabaseAdmin();

  const { data: row } = await db
    .from("rgaios_insights")
    .select("id, department, metric, loop_count, status")
    .eq("organization_id", ctx.activeOrgId)
    .eq("id", id)
    .maybeSingle();
  const ins = row as {
    id: string;
    department: string | null;
    metric: string;
    loop_count: number | null;
    status: string;
  } | null;
  if (!ins) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    await retryInsight(
      ctx.activeOrgId,
      ins.id,
      ins.department,
      ins.metric,
      ins.loop_count ?? 0,
      ins.status === "executing"
        ? "Forced retry by operator. Try a different angle than your prior attempt."
        : undefined,
    );
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
