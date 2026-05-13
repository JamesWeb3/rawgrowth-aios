import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/orchestration/trace
 *
 * Unified orchestration timeline: stitches routine_runs + audit_log +
 * approvals into one chronological stream. Powers the /trace page.
 *
 * Query params:
 *   window_minutes  - default 30, hard cap 1440
 *   agent_id        - optional filter
 *   routine_id      - optional filter (matches via run.routine_id or
 *                     audit detail.routine_id)
 */

type Actor = {
  type: "agent" | "user" | "system";
  id: string | null;
  name: string;
};

type Tool = {
  name: string;
  app: string | null;
  action: string | null;
} | null;

type TimelineItem = {
  ts: string;
  kind:
    | "routine_triggered"
    | "routine_completed"
    | "agent_spawned_task"
    | "tool_call_queued"
    | "tool_call_executed"
    | "approval_reviewed"
    | "telegram_inbound"
    | "chat_message"
    | "audit";
  actor: Actor;
  routine: { id: string; title: string | null } | null;
  tool: Tool;
  detail: Record<string, unknown> | string | null;
  sourceId: string;
};

type RunRow = {
  id: string;
  routine_id: string;
  source: string;
  status: string;
  output: Record<string, unknown> | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

type AuditRow = {
  id: string;
  ts: string;
  kind: string;
  actor_type: string | null;
  actor_id: string | null;
  detail: Record<string, unknown> | null;
};

type ApprovalRow = {
  id: string;
  agent_id: string | null;
  routine_run_id: string | null;
  tool_name: string;
  tool_args: Record<string, unknown>;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

type AgentRow = { id: string; name: string };
type RoutineRow = { id: string; title: string };

const DETAIL_MAX_CHARS = 1200;

function truncate(value: unknown): Record<string, unknown> | string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    return value.length > DETAIL_MAX_CHARS
      ? `${value.slice(0, DETAIL_MAX_CHARS)}...`
      : value;
  }
  if (typeof value !== "object") return String(value);
  try {
    const json = JSON.stringify(value);
    if (json.length <= DETAIL_MAX_CHARS) {
      return value as Record<string, unknown>;
    }
    return `${json.slice(0, DETAIL_MAX_CHARS)}...`;
  } catch {
    return null;
  }
}

function parseToolName(name: string): { app: string | null; action: string | null } {
  // Convention in this repo: "<app>_<action>" (telegram_reply,
  // slack_post_message, gmail_draft, ...). Fall back to single-token names.
  const idx = name.indexOf("_");
  if (idx < 0) return { app: name, action: null };
  return { app: name.slice(0, idx), action: name.slice(idx + 1) };
}

function classifyAuditKind(kind: string): TimelineItem["kind"] {
  if (kind.startsWith("approval_")) return "approval_reviewed";
  if (kind.startsWith("telegram_")) return "telegram_inbound";
  if (kind === "task_created") return "agent_spawned_task";
  if (kind === "task_executed") return "tool_call_executed";
  if (kind === "chat_memory" || kind === "chat_message") return "chat_message";
  return "audit";
}

export async function GET(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const rawWindow = Number(url.searchParams.get("window_minutes") ?? "30");
  const windowMinutes =
    Number.isFinite(rawWindow) && rawWindow > 0
      ? Math.min(Math.floor(rawWindow), 1440)
      : 30;
  const agentIdFilter = url.searchParams.get("agent_id") ?? null;
  const routineIdFilter = url.searchParams.get("routine_id") ?? null;

  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const db = supabaseAdmin();

  // Parallel fan-out: runs, audit, approvals, agents.
  const [runsRes, auditRes, approvalsRes, agentsRes] = await Promise.all([
    db
      .from("rgaios_routine_runs")
      .select(
        "id, routine_id, source, status, output, error, started_at, completed_at, created_at",
      )
      .eq("organization_id", ctx.activeOrgId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(200),
    db
      .from("rgaios_audit_log")
      .select("id, ts, kind, actor_type, actor_id, detail")
      .eq("organization_id", ctx.activeOrgId)
      .gte("ts", since)
      .order("ts", { ascending: false })
      .limit(500),
    db
      .from("rgaios_approvals")
      .select(
        "id, agent_id, routine_run_id, tool_name, tool_args, reason, status, reviewed_by, reviewed_at, created_at",
      )
      .eq("organization_id", ctx.activeOrgId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(200),
    db
      .from("rgaios_agents")
      .select("id, name")
      .eq("organization_id", ctx.activeOrgId),
  ]);

  const runs = (runsRes.data ?? []) as RunRow[];
  const audit = (auditRes.data ?? []) as AuditRow[];
  const approvals = (approvalsRes.data ?? []) as ApprovalRow[];
  const agents = (agentsRes.data ?? []) as AgentRow[];

  const agentName = new Map<string, string>();
  for (const a of agents) agentName.set(a.id, a.name);

  // Resolve routine titles for any routine_id we saw.
  const routineIds = new Set<string>();
  for (const r of runs) routineIds.add(r.routine_id);
  for (const a of audit) {
    const rid = a.detail?.routine_id;
    if (typeof rid === "string") routineIds.add(rid);
  }
  const routineTitle = new Map<string, string>();
  if (routineIds.size > 0) {
    const { data: routines } = await db
      .from("rgaios_routines")
      .select("id, title")
      .eq("organization_id", ctx.activeOrgId)
      .in("id", [...routineIds]);
    for (const r of (routines ?? []) as RoutineRow[]) {
      routineTitle.set(r.id, r.title);
    }
  }

  // Map approval routine_run_id -> agent_id and -> routine_id so
  // approval rows can carry routine context even without joins.
  const runAgent = new Map<string, string | null>();
  const runRoutine = new Map<string, string>();
  for (const r of runs) {
    runRoutine.set(r.id, r.routine_id);
  }
  // Best-effort: approval.agent_id is already on the row; nothing else needed.
  // (Left here to make the data flow explicit if a routine_runs.assignee
  // backfill ever lands.)
  void runAgent;

  const items: TimelineItem[] = [];

  // 1. Routine runs - emit a "triggered" item plus a "completed" item
  //    when the run reached a terminal status.
  for (const r of runs) {
    const routine = {
      id: r.routine_id,
      title: routineTitle.get(r.routine_id) ?? null,
    };
    items.push({
      ts: r.created_at,
      kind: "routine_triggered",
      actor: {
        type: r.source === "telegram" ? "user" : "system",
        id: null,
        name: r.source,
      },
      routine,
      tool: null,
      detail: truncate({ status: r.status, source: r.source }),
      sourceId: `run:${r.id}:triggered`,
    });
    if (r.completed_at && (r.status === "succeeded" || r.status === "failed")) {
      items.push({
        ts: r.completed_at,
        kind: "routine_completed",
        actor: { type: "system", id: null, name: r.status },
        routine,
        tool: null,
        detail: truncate({
          status: r.status,
          error: r.error,
          output: r.output,
        }),
        sourceId: `run:${r.id}:completed`,
      });
    }
  }

  // 2. Audit log - one item each, classified into kind.
  for (const a of audit) {
    const kind = classifyAuditKind(a.kind);
    const detailRid =
      typeof a.detail?.routine_id === "string"
        ? (a.detail.routine_id as string)
        : null;
    const routine = detailRid
      ? { id: detailRid, title: routineTitle.get(detailRid) ?? null }
      : null;
    const toolNameRaw =
      typeof a.detail?.tool_name === "string"
        ? (a.detail.tool_name as string)
        : null;
    const tool: Tool = toolNameRaw
      ? { name: toolNameRaw, ...parseToolName(toolNameRaw) }
      : null;
    const actorType: Actor["type"] =
      a.actor_type === "agent"
        ? "agent"
        : a.actor_type === "user"
          ? "user"
          : "system";
    const actorName =
      a.actor_id && agentName.get(a.actor_id)
        ? agentName.get(a.actor_id)!
        : (a.actor_type ?? "system");
    items.push({
      ts: a.ts,
      kind,
      actor: { type: actorType, id: a.actor_id, name: actorName },
      routine,
      tool,
      detail: truncate({ audit_kind: a.kind, ...a.detail }),
      sourceId: `audit:${a.id}`,
    });
  }

  // 3. Approvals - emit "tool_call_queued" at create, plus
  //    "approval_reviewed" if a decision was recorded on the row.
  for (const ap of approvals) {
    const parsed = parseToolName(ap.tool_name);
    const tool: Tool = { name: ap.tool_name, ...parsed };
    const routineId = ap.routine_run_id
      ? (runRoutine.get(ap.routine_run_id) ?? null)
      : null;
    const routine = routineId
      ? { id: routineId, title: routineTitle.get(routineId) ?? null }
      : null;
    const agentActorName = ap.agent_id
      ? (agentName.get(ap.agent_id) ?? "agent")
      : "agent";
    items.push({
      ts: ap.created_at,
      kind: "tool_call_queued",
      actor: { type: "agent", id: ap.agent_id, name: agentActorName },
      routine,
      tool,
      detail: truncate({
        approval_id: ap.id,
        status: ap.status,
        reason: ap.reason,
        tool_args: ap.tool_args,
      }),
      sourceId: `approval:${ap.id}:queued`,
    });
    if (ap.reviewed_at && ap.status !== "pending") {
      items.push({
        ts: ap.reviewed_at,
        kind: "approval_reviewed",
        actor: { type: "user", id: ap.reviewed_by, name: "reviewer" },
        routine,
        tool,
        detail: truncate({
          approval_id: ap.id,
          decision: ap.status,
        }),
        sourceId: `approval:${ap.id}:reviewed`,
      });
    }
  }

  // Apply filters.
  const filtered = items.filter((it) => {
    if (agentIdFilter && it.actor.id !== agentIdFilter) return false;
    if (routineIdFilter && it.routine?.id !== routineIdFilter) return false;
    return true;
  });

  filtered.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));

  return NextResponse.json({
    items: filtered,
    fetchedAt: new Date().toISOString(),
    windowMinutes,
  });
}
