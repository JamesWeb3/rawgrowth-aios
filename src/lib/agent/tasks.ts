import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { dispatchRun } from "@/lib/runs/dispatch";
import { chatReply } from "@/lib/agent/chat";
import { buildAgentChatPreamble } from "@/lib/agent/preamble";

/**
 * Chat-driven task creation. The agent ends a reply with one or more
 * <task assignee="..."> blocks; we strip them, create rgaios_routines
 * rows for the assigned agent, kick a pending rgaios_routine_runs row,
 * and dispatchRun for execution.
 *
 * Format the agent must emit (documented in src/lib/agent/preamble.ts):
 *
 *   <task assignee="self|<agent-role>|<agent-name>">
 *   Title: short imperative line
 *   Description: one or two sentences with the goal + outcome
 *   </task>
 *
 * `assignee` resolution order:
 *   1. literal "self" - assigns to the speaking agent
 *   2. exact match on agent.role within the org (e.g. "marketer", "sdr")
 *   3. case-insensitive match on agent.name within the org
 *   4. fallback - assigns to the speaking agent so nothing is lost
 *
 * Returns the modified reply (blocks stripped) + the list of created
 * task rows so the chat route can echo them back to the client.
 */

const TASK_BLOCK_RE = /<task(?:\s+assignee="([^"]*)")?>([\s\S]*?)<\/task>/gi;

export type CreatedTask = {
  routineId: string;
  runId: string | null;
  title: string;
  assigneeAgentId: string;
  assigneeName: string;
};

export type ExtractTasksResult = {
  visibleReply: string;
  tasks: CreatedTask[];
};

export async function extractAndCreateTasks(input: {
  orgId: string;
  speakerAgentId: string;
  reply: string;
}): Promise<ExtractTasksResult> {
  const { orgId, speakerAgentId, reply } = input;
  const matches = [...reply.matchAll(TASK_BLOCK_RE)];
  if (matches.length === 0) {
    return { visibleReply: reply, tasks: [] };
  }

  // Strip blocks from the visible text first - even if creation fails,
  // the user shouldn't see the raw XML.
  const visibleReply = reply.replace(TASK_BLOCK_RE, "").trim();

  const db = supabaseAdmin();

  // Pull all agents in this org once so we can resolve assignee strings
  // without N round trips.
  const { data: agents } = await db
    .from("rgaios_agents")
    .select("id, name, role, department, is_department_head")
    .eq("organization_id", orgId);
  const allAgents = (agents ?? []) as Array<{
    id: string;
    name: string;
    role: string | null;
    department: string | null;
    is_department_head: boolean | null;
  }>;
  const speaker = allAgents.find((a) => a.id === speakerAgentId);

  function resolveAssignee(label: string | null): {
    id: string;
    name: string;
  } {
    const raw = (label ?? "self").trim().toLowerCase();
    if (raw === "self" || raw === "") {
      return {
        id: speakerAgentId,
        name: speaker?.name ?? "this agent",
      };
    }
    // Prefer department-head when multiple agents share the same role.
    // E.g. role='marketer' matches both Marketing Manager (head) +
    // Content Strategist (sub) - delegating "to the marketer" should
    // hit the head, not whichever row Postgres returned first.
    const roleMatches = allAgents.filter(
      (a) => (a.role ?? "").toLowerCase() === raw,
    );
    const byRole =
      roleMatches.find((a) => a.is_department_head) ?? roleMatches[0];
    if (byRole) return { id: byRole.id, name: byRole.name };
    const byName = allAgents.find(
      (a) => a.name.toLowerCase() === raw,
    );
    if (byName) return { id: byName.id, name: byName.name };
    return {
      id: speakerAgentId,
      name: speaker?.name ?? "this agent",
    };
  }

  const tasks: CreatedTask[] = [];
  for (const m of matches) {
    const assigneeLabel = m[1] ?? null;
    const body = (m[2] ?? "").trim();
    if (!body) continue;
    const titleMatch = body.match(/Title:\s*(.+)/i);
    const descMatch = body.match(/Description:\s*([\s\S]+)/i);
    const title = (titleMatch?.[1] ?? body.split("\n")[0] ?? "Task")
      .trim()
      .slice(0, 200);
    const description = (descMatch?.[1] ?? body).trim().slice(0, 4000);

    const assignee = resolveAssignee(assigneeLabel);

    // Insert the routine row.
    const { data: routine, error: routineErr } = await db
      .from("rgaios_routines")
      .insert({
        organization_id: orgId,
        title,
        description,
        assignee_agent_id: assignee.id,
        status: "active",
      } as never)
      .select("id")
      .single();
    if (routineErr || !routine) {
      console.warn(
        `[tasks] routine insert failed: ${routineErr?.message}`,
      );
      continue;
    }
    const routineId = (routine as { id: string }).id;

    // Insert the run row + fire the dispatcher. Drain executes async.
    const { data: run } = await db
      .from("rgaios_routine_runs")
      .insert({
        organization_id: orgId,
        routine_id: routineId,
        source: "chat_task",
        status: "pending",
        input_payload: {
          delegated_by_agent_id: speakerAgentId,
          title,
        },
      } as never)
      .select("id")
      .single();
    const runId = (run as { id: string } | null)?.id ?? null;
    if (runId) {
      // Two paths:
      //   1. dispatchRun (drain server / hosted after())
      //   2. inline fallback: in dev/v3-without-drain, the dispatched
      //      run sits pending forever. Run executeChatTask in
      //      next/after so the request returns fast but the assignee
      //      actually does the work via chatReply, output lands in
      //      output, status flips succeeded/failed.
      try {
        dispatchRun(runId, orgId);
      } catch (err) {
        console.warn(
          `[tasks] dispatchRun failed for run ${runId}: ${(err as Error).message}`,
        );
      }
      // Try Next.js after() so we return fast + execute in background.
      // Falls back to fire-and-forget Promise when called outside a
      // request scope (smoke scripts, cron tick, etc).
      const exec = () =>
        executeChatTask({
          orgId,
          runId,
          assigneeAgentId: assignee.id,
          title,
          description,
          delegatedByAgentId: speakerAgentId,
        });
      try {
        after(exec);
      } catch {
        void exec();
      }
    }

    // Audit log so the activity feed picks it up.
    try {
      await db.from("rgaios_audit_log").insert({
        organization_id: orgId,
        kind: "task_created",
        actor_type: "agent",
        actor_id: speakerAgentId,
        detail: {
          agent_id: assignee.id,
          routine_id: routineId,
          run_id: runId,
          title,
          delegated_from: speakerAgentId,
        },
      } as never);
    } catch {}

    tasks.push({
      routineId,
      runId,
      title,
      assigneeAgentId: assignee.id,
      assigneeName: assignee.name,
    });
  }

  return { visibleReply, tasks };
}

/**
 * Execute a chat-created task inline. The assignee agent reads the
 * task title + description as a user message, builds its full preamble
 * (brand + RAG + persona), and replies. Output lands in
 * rgaios_routine_runs.output + assistant chat history so the
 * Tasks tab can render the result alongside the routine.
 *
 * Idempotent on the run row's status field: if another worker (drain)
 * picked it up first and flipped status away from 'pending' we bail.
 */
export async function executeChatTask(input: {
  orgId: string;
  runId: string;
  assigneeAgentId: string;
  title: string;
  description: string;
  delegatedByAgentId: string;
}): Promise<void> {
  const db = supabaseAdmin();
  const startedAt = new Date().toISOString();

  // Claim the row: only flip pending → running once. Skip if a drain
  // worker already moved it.
  const { data: claimed } = await db
    .from("rgaios_routine_runs")
    .update({ status: "running", started_at: startedAt } as never)
    .eq("id", input.runId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (!claimed) return;

  // Pull org name + assignee details
  const { data: org } = await db
    .from("rgaios_organizations")
    .select("name")
    .eq("id", input.orgId)
    .maybeSingle();
  const orgName = (org as { name: string } | null)?.name ?? null;

  // Build preamble with task framing - lead with the actual task,
  // then attach the standard agent preamble underneath.
  const userMessage =
    `[Task assigned to you]\nTitle: ${input.title}\n\nDescription: ${input.description}\n\nProduce the deliverable now. Be concrete - no "I'll get on it" language.`;

  let extraPreamble = "";
  try {
    extraPreamble = await buildAgentChatPreamble({
      orgId: input.orgId,
      agentId: input.assigneeAgentId,
      orgName,
      queryText: userMessage,
    });
  } catch {}

  const result = await chatReply({
    organizationId: input.orgId,
    organizationName: orgName,
    chatId: 0,
    userMessage,
    publicAppUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
    agentId: input.assigneeAgentId,
    historyOverride: [],
    extraPreamble,
    noHandoff: true,
  });

  const completedAt = new Date().toISOString();
  if (result.ok) {
    await db
      .from("rgaios_routine_runs")
      .update({
        status: "succeeded",
        completed_at: completedAt,
        output: { reply: result.reply, executed_inline: true },
      } as never)
      .eq("id", input.runId);

    // Mirror the output as an assistant chat message so the assignee's
    // Chat tab shows the work that just happened (operator can scroll
    // there to see the deliverable in context).
    await db.from("rgaios_agent_chat_messages").insert({
      organization_id: input.orgId,
      agent_id: input.assigneeAgentId,
      user_id: null,
      role: "assistant",
      content: `📋 ${input.title}\n\n${result.reply}`,
      metadata: {
        kind: "chat_task_output",
        run_id: input.runId,
        delegated_by: input.delegatedByAgentId,
      },
    } as never);

    try {
      await db.from("rgaios_audit_log").insert({
        organization_id: input.orgId,
        kind: "task_executed",
        actor_type: "agent",
        actor_id: input.assigneeAgentId,
        detail: {
          run_id: input.runId,
          agent_id: input.assigneeAgentId,
          title: input.title,
          delegated_by: input.delegatedByAgentId,
        },
      } as never);
    } catch {}
  } else {
    await db
      .from("rgaios_routine_runs")
      .update({
        status: "failed",
        completed_at: completedAt,
        error: result.error,
      } as never)
      .eq("id", input.runId);
  }
}
