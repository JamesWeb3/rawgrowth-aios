import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { isUuid } from "@/lib/utils";

export const runtime = "nodejs";

/**
 * GET /api/insights/[id]/trace
 *
 * Builds a unified timeline of every action chained to a single
 * insight: agent generation, task spawn (cascading sub-agents),
 * task executions with output, retries (loop_count bumps), and
 * resolution. Lets the operator see the full "agent did X then
 * agent Y did Z" chain.
 *
 * Sources stitched:
 *   - rgaios_insights row (created + retries + resolved_at)
 *   - rgaios_audit_log (task_created, task_executed, insight_resolved,
 *     claude_max_token_refreshed in window)
 *   - rgaios_routine_runs (per spawned task: status, output, timing)
 *   - rgaios_agents (resolve names)
 */
export async function GET(
  _req: NextRequest,
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
  const db = supabaseAdmin();

  // Step 1: fetch insight (required to compute the audit window)
  const { data: insight } = await db
    .from("rgaios_insights")
    .select(
      "id, department, severity, metric, title, reason, suggested_action, status, loop_count, last_attempt_at, created_at, resolved_at, generated_by_agent_id",
    )
    .eq("organization_id", ctx.activeOrgId)
    .eq("id", id)
    .maybeSingle();
  if (!insight) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const ins = insight as {
    id: string;
    department: string | null;
    severity: string;
    metric: string;
    title: string;
    reason: string | null;
    suggested_action: string | null;
    status: string;
    loop_count: number;
    last_attempt_at: string | null;
    created_at: string;
    resolved_at: string | null;
    generated_by_agent_id: string | null;
  };
  const windowStart = ins.created_at;
  const windowEnd = ins.resolved_at ?? new Date().toISOString();

  // Step 2: parallel fetch
  //   - taggedRows: audit rows pinned to this insight_id (exact)
  //   - windowRows: task_created/executed in time window (heuristic)
  //   - allOrgAgents: org-wide agent name lookup (small table, indexed)
  type AuditRow = {
    id: string;
    ts: string;
    kind: string;
    actor_type: string | null;
    actor_id: string | null;
    detail: Record<string, unknown> | null;
  };
  type AgentRow = { id: string; name: string; role: string | null };
  const [taggedRes, windowRes, agentsRes] = await Promise.all([
    db
      .from("rgaios_audit_log")
      .select("id, ts, kind, actor_type, actor_id, detail")
      .eq("organization_id", ctx.activeOrgId)
      .filter("detail->>insight_id", "eq", id)
      .order("ts", { ascending: true }),
    db
      .from("rgaios_audit_log")
      .select("id, ts, kind, actor_type, actor_id, detail")
      .eq("organization_id", ctx.activeOrgId)
      .in("kind", ["task_created", "task_executed"])
      .gte("ts", windowStart)
      .lte("ts", windowEnd)
      .order("ts", { ascending: true }),
    db
      .from("rgaios_agents")
      .select("id, name, role")
      .eq("organization_id", ctx.activeOrgId),
  ]);
  const audit = [
    ...((taggedRes.data ?? []) as AuditRow[]),
    ...((windowRes.data ?? []) as AuditRow[]),
  ];
  const agentNames = new Map<string, string>();
  for (const a of (agentsRes.data ?? []) as AgentRow[]) {
    agentNames.set(a.id, `${a.name}${a.role ? ` (${a.role})` : ""}`);
  }

  // Step 3: collect routine ids from audit, then parallel fetch routines + their runs
  const relevantRoutineIds = new Set<string>();
  for (const a of audit) {
    if (a.kind !== "task_created") continue;
    const ridDetail = a.detail?.routine_id;
    if (typeof ridDetail === "string") relevantRoutineIds.add(ridDetail);
  }
  type RoutineRow = {
    id: string;
    title: string;
    assignee_agent_id: string | null;
    created_at: string;
  };
  type RunRow = {
    id: string;
    routine_id: string;
    status: string;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
    output: { reply?: string } | null;
    error: string | null;
  };
  let relevantRoutines: RoutineRow[] = [];
  let runs: RunRow[] = [];
  if (relevantRoutineIds.size > 0) {
    const ids = [...relevantRoutineIds];
    const [routinesRes, runsRes] = await Promise.all([
      db
        .from("rgaios_routines")
        .select("id, title, assignee_agent_id, created_at")
        .eq("organization_id", ctx.activeOrgId)
        .in("id", ids),
      db
        .from("rgaios_routine_runs")
        .select(
          "id, routine_id, status, started_at, completed_at, created_at, output, error",
        )
        .eq("organization_id", ctx.activeOrgId)
        .in("routine_id", ids),
    ]);
    relevantRoutines = (routinesRes.data ?? []) as RoutineRow[];
    runs = (runsRes.data ?? []) as RunRow[];
  }

  // Build the timeline event list
  type TimelineEvent = {
    ts: string;
    kind: string;
    label: string;
    detail: string;
    actor: string | null;
    routineId?: string;
    output?: string;
    runStatus?: string;
  };
  const timeline: TimelineEvent[] = [];

  // 1. Insight created
  timeline.push({
    ts: ins.created_at,
    kind: "insight_created",
    label: `Anomaly detected: ${ins.title}`,
    detail: ins.reason ?? "",
    actor: ins.generated_by_agent_id
      ? (agentNames.get(ins.generated_by_agent_id) ?? "agent")
      : "system",
  });

  // 2. Each task spawn + each task execution
  const runsByRoutine = new Map<string, RunRow[]>();
  for (const r of runs) {
    if (!runsByRoutine.has(r.routine_id)) runsByRoutine.set(r.routine_id, []);
    runsByRoutine.get(r.routine_id)!.push(r);
  }
  for (const r of relevantRoutines) {
    const assignee = r.assignee_agent_id
      ? (agentNames.get(r.assignee_agent_id) ?? "agent")
      : "unassigned";
    timeline.push({
      ts: r.created_at,
      kind: "task_spawned",
      label: `Task assigned: ${r.title}`,
      detail: "",
      actor: assignee,
      routineId: r.id,
    });
    for (const run of runsByRoutine.get(r.id) ?? []) {
      timeline.push({
        ts: run.completed_at ?? run.started_at ?? run.created_at,
        kind:
          run.status === "succeeded"
            ? "task_done"
            : run.status === "failed"
              ? "task_failed"
              : "task_progress",
        label:
          run.status === "succeeded"
            ? `Task done: ${r.title}`
            : run.status === "failed"
              ? `Task failed: ${r.title}`
              : `Task ${run.status}: ${r.title}`,
        detail: run.error ?? "",
        actor: assignee,
        routineId: r.id,
        output: run.output?.reply ?? undefined,
        runStatus: run.status,
      });
    }
  }

  // 3. Retries - one event per insight_retried audit row (covers
  // every loop iteration, not just the latest)
  for (const a of audit) {
    if (a.kind !== "insight_retried") continue;
    const attempt = (a.detail?.attempt as number | undefined) ?? null;
    timeline.push({
      ts: a.ts,
      kind: "retry",
      label: attempt
        ? `Retry ${attempt} - new angle`
        : "Retry - new angle",
      detail:
        "Previous plan didn't recover the metric. Agent proposed a different approach.",
      actor: a.actor_id
        ? (agentNames.get(a.actor_id) ?? "agent")
        : "system",
    });
  }

  // 4. Resolution
  if (ins.resolved_at) {
    timeline.push({
      ts: ins.resolved_at,
      kind: "resolved",
      label: "Metric recovered",
      detail: "Anomaly closed automatically by the loop check.",
      actor: "system",
    });
  }

  timeline.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

  return NextResponse.json(
    {
      insight: ins,
      timeline,
      counts: {
        tasks: relevantRoutines.length,
        runs: runs.length,
        succeeded: runs.filter((r) => r.status === "succeeded").length,
        failed: runs.filter((r) => r.status === "failed").length,
      },
    },
    {
      headers: {
        // Lightweight CDN/edge SWR: serve cached for 5s, allow stale up
        // to 30s while revalidating. Cuts repeat opens of the drawer.
        "cache-control": "private, max-age=5, stale-while-revalidate=30",
      },
    },
  );
}
