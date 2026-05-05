import { supabaseAdmin } from "@/lib/supabase/server";
import { chatReply } from "@/lib/agent/chat";
import { extractAndCreateTasks } from "@/lib/agent/tasks";
import { buildAgentChatPreamble } from "@/lib/agent/preamble";

/**
 * Atlas error router. Scans recent failed routine_runs + low-quality
 * task_executed outputs, asks Atlas where to route the work next:
 *   - retry with same agent (refinement angle)
 *   - reassign to a different role
 *   - escalate to human
 *
 * Atlas emits <task> blocks for the chosen path. Server extracts +
 * creates the new routine. Original failed task gets an audit row
 * `task_rerouted` linking old + new.
 *
 * Called by cron `atlas-route-failures` daily, plus inline from the
 * autoresearch loop's checkAndRetryOpen for executing insights.
 */

type FailedTask = {
  routineId: string;
  title: string;
  assigneeAgentId: string | null;
  assigneeName: string;
  error: string;
  output: string;
  createdAt: string;
};

export async function findFailedTasks(
  orgId: string,
  sinceHours = 24,
): Promise<FailedTask[]> {
  const db = supabaseAdmin();
  const since = new Date(
    Date.now() - sinceHours * 60 * 60 * 1000,
  ).toISOString();

  const { data: runs } = await db
    .from("rgaios_routine_runs")
    .select(
      "routine_id, status, error, output, created_at, routines:routine_id(title, assignee_agent_id)",
    )
    .eq("organization_id", orgId)
    .eq("status", "failed")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(20);

  type Row = {
    routine_id: string;
    error: string | null;
    output: { reply?: string } | null;
    created_at: string;
    routines: {
      title: string | null;
      assignee_agent_id: string | null;
    } | null;
  };
  const rows = (runs ?? []) as Row[];

  const aIds = Array.from(
    new Set(
      rows
        .map((r) => r.routines?.assignee_agent_id)
        .filter((x): x is string => typeof x === "string"),
    ),
  );
  const nameById = new Map<string, string>();
  if (aIds.length > 0) {
    const { data: agents } = await db
      .from("rgaios_agents")
      .select("id, name")
      .in("id", aIds);
    for (const a of (agents ?? []) as Array<{ id: string; name: string }>) {
      nameById.set(a.id, a.name);
    }
  }

  return rows.map((r) => ({
    routineId: r.routine_id,
    title: r.routines?.title ?? "(untitled)",
    assigneeAgentId: r.routines?.assignee_agent_id ?? null,
    assigneeName: r.routines?.assignee_agent_id
      ? nameById.get(r.routines.assignee_agent_id) ?? "agent"
      : "unassigned",
    error: r.error ?? "",
    output: r.output?.reply ?? "",
    createdAt: r.created_at,
  }));
}

/**
 * Ask Atlas to triage the failed batch. Returns the reroute decisions
 * Atlas made + count of new tasks spawned.
 */
export async function routeFailures(
  orgId: string,
  sinceHours = 24,
): Promise<{ failed: number; rerouted: number; errors: string[] }> {
  const db = supabaseAdmin();
  const failed = await findFailedTasks(orgId, sinceHours);
  if (failed.length === 0) {
    return { failed: 0, rerouted: 0, errors: [] };
  }

  // Find Atlas
  const { data: atlasRow } = await db
    .from("rgaios_agents")
    .select("id, name")
    .eq("organization_id", orgId)
    .eq("role", "ceo")
    .maybeSingle();
  const atlas = atlasRow as { id: string; name: string } | null;
  if (!atlas) return { failed: failed.length, rerouted: 0, errors: ["no atlas"] };

  const { data: org } = await db
    .from("rgaios_organizations")
    .select("name")
    .eq("id", orgId)
    .maybeSingle();
  const orgName = (org as { name: string } | null)?.name ?? null;

  const list = failed
    .map(
      (f, i) =>
        `${i + 1}. "${f.title}" - assignee: ${f.assigneeName} - error: ${(f.error || f.output).slice(0, 200)}`,
    )
    .join("\n");

  const userMessage = `ROUTING DECISION needed. ${failed.length} task${failed.length === 1 ? "" : "s"} failed in the last ${sinceHours}h. For each, decide:
  (a) RETRY with same agent + refinement angle
  (b) REASSIGN to different role - say which role
  (c) ESCALATE to human (operator approval needed)

Failed list:
${list}

Emit ONE <task> block per failure with assignee + new title + description that explains the angle change. Skip block if your verdict is ESCALATE - mention it in the visible reply instead.`;

  const preamble = await buildAgentChatPreamble({
    orgId,
    agentId: atlas.id,
    orgName,
    queryText: userMessage,
  });

  let r;
  try {
    r = await chatReply({
      organizationId: orgId,
      organizationName: orgName,
      chatId: 0,
      userMessage,
      publicAppUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
      agentId: atlas.id,
      historyOverride: [],
      extraPreamble: preamble,
      noHandoff: true,
      maxTokens: 2000,
    });
  } catch (err) {
    return {
      failed: failed.length,
      rerouted: 0,
      errors: [(err as Error).message.slice(0, 200)],
    };
  }
  if (!r.ok) return { failed: failed.length, rerouted: 0, errors: [r.error] };

  let createdCount = 0;
  try {
    const ext = await extractAndCreateTasks({
      orgId,
      speakerAgentId: atlas.id,
      reply: r.reply,
    });
    createdCount = ext.tasks.length;
  } catch (err) {
    return {
      failed: failed.length,
      rerouted: 0,
      errors: [(err as Error).message.slice(0, 200)],
    };
  }

  // Audit: link each old failure to the rerouting decision
  await db.from("rgaios_audit_log").insert({
    organization_id: orgId,
    kind: "atlas_routed_failures",
    actor_type: "agent",
    actor_id: atlas.id,
    detail: {
      failed_count: failed.length,
      rerouted_count: createdCount,
      failed_routine_ids: failed.map((f) => f.routineId),
      reply_excerpt: r.reply.slice(0, 300),
    },
  } as never);

  // Stamp original failed routines with rerouted_to_at
  for (const f of failed) {
    await db.from("rgaios_audit_log").insert({
      organization_id: orgId,
      kind: "task_rerouted",
      actor_type: "agent",
      actor_id: atlas.id,
      detail: {
        routine_id: f.routineId,
        original_assignee: f.assigneeName,
        new_count: createdCount,
      },
    } as never);
  }

  return { failed: failed.length, rerouted: createdCount, errors: [] };
}
