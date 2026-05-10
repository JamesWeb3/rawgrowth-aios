import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth/admin";
import { getAllowedDepartments } from "@/lib/auth/dept-acl";
import { RUN_STATUSES, type RunStatus } from "@/lib/runs/constants";
import { isUuid } from "@/lib/utils";

export const runtime = "nodejs";

const VALID_RUN_STATUSES = new Set<string>(RUN_STATUSES);

/**
 * GET /api/runs
 * Query params:
 *   - limit   (default 50, max 200)
 *   - status  (optional filter)
 *   - routine_id (optional filter)
 *
 * Returns runs enriched with their routine title + assigned agent name,
 * joined in-process (small tenant count; one extra round-trip is cheap).
 *
 * Per-dept ACL: invitees with allowed_departments only see runs whose
 * routine's assignee_agent.department is in their allowed set. Admin
 * + unrestricted members see all. Mirrors /api/approvals.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await getOrgContext();
    if (!ctx?.activeOrgId || !ctx.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const organizationId = ctx.activeOrgId;
    const url = new URL(req.url);
    // Clamp to [1, 200]. Without the lower bound a "limit=-10" query
    // string makes Postgres throw "LIMIT must not be negative".
    const limit = Math.max(
      1,
      Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200),
    );
    const status = url.searchParams.get("status");
    const routineId = url.searchParams.get("routine_id");
    if (status && !VALID_RUN_STATUSES.has(status)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }
    if (routineId && !isUuid(routineId)) {
      return NextResponse.json({ error: "invalid routine_id" }, { status: 400 });
    }

    const db = supabaseAdmin();

    let q = db
      .from("rgaios_routine_runs")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (status) {
      q = q.eq("status", status as RunStatus);
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
          .select("id, name, role, title, department")
          .in("id", agentIds)
      : { data: [] };
    const agentById = new Map((agents ?? []).map((a) => [a.id, a]));

    // Per-dept ACL filter (mirrors /api/approvals). Resolve allowed
    // departments once; null means unrestricted (admin or no membership
    // restriction). Runs whose routine has no assignee or whose agent
    // department isn't in the allowed set get dropped.
    const allowedDepts = await getAllowedDepartments({
      userId: ctx.userId,
      organizationId,
      isAdmin: ctx.isAdmin,
    });

    const enriched = runs
      .map((run) => {
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
            ? {
                id: agent.id,
                name: agent.name,
                role: agent.role,
                title: agent.title,
              }
            : null,
          _agentDept: agent?.department ?? null,
        };
      })
      .filter((row) => {
        if (allowedDepts === null) return true;
        return row._agentDept ? allowedDepts.includes(row._agentDept) : false;
      })
      .map(({ _agentDept: _drop, ...rest }) => rest);

    return NextResponse.json({ runs: enriched });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
