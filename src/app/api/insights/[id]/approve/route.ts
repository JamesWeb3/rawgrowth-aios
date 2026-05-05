import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { chatReply } from "@/lib/agent/chat";
import { extractAndCreateTasks } from "@/lib/agent/tasks";
import { buildAgentChatPreamble } from "@/lib/agent/preamble";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/insights/[id]/approve
 *
 * Operator clicks "Approve plan" on an insight card. The dept-head
 * agent that drilled the anomaly is asked to EXECUTE the suggested
 * plan it proposed - it spawns the underlying tasks via <task> blocks
 * (extracted by extractAndCreateTasks). The insight flips to
 * "approved" status with approved_at timestamp + audit trail.
 *
 * This is the agentic loop the operator gates: see anomaly → see
 * proposed plan → approve → agent executes + reports back via the
 * trace timeline (spawned routines + their runs flow through trace).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const db = supabaseAdmin();

  const { data: insight } = await db
    .from("rgaios_insights")
    .select(
      "id, department, severity, metric, title, reason, suggested_action, status, generated_by_agent_id",
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
    generated_by_agent_id: string | null;
  };
  if (!ins.generated_by_agent_id) {
    return NextResponse.json(
      { error: "insight has no generating agent to execute the plan" },
      { status: 422 },
    );
  }

  // Look up the agent + org for chatReply call
  const { data: agent } = await db
    .from("rgaios_agents")
    .select("id, name")
    .eq("id", ins.generated_by_agent_id)
    .eq("organization_id", ctx.activeOrgId)
    .maybeSingle();
  const a = agent as { id: string; name: string } | null;
  if (!a) {
    return NextResponse.json(
      { error: "generating agent no longer exists in this org" },
      { status: 422 },
    );
  }
  const { data: org } = await db
    .from("rgaios_organizations")
    .select("name")
    .eq("id", ctx.activeOrgId)
    .maybeSingle();
  const orgName = (org as { name: string } | null)?.name ?? null;

  // Ask the agent to EXECUTE the plan it already proposed. Force <task>
  // block emission. Re-injects the plan it already proposed so the
  // agent stays consistent across approve cycles.
  const userMessage = `APPROVED. Execute the plan you proposed for the anomaly:

ANOMALY: ${ins.title}
DEPARTMENT: ${ins.department ?? "cross-dept"}
SEVERITY: ${ins.severity}
ROOT CAUSE: ${ins.reason ?? "(unset)"}
PLAN: ${ins.suggested_action ?? "(unset)"}

Spawn the concrete tasks needed to actually ship the plan. Use <task assignee="..."> blocks - one per concrete deliverable. Each task must have a clear deliverable the operator can SEE. Delegate to sub-agents where appropriate (you're a dept head; pull copywriters, media-buyers, etc into the work).

Keep your reply VISIBLE part to 1-2 sentences confirming you're on it. The detail goes in the <task> blocks.`;

  const preamble = await buildAgentChatPreamble({
    orgId: ctx.activeOrgId,
    agentId: a.id,
    orgName,
    queryText: userMessage,
  });

  let r;
  try {
    r = await chatReply({
      organizationId: ctx.activeOrgId,
      organizationName: orgName,
      chatId: 0,
      userMessage,
      publicAppUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
      agentId: a.id,
      historyOverride: [],
      extraPreamble: preamble,
      noHandoff: true,
      maxTokens: 2500,
    });
  } catch (err) {
    const msg = (err as Error).message;
    console.error("[approve] chatReply threw:", msg);
    // Common: no Claude Max token connected. Surface the precondition
    // as 422 with a clear next-step + connection link so the UI can
    // render a CTA instead of "Approve failed".
    if (/Claude Max|no.*token|access_token/i.test(msg)) {
      return NextResponse.json(
        {
          error: "No Claude Max token connected for this organization.",
          needsConnection: true,
          connectUrl: "/connections",
        },
        { status: 422 },
      );
    }
    return NextResponse.json(
      { error: `chatReply crashed: ${msg}` },
      { status: 500 },
    );
  }
  if (!r.ok) {
    console.error("[approve] chatReply returned not-ok:", r.error);
    if (/Claude Max|no.*token|access_token/i.test(r.error)) {
      return NextResponse.json(
        {
          error: "No Claude Max token connected for this organization.",
          needsConnection: true,
          connectUrl: "/connections",
        },
        { status: 422 },
      );
    }
    return NextResponse.json({ error: r.error }, { status: 500 });
  }

  // Spawn the concrete tasks. Tag each with insight_id so the trace
  // timeline picks them up immediately.
  let createdTasks: Array<{ routineId: string; title: string; assigneeName: string }> = [];
  try {
    const extracted = await extractAndCreateTasks({
      orgId: ctx.activeOrgId,
      speakerAgentId: a.id,
      reply: r.reply,
      insightId: ins.id,
    });
    createdTasks = extracted.tasks;
  } catch (err) {
    console.warn("[approve] task extraction failed:", (err as Error).message);
  }

  // Audit the approve event so the trace shows the human-in-the-loop step
  await db.from("rgaios_audit_log").insert({
    organization_id: ctx.activeOrgId,
    kind: "insight_approved",
    actor_type: "user",
    actor_id: ctx.userId ?? "unknown",
    detail: {
      insight_id: ins.id,
      tasks_spawned: createdTasks.length,
      task_ids: createdTasks.map((t) => t.routineId),
    },
  } as never);

  // Stamp the insight as approved + executing
  const now = new Date().toISOString();
  await db
    .from("rgaios_insights")
    .update({
      status: "executing",
      approved_at: now,
      last_attempt_at: now,
    } as never)
    .eq("id", ins.id);

  return NextResponse.json({
    ok: true,
    tasks: createdTasks,
    reply: r.reply,
  });
}
