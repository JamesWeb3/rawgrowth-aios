import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { badUuidResponse } from "@/lib/utils";

export const runtime = "nodejs";

/**
 * GET /api/agents/[id]/plan
 *
 * The agent's current durable plan, for the AgentPlanPanel in the chat
 * tab. plan_create / plan_update / plan_get (the MCP tools backed by
 * rgaios_plans) gave the orchestrator a durable plan store but there
 * was no UI surface for it - this is that surface's data source.
 *
 * Returns the org's most-recently-updated `active` plan owned by this
 * agent, or { plan: null } when there is none. Org-scoped via
 * currentOrganizationId() so one tenant can never read another's plan
 * even though supabaseAdmin() bypasses RLS.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const bad = badUuidResponse(id);
    if (bad) return bad;

    const orgId = await currentOrganizationId();
    const { data, error } = await supabaseAdmin()
      .from("rgaios_plans")
      .select("id, goal, steps, status, owner_agent_id, updated_at")
      .eq("organization_id", orgId)
      .eq("owner_agent_id", id)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[agents/plan GET] error", error.message);
      return NextResponse.json({ error: "internal error" }, { status: 500 });
    }

    return NextResponse.json({ plan: data ?? null });
  } catch (err) {
    const msg = (err as Error).message;
    console.error("[agents/plan GET] error", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
