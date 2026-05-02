import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { DEFAULT_DEPARTMENTS } from "@/lib/agents/dto";
import { getOrgContext } from "@/lib/auth/admin";
import { getAllowedDepartments } from "@/lib/auth/dept-acl";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId || !ctx.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = ctx.activeOrgId;
  const db = supabaseAdmin();

  // Optional department filter. Validated against the seeded slugs but
  // we also accept any custom slug that exists in rgaios_agents - the
  // /departments page allows custom slugs and we want stats to stay
  // consistent. Slug not present anywhere just yields zeroed counts,
  // which is fine for an empty dept page.
  const url = req.nextUrl;
  const rawDept = url.searchParams.get("department");
  const department =
    typeof rawDept === "string" && rawDept.length > 0 ? rawDept : null;

  // Per-dept ACL. If the user is restricted (allowedDepartments != null)
  // we enforce two things:
  //   1. An explicit ?department=X must be in the allowed set, else 403.
  //   2. With no ?department, agent + run + approval lookups get scoped
  //      to the union of allowed depts via .in() on the agent department.
  const allowedDepts = await getAllowedDepartments({
    userId: ctx.userId,
    organizationId: orgId,
    isAdmin: ctx.isAdmin,
  });
  if (allowedDepts !== null && department && !allowedDepts.includes(department)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sevenDaysAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  // When scoped to a department (explicit or via ACL union) we resolve
  // the agent ids first, then use them as the filter for routine_runs
  // (via routines.assignee) and approvals (which already carry
  // agent_id). Doing the join in JS keeps the SQL portable across
  // postgrest's eq/in surface without inventing custom rpcs.
  let scopedAgentIds: string[] | null = null;
  let scopedRoutineIds: string[] | null = null;
  const aclDeptUnion =
    allowedDepts !== null && !department ? allowedDepts : null;
  if (department || aclDeptUnion) {
    let q = db
      .from("rgaios_agents")
      .select("id")
      .eq("organization_id", orgId);
    q = department ? q.eq("department", department) : q.in("department", aclDeptUnion!);
    const { data: deptAgents } = await q;
    scopedAgentIds = (deptAgents ?? []).map((r) => r.id as string);

    if (scopedAgentIds.length > 0) {
      const { data: deptRoutines } = await db
        .from("rgaios_routines")
        .select("id")
        .eq("organization_id", orgId)
        .in("assignee_agent_id", scopedAgentIds);
      scopedRoutineIds = (deptRoutines ?? []).map((r) => r.id as string);
    } else {
      scopedRoutineIds = [];
    }
  }

  // Build the four parallel queries. When scoping by department (single
  // slug OR ACL union) we constrain runs by routine ids and approvals by
  // agent ids. Empty scope short-circuits to zero counts so we don't
  // send an empty `.in()` (postgrest treats that as no filter).
  const isScoped = department !== null || aclDeptUnion !== null;
  let agentsQuery = db
    .from("rgaios_agents")
    .select("id, status", { count: "exact" })
    .eq("organization_id", orgId);
  if (department) {
    agentsQuery = agentsQuery.eq("department", department);
  } else if (aclDeptUnion) {
    agentsQuery = agentsQuery.in("department", aclDeptUnion);
  }

  const failedRunsPromise =
    isScoped && scopedRoutineIds && scopedRoutineIds.length === 0
      ? Promise.resolve({ count: 0 })
      : (() => {
          let q = db
            .from("rgaios_routine_runs")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId)
            .eq("status", "failed")
            .gte("created_at", sevenDaysAgo);
          if (isScoped && scopedRoutineIds && scopedRoutineIds.length > 0) {
            q = q.in("routine_id", scopedRoutineIds);
          }
          return q;
        })();

  const completedRunsPromise =
    isScoped && scopedRoutineIds && scopedRoutineIds.length === 0
      ? Promise.resolve({ count: 0 })
      : (() => {
          let q = db
            .from("rgaios_routine_runs")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId)
            .eq("status", "succeeded")
            .gte("created_at", sevenDaysAgo);
          if (isScoped && scopedRoutineIds && scopedRoutineIds.length > 0) {
            q = q.in("routine_id", scopedRoutineIds);
          }
          return q;
        })();

  const approvalsPromise =
    isScoped && scopedAgentIds && scopedAgentIds.length === 0
      ? Promise.resolve({ count: 0 })
      : (() => {
          let q = db
            .from("rgaios_approvals")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId)
            .eq("status", "pending");
          if (isScoped && scopedAgentIds && scopedAgentIds.length > 0) {
            q = q.in("agent_id", scopedAgentIds);
          }
          return q;
        })();

  const [agentsRes, failedRunsRes, approvalsRes, completedRunsRes] =
    await Promise.all([
      agentsQuery,
      failedRunsPromise,
      approvalsPromise,
      completedRunsPromise,
    ]);

  const agents = ("data" in agentsRes ? agentsRes.data : null) ?? [];
  const totalAgents = agents.length;
  const runningAgents = agents.filter(
    (a) => a.status === "running" || a.status === "idle",
  ).length;
  const activelyRunning = agents.filter((a) => a.status === "running").length;

  return NextResponse.json({
    activeAgents: runningAgents,
    totalAgents,
    activelyRunning,
    openIssues: failedRunsRes.count ?? 0,
    pendingApprovals: approvalsRes.count ?? 0,
    runsThisWeek: completedRunsRes.count ?? 0,
    department: department ?? null,
    knownDepartment:
      department === null
        ? null
        : (DEFAULT_DEPARTMENTS as readonly string[]).includes(department),
  });
}
