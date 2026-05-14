import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { isDepartmentAllowed } from "@/lib/auth/dept-acl";
import { supabaseAdmin } from "@/lib/supabase/server";
import { executeChatTask } from "@/lib/agent/tasks";
import { isUuid } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * GET /api/tasks/[id]    -> routine + assignee + every run with full output
 * POST /api/tasks/[id]   -> kick a fresh run (re-run with same brief)
 * DELETE /api/tasks/[id] -> drop routine + cascading runs
 */

type RoutineRow = {
  id: string;
  title: string | null;
  description: string | null;
  assignee_agent_id: string | null;
  status: string | null;
  created_at: string | null;
};
type RunRow = {
  id: string;
  status: string;
  source: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  // executeChatTask writes { reply }, executeRun writes { text, ... },
  // execAgentInvoke can write { summary }. Read all three.
  output:
    | { reply?: string; text?: string; summary?: string; executed_inline?: boolean }
    | null;
  error: string | null;
};

async function loadRoutineWithACL(
  ctx: NonNullable<Awaited<ReturnType<typeof getOrgContext>>>,
  id: string,
): Promise<{ routine: RoutineRow; agent: { id: string; name: string; role: string | null; department: string | null } | null } | null> {
  if (!isUuid(id)) return null;
  const db = supabaseAdmin();
  const { data: routine } = await db
    .from("rgaios_routines")
    .select("id, title, description, assignee_agent_id, status, created_at")
    .eq("organization_id", ctx.activeOrgId!)
    .eq("id", id)
    .maybeSingle();
  if (!routine) return null;
  const r = routine as RoutineRow;
  let agent: { id: string; name: string; role: string | null; department: string | null } | null = null;
  if (r.assignee_agent_id) {
    // Defense-in-depth: routine itself was already org-scoped above,
    // and the FK on assignee_agent_id should keep cross-tenant rows
    // from existing in practice - but the FK is to agents(id) only,
    // not (id, organization_id). Add the explicit org filter so the
    // returned name/role/department block can never leak from another
    // org if a stale row ever slipped through.
    const { data: a } = await db
      .from("rgaios_agents")
      .select("id, name, role, department")
      .eq("id", r.assignee_agent_id)
      .eq("organization_id", ctx.activeOrgId!)
      .maybeSingle();
    // supabase-js collapses this .maybeSingle() row to `never`; the
    // select lists only real rgaios_agents columns, so a narrow typed
    // cast back to the loaded shape is safe.
    type AgentAclRow = { id: string; name: string; role: string | null; department: string | null };
    agent = (a as unknown as AgentAclRow | null) ?? null;
    const allowed = await isDepartmentAllowed(
      {
        userId: ctx.userId!,
        organizationId: ctx.activeOrgId!,
        isAdmin: ctx.isAdmin,
      },
      agent?.department ?? null,
    );
    if (!allowed) return null;
  }
  return { routine: r, agent };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId || !ctx.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const loaded = await loadRoutineWithACL(ctx, id);
  if (!loaded) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: runsRaw } = await supabaseAdmin()
    .from("rgaios_routine_runs")
    .select("id, status, source, started_at, completed_at, created_at, output, error")
    .eq("organization_id", ctx.activeOrgId)
    .eq("routine_id", id)
    .order("created_at", { ascending: false })
    .limit(20);
  const runs = (runsRaw ?? []) as RunRow[];

  return NextResponse.json({
    routine: loaded.routine,
    assignee: loaded.agent,
    runs: runs.map((r) => ({
      id: r.id,
      status: r.status,
      source: r.source,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      createdAt: r.created_at,
      output: (() => {
        const v = r.output?.reply ?? r.output?.text ?? r.output?.summary;
        return typeof v === "string" && v.trim() ? v : null;
      })(),
      error: r.error,
    })),
  });
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId || !ctx.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const loaded = await loadRoutineWithACL(ctx, id);
  if (!loaded) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!loaded.routine.assignee_agent_id) {
    return NextResponse.json(
      { error: "task has no assignee agent - re-run not supported" },
      { status: 400 },
    );
  }

  const { data: run } = await supabaseAdmin()
    .from("rgaios_routine_runs")
    .insert({
      organization_id: ctx.activeOrgId,
      routine_id: id,
      source: "manual_rerun",
      status: "pending",
      input_payload: { title: loaded.routine.title, manual_rerun: true } as never,
    } as never)
    .select("id")
    .single();
  const runId = (run as { id: string } | null)?.id;
  if (!runId) {
    return NextResponse.json({ error: "failed to insert run" }, { status: 500 });
  }

  // Fire the executor inline (don't await - return fast). Falls back
  // to direct execution outside Next request scope.
  void executeChatTask({
    orgId: ctx.activeOrgId,
    runId,
    assigneeAgentId: loaded.routine.assignee_agent_id,
    title: loaded.routine.title ?? "Re-run",
    description: loaded.routine.description ?? "",
    delegatedByAgentId: ctx.userId,
  });

  return NextResponse.json({ ok: true, runId }, { status: 202 });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId || !ctx.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const loaded = await loadRoutineWithACL(ctx, id);
  if (!loaded) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { error } = await supabaseAdmin()
    .from("rgaios_routines")
    .delete()
    .eq("organization_id", ctx.activeOrgId)
    .eq("id", id);
  if (error) {
    console.error("[tasks DELETE] supabase error", error.message);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
