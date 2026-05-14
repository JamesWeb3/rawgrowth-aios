import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { dispatchRun } from "@/lib/runs/dispatch";
import { chatReply } from "@/lib/agent/chat";
import { buildAgentChatPreamble } from "@/lib/agent/preamble";
import { extractThinking } from "@/lib/agent/thinking";

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
  /**
   * Optional: when these tasks are spawned in response to an insight
   * (anomaly drilldown / approval / retry), tag every task_created
   * audit row with the insight id so the review loop can later pull
   * "all routines created for this anomaly" via detail->>insight_id.
   */
  insightId?: string;
}): Promise<ExtractTasksResult> {
  const { orgId, speakerAgentId, reply, insightId } = input;
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

  // Parse every <task> block into a normalised payload first, then
  // batch the database writes. The previous loop did one routine
  // insert + one run insert per task sequentially - 5 tasks = 10 round
  // trips on the demo path. Now: one routine batch + one run batch +
  // one audit batch, regardless of N.
  type PendingTask = {
    title: string;
    description: string;
    assignee: { id: string; name: string };
  };
  const pending: PendingTask[] = [];
  for (const m of matches) {
    const assigneeLabel = m[1] ?? null;
    const bodyRaw = (m[2] ?? "").trim();
    if (!bodyRaw) continue;
    const titleMatch = bodyRaw.match(/Title:\s*(.+)/i);
    const descMatch = bodyRaw.match(/Description:\s*([\s\S]+)/i);
    const title = (titleMatch?.[1] ?? bodyRaw.split("\n")[0] ?? "Task")
      .trim()
      .slice(0, 200);
    const description = (descMatch?.[1] ?? bodyRaw).trim().slice(0, 4000);
    const assignee = resolveAssignee(assigneeLabel);
    pending.push({ title, description, assignee });
  }

  if (pending.length === 0) {
    return { visibleReply, tasks: [] };
  }

  // Batch insert routines. Supabase preserves input order in the
  // returned rows when given an array - we rely on that for the
  // routineId correlation below. If the whole batch fails, fall back
  // to per-row inserts so one bad payload can't lose every task.
  // kind='delegation': <task> blocks are one-shot delegations, not
  // automated workflows - they carry no trigger. Tagging them keeps the
  // /routines list scoped to real routines (listRoutinesForOrg filters
  // to kind='workflow'); the work is still surfaced via the Tasks tab,
  // which reads rgaios_routine_runs directly.
  const routineRows = pending.map((p) => ({
    organization_id: orgId,
    title: p.title,
    description: p.description,
    assignee_agent_id: p.assignee.id,
    status: "active",
    kind: "delegation",
  }));
  const routineIds: (string | null)[] = new Array(pending.length).fill(null);
  const { data: insertedRoutines, error: batchRoutineErr } = await db
    .from("rgaios_routines")
    .insert(routineRows as never)
    .select("id");
  if (
    !batchRoutineErr &&
    Array.isArray(insertedRoutines) &&
    insertedRoutines.length === pending.length
  ) {
    for (let i = 0; i < pending.length; i++) {
      const row = (insertedRoutines as Array<{ id?: string }>)[i];
      if (row && typeof row.id === "string") routineIds[i] = row.id;
    }
  } else {
    console.warn(
      `[tasks] batch routine insert failed, retrying per-row: ${batchRoutineErr?.message}`,
    );
    for (let i = 0; i < pending.length; i++) {
      const { data: routine, error: routineErr } = await db
        .from("rgaios_routines")
        .insert(routineRows[i] as never)
        .select("id")
        .single();
      if (routineErr || !routine) {
        console.warn(
          `[tasks] routine insert failed (${pending[i].title}): ${routineErr?.message}`,
        );
        continue;
      }
      routineIds[i] = (routine as { id: string }).id;
    }
  }

  // Batch insert runs for every routine that landed. Build a parallel
  // index map so we can correlate the returned run id back to its
  // pending entry.
  const runIdByPendingIdx: (string | null)[] = new Array(
    pending.length,
  ).fill(null);
  const runRows: Array<Record<string, unknown>> = [];
  const runRowPendingIdx: number[] = [];
  for (let i = 0; i < pending.length; i++) {
    const rId = routineIds[i];
    if (!rId) continue;
    runRows.push({
      organization_id: orgId,
      routine_id: rId,
      source: "chat_task",
      status: "pending",
      input_payload: {
        delegated_by_agent_id: speakerAgentId,
        title: pending[i].title,
      },
    });
    runRowPendingIdx.push(i);
  }
  if (runRows.length > 0) {
    const { data: insertedRuns, error: batchRunErr } = await db
      .from("rgaios_routine_runs")
      .insert(runRows as never)
      .select("id");
    if (
      !batchRunErr &&
      Array.isArray(insertedRuns) &&
      insertedRuns.length === runRows.length
    ) {
      for (let j = 0; j < runRows.length; j++) {
        const row = (insertedRuns as Array<{ id?: string }>)[j];
        if (row && typeof row.id === "string") {
          runIdByPendingIdx[runRowPendingIdx[j]] = row.id;
        }
      }
    } else {
      console.warn(
        `[tasks] batch run insert failed, retrying per-row: ${batchRunErr?.message}`,
      );
      for (let j = 0; j < runRows.length; j++) {
        const { data: run } = await db
          .from("rgaios_routine_runs")
          .insert(runRows[j] as never)
          .select("id")
          .single();
        const id = (run as { id: string } | null)?.id ?? null;
        if (id) runIdByPendingIdx[runRowPendingIdx[j]] = id;
      }
    }
  }

  // Side effects per task: dispatch + after()/inline fallback +
  // collect audit-log rows for a single batch insert below.
  const tasks: CreatedTask[] = [];
  const auditRows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < pending.length; i++) {
    const routineId = routineIds[i];
    if (!routineId) continue;
    const runId = runIdByPendingIdx[i];
    const { title, description, assignee } = pending[i];

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

    auditRows.push({
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
        ...(insightId ? { insight_id: insightId } : {}),
      },
    });

    tasks.push({
      routineId,
      runId,
      title,
      assigneeAgentId: assignee.id,
      assigneeName: assignee.name,
    });
  }

  // Single audit-log batch insert. Best-effort - feed display issues
  // shouldn't block returning the tasks payload to the caller.
  if (auditRows.length > 0) {
    try {
      await db.from("rgaios_audit_log").insert(auditRows as never);
    } catch {}
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
  // worker already moved it. Org-scoped so a runId from another org
  // can never be claimed through this path.
  const { data: claimed } = await db
    .from("rgaios_routine_runs")
    .update({ status: "running", started_at: startedAt } as never)
    .eq("id", input.runId)
    .eq("organization_id", input.orgId)
    .eq("status", "pending")
    .select("id, routine_id")
    .maybeSingle();
  if (!claimed) return;

  // Stamp the routine's last_run_at. This inline chat-task path does NOT
  // go through runs/queries.ts claimRun (the executor's chokepoint that
  // bumps last_run_at), so without this every chat-task routine showed
  // "Last run: Never" even after it ran - half of Chris's /routines bug.
  // why here: this is the one spot every inline chat-task execution
  // passes through after winning the claim, so it can't double-stamp.
  const claimedRoutineId = (claimed as { routine_id?: string }).routine_id;
  if (claimedRoutineId) {
    await db
      .from("rgaios_routines")
      .update({ last_run_at: startedAt } as never)
      .eq("id", claimedRoutineId)
      .eq("organization_id", input.orgId);
  }

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
    // Split the <thinking> block off the reply. The dashboard chat
    // route does this, but the delegation pipeline never did - so
    // executeChatTask stored and mirrored the RAW chatReply output,
    // tag and all, leaking raw <thinking> XML into the assignee's
    // chat thread and into every downstream reader of the run output.
    // Persist visibleReply for display + thinking separately for
    // /trace, same split the chat route applies.
    const { thinking, visibleReply } = extractThinking(result.reply);

    // Log if the success update fails - leaving the run in pending
    // means the next schedule-tick may re-claim it and the chat tab
    // shows a stuck task. Caller doesn't currently react but at least
    // we get a server log for follow-up.
    const upd = await db
      .from("rgaios_routine_runs")
      .update({
        status: "succeeded",
        completed_at: completedAt,
        output: {
          reply: visibleReply,
          thinking: thinking ?? null,
          executed_inline: true,
        },
      } as never)
      .eq("id", input.runId);
    if (upd.error) {
      console.error(
        `[tasks] succeeded-update failed for run ${input.runId}:`,
        upd.error.message,
      );
    }

    // Mirror the output as an assistant chat message so the assignee's
    // Chat tab shows the work that just happened (operator can scroll
    // there to see the deliverable in context).
    await db.from("rgaios_agent_chat_messages").insert({
      organization_id: input.orgId,
      agent_id: input.assigneeAgentId,
      user_id: null,
      role: "assistant",
      content: `${input.title}\n\n${visibleReply}`,
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
    const updFail = await db
      .from("rgaios_routine_runs")
      .update({
        status: "failed",
        completed_at: completedAt,
        error: result.error,
      } as never)
      .eq("id", input.runId);
    if (updFail.error) {
      console.error(
        `[tasks] failed-update failed for run ${input.runId}:`,
        updFail.error.message,
      );
    }
  }
}
