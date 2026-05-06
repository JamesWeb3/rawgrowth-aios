import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { isUuid } from "@/lib/utils";

export const runtime = "nodejs";

/**
 * PATCH /api/insights/[id] body { status: "acknowledged" | "dismissed" }
 *   acknowledged: greys out but stays visible
 *   dismissed:    hidden from list, won't regenerate for 24h
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as { status?: string };
  const status = body.status;
  if (status !== "acknowledged" && status !== "dismissed") {
    return NextResponse.json(
      { error: "status must be acknowledged or dismissed" },
      { status: 400 },
    );
  }
  const now = new Date().toISOString();
  const update: Record<string, unknown> = { status };
  if (status === "acknowledged") update.acknowledged_at = now;
  if (status === "dismissed") update.dismissed_at = now;
  // Use .select to detect "not found" (zero rows updated) and return 404
  // instead of silently 200-OK on a nonexistent / cross-tenant id.
  const { data, error } = await supabaseAdmin()
    .from("rgaios_insights")
    .update(update as never)
    .eq("organization_id", ctx.activeOrgId)
    .eq("id", id)
    .select("id");
  if (error) {
    console.error("[insights PATCH] supabase error", error.message);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
