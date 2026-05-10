import { NextResponse, type NextRequest } from "next/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { replaceSkillAssignments } from "@/lib/skills/queries";
import { getSkill } from "@/lib/skills/catalog";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * PUT /api/skills/[id]/assignments
 * Body: { agentIds: string[] }
 *
 * Full-set replacement. Whatever agentIds you send become the authoritative
 * list for this skill. To unassign, send the list without that agent in it.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!getSkill(id)) {
      return NextResponse.json({ error: "Unknown skill" }, { status: 404 });
    }
    const body = (await req.json()) as { agentIds?: unknown };
    if (!Array.isArray(body.agentIds)) {
      return NextResponse.json(
        { error: "agentIds array required" },
        { status: 400 },
      );
    }
    const agentIds = body.agentIds.filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    );

    const orgId = await currentOrganizationId();

    // Cross-tenant guard. Migration 0012 has independent FKs on
    // (agent_id) and (organization_id) but no compound check that the
    // pair is consistent. Without this, a forged client request could
    // pollute another org's skill catalog with rows whose agent_id
    // points at a foreign org. Verify every requested agent_id belongs
    // to caller's org BEFORE writing any rows.
    if (agentIds.length > 0) {
      const { data: ownAgents, error: agentsErr } = await supabaseAdmin()
        .from("rgaios_agents")
        .select("id")
        .in("id", agentIds)
        .eq("organization_id", orgId);
      if (agentsErr) {
        return NextResponse.json(
          { error: agentsErr.message },
          { status: 500 },
        );
      }
      const ownSet = new Set(
        ((ownAgents ?? []) as Array<{ id: string }>).map((r) => r.id),
      );
      const foreign = agentIds.filter((aid) => !ownSet.has(aid));
      if (foreign.length > 0) {
        return NextResponse.json(
          { error: "agent not in your organization" },
          { status: 403 },
        );
      }
    }

    await replaceSkillAssignments(orgId, id, agentIds);
    return NextResponse.json({ ok: true, count: agentIds.length });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
