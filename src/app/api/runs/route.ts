import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { currentOrganizationId } from "@/lib/supabase/constants";

export const runtime = "nodejs";

/**
 * GET /api/runs
 * Query params:
 *   - limit   (default 50, max 200)
 *   - status  (optional filter)
 *   - routine_id (optional filter)
 *
 * Returns runs enriched with their routine title + assigned agent name,
 * joined in-process (small tenant count; one extra round-trip is cheap).
 */
export async function GET(req: NextRequest) {
  try {
    const organizationId = await currentOrganizationId();
    const url = new URL(req.url);
    const limit = Math.min(
      Number(url.searchParams.get("limit") ?? 50) || 50,
      200,
    );
    const status = url.searchParams.get("status");
    const routineId = url.searchParams.get("routine_id");

    const db = supabaseAdmin();

    let q = db
      .from("rgaios_routine_runs")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (status) {
      q = q.eq(
        "status",
        status as "pending" | "running" | "awaiting_approval" | "succeeded" | "failed",
      );
    }
    if (routineId) q = q.eq("routine_id", routineId);

    const { data: runs, error } = await q;
    if (error) throw new Error(error.message);
    if (!runs || runs.length === 0) return NextResponse.json({ runs: [] });

    const routineIds = Array.from(new Set(runs.map((r) => r.routine_id)));
    const { data: routines } = await db
      .from("rgaios_routines")
      .select("id, title, assignee_agent_id")
      .in("id", routineIds);
    const routineById = new Map((routines ?? []).map((r) => [r.id, r]));

    const agentIds = Array.from(
      new Set(
        (routines ?? [])
          .map((r) => r.assignee_agent_id)
          .filter((x): x is string => !!x),
      ),
    );
    const { data: agents } = agentIds.length
      ? await db
          .from("rgaios_agents")
          .select("id, name, role, title")
          .in("id", agentIds)
      : { data: [] };
    const agentById = new Map((agents ?? []).map((a) => [a.id, a]));

    const enriched = runs.map((run) => {
      const routine = routineById.get(run.routine_id);
      const agent = routine?.assignee_agent_id
        ? agentById.get(routine.assignee_agent_id)
        : null;
      return {
        ...run,
        routine: routine
          ? { id: routine.id, title: routine.title }
          : null,
        agent: agent
          ? { id: agent.id, name: agent.name, role: agent.role, title: agent.title }
          : null,
      };
    });

    return NextResponse.json({ runs: enriched });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
