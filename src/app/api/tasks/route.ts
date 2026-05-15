import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import {
  filterAgentsByDept,
  getAllowedDepartments,
} from "@/lib/auth/dept-acl";
import { supabaseAdmin } from "@/lib/supabase/server";
import { buildTaskResponse, type TaskRow } from "@/lib/tasks/dedupe";

export const runtime = "nodejs";

/**
 * GET /api/tasks
 *
 * Returns flattened (routine + latest run) view for the active org's
 * Tasks page. Used by the SWR-driven client so the list refreshes
 * every 5s without a full server re-render.
 *
 * `?include=delegations` opts back in the one-shot kind='delegation'
 * rows (agent_invoke holders + chat `<task>` blocks - see migration
 * 0069). By default they are excluded: a busy org racks up ~200 of
 * them as council-vote / re-task churn and they bury the real
 * routines. The delegation run history is still surfaced inside the
 * agent's orchestration cards, so excluding them here de-clutters
 * without losing genuinely useful task history.
 */
export async function GET(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId || !ctx.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = ctx.activeOrgId;
  const db = supabaseAdmin();

  const includeDelegations =
    new URL(req.url).searchParams.get("include") === "delegations";

  const allowedDepts = await getAllowedDepartments({
    userId: ctx.userId,
    organizationId: orgId,
    isAdmin: ctx.isAdmin,
  });

  let routinesQuery = db
    .from("rgaios_routines")
    .select(
      "id, title, description, assignee_agent_id, status, kind, created_at",
    )
    .eq("organization_id", orgId);
  if (!includeDelegations) {
    routinesQuery = routinesQuery.neq("kind", "delegation");
  }

  const [{ data: routinesRaw }, { data: agentsRaw }] = await Promise.all([
    routinesQuery.order("created_at", { ascending: false }).limit(200),
    db
      .from("rgaios_agents")
      .select("id, name, role, department")
      .eq("organization_id", orgId),
  ]);

  type AgentRow = {
    id: string;
    name: string;
    role: string | null;
    department: string | null;
  };
  type RoutineRow = {
    id: string;
    title: string | null;
    description: string | null;
    assignee_agent_id: string | null;
    status: string | null;
    kind: string | null;
    created_at: string | null;
  };
  const allAgents = (agentsRaw ?? []) as AgentRow[];
  const scopedAgents = filterAgentsByDept(allAgents, allowedDepts);
  const allowedAgentIds = new Set(scopedAgents.map((a) => a.id));
  const agentById = new Map(scopedAgents.map((a) => [a.id, a]));
  const routines = ((routinesRaw ?? []) as RoutineRow[]).filter((r) =>
    r.assignee_agent_id ? allowedAgentIds.has(r.assignee_agent_id) : ctx.isAdmin,
  );

  const routineIds = routines.map((r) => r.id);
  const { data: runsRaw } = routineIds.length
    ? await db
        .from("rgaios_routine_runs")
        .select(
          "id, routine_id, status, source, started_at, completed_at, created_at, output, error",
        )
        .eq("organization_id", orgId)
        .in("routine_id", routineIds)
        .order("created_at", { ascending: false })
        .limit(500)
    : { data: [] };
  type RunRow = {
    id: string;
    routine_id: string;
    status: string;
    source: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
    output: { reply?: string; executed_inline?: boolean } | null;
    error: string | null;
  };
  const runs = (runsRaw ?? []) as RunRow[];
  const runsByRoutine = new Map<string, RunRow[]>();
  for (const r of runs) {
    if (!runsByRoutine.has(r.routine_id)) runsByRoutine.set(r.routine_id, []);
    runsByRoutine.get(r.routine_id)!.push(r);
  }

  const rawTasks: TaskRow[] = routines.map((r) => {
    const taskRuns = runsByRoutine.get(r.id) ?? [];
    const lastRun = taskRuns[0] ?? null;
    const agent = r.assignee_agent_id ? agentById.get(r.assignee_agent_id) : null;
    return {
      routineId: r.id,
      title: r.title ?? "Untitled",
      description: r.description ?? null,
      kind: r.kind ?? "workflow",
      createdAt: r.created_at,
      assignee: agent
        ? { id: agent.id, name: agent.name, role: agent.role }
        : null,
      runCount: taskRuns.length,
      latestStatus: lastRun?.status ?? "pending",
      latestRunAt: lastRun?.created_at ?? null,
      // The two executor paths write different output shapes:
      // executeChatTask -> { reply }, executeRun (agent_invoke
      // delegations + scheduled routines) -> { text }. Reading only
      // .reply showed "No output recorded" on every executeRun task
      // that actually succeeded. Read the tolerant shape execAgentInvoke
      // already uses: reply ?? text ?? summary.
      latestOutput: (() => {
        const out = lastRun?.output as
          | { reply?: unknown; text?: unknown; summary?: unknown }
          | null
          | undefined;
        const v = out?.reply ?? out?.text ?? out?.summary;
        return typeof v === "string" && v.trim() ? v : null;
      })(),
      // Surface the error message for failed runs so /tasks gives the
      // operator a hint about WHY a routine failed instead of a blank
      // "Failed" badge. e2e audit found 87 failed runs with zero
      // visibility into the cause.
      latestError:
        lastRun?.status === "failed" && lastRun.error
          ? String(lastRun.error).slice(0, 500)
          : null,
    };
  });

  // Marti GAP #4: collapse near-duplicate titles inside a 60-minute
  // window and flag rows that carry a real deliverable (succeeded +
  // non-empty output). Counts are recomputed over the DEDUPED list so
  // the StatCards reflect what the operator actually sees.
  const tasks = buildTaskResponse(rawTasks, 60 * 60 * 1000);

  const counts = {
    total: tasks.length,
    pending: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
  };
  // Count by latest run status per routine, not total run volume.
  // Prevents failed > total when a routine ran many times.
  for (const t of tasks) {
    if (t.latestStatus === "pending") counts.pending += 1;
    else if (t.latestStatus === "running") counts.running += 1;
    else if (t.latestStatus === "succeeded") counts.succeeded += 1;
    else if (t.latestStatus === "failed") counts.failed += 1;
  }

  return NextResponse.json({ counts, tasks, includeDelegations });
}
