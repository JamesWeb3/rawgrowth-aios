import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { dispatchRun } from "@/lib/runs/dispatch";
import { chatReply } from "@/lib/agent/chat";
import { buildAgentChatPreamble } from "@/lib/agent/preamble";
import { extractThinking } from "@/lib/agent/thinking";
import { stripOrchestrationMarkup } from "@/lib/runs/executor";
import { persistSharedMemoryFromReply } from "@/lib/memory/shared";

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
  //
  // Also pull input_payload off the claimed row: the delegating side
  // (extractAndCreateTasks here, execAgentInvoke in agent-commands.ts)
  // writes context / constraints / peer positions onto input_payload,
  // and without reading it back this path ran the assignee on a bare
  // title + EMPTY history - blind to the framing that produced the
  // task, and (for a council) blind to the other heads' positions.
  const { data: claimed } = await db
    .from("rgaios_routine_runs")
    .update({ status: "running", started_at: startedAt } as never)
    .eq("id", input.runId)
    .eq("organization_id", input.orgId)
    .eq("status", "pending")
    .select("id, routine_id, input_payload")
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

  // Surface whatever prior context the delegating side wrote onto the
  // run's input_payload. Before this, executeChatTask ran with
  // `historyOverride: []` + a bare title - a delegated agent (and every
  // head of a council) ran on a blank slate, never seeing the framing
  // that produced the task or the sibling heads' positions. We don't
  // redesign orchestration here; we just stop dropping context that is
  // already (or can be) on the input.
  const payload =
    (claimed as { input_payload?: Record<string, unknown> | null })
      .input_payload ?? {};
  const ctx = extractTaskContext(payload);

  // Build preamble with task framing - lead with the actual task,
  // then attach the standard agent preamble underneath. Any constraints
  // / output-format / explicit context fields get folded into the task
  // message so the assignee sees its boundaries inline.
  const userMessageParts = [
    `[Task assigned to you]\nTitle: ${input.title}\n\nDescription: ${input.description}`,
  ];
  if (ctx.context) {
    userMessageParts.push(`Context from the delegating agent:\n${ctx.context}`);
  }
  if (ctx.constraints) {
    userMessageParts.push(`Constraints:\n${ctx.constraints}`);
  }
  if (ctx.outputFormat) {
    userMessageParts.push(`Output format:\n${ctx.outputFormat}`);
  }
  if (ctx.peerPositions.length > 0) {
    // Council path: this head is one voice of several dispatched on the
    // SAME question. Hand it the other heads' positions so it can
    // actually RESPOND to them instead of writing a parallel monologue.
    userMessageParts.push(
      "Peer positions so far (other heads on this same question):\n" +
        ctx.peerPositions
          .map((p, idx) => `${idx + 1}. ${p}`)
          .join("\n") +
        "\n\nArgue your own angle. Say explicitly where you AGREE and " +
        "where you DISAGREE with the peer positions above - do not just " +
        "restate them.",
    );
  }
  userMessageParts.push(
    'Produce the deliverable now. Be concrete - no "I\'ll get on it" language.',
  );
  const userMessage = userMessageParts.join("\n\n");

  let extraPreamble = "";
  try {
    extraPreamble = await buildAgentChatPreamble({
      orgId: input.orgId,
      agentId: input.assigneeAgentId,
      orgName,
      queryText: userMessage,
    });
  } catch {}

  // Thread the originating operator ask / delegating-agent framing as
  // real conversation history instead of a blank slate. When the input
  // carries the originating ask, the assignee sees the conversation it
  // is joining (operator question -> delegating agent -> "now you");
  // when it doesn't, history stays empty - same as before, just no
  // longer unconditionally so.
  const priorTurns: Array<{
    role: "user" | "assistant";
    content: string;
  }> = [];
  if (ctx.operatorAsk) {
    priorTurns.push({ role: "user", content: ctx.operatorAsk });
  }
  if (ctx.delegatingFraming) {
    priorTurns.push({
      role: "assistant",
      content: ctx.delegatingFraming,
    });
  }

  const result = await chatReply({
    organizationId: input.orgId,
    organizationName: orgName,
    chatId: 0,
    userMessage,
    publicAppUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
    agentId: input.assigneeAgentId,
    historyOverride: priorTurns,
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

    // GAP #3 (Marti Loom acceptance): before this fix the mirror
    // dumped chatReply's raw output - <command>/<task>/<shared_memory>
    // markup, bare-JSON tool blocks, the works - straight into the
    // assignee's chat thread, polluting the operator's Q&A view with
    // orchestration noise the dashboard chat route already strips on
    // its own insert path. The mirror layer is COSMETIC (the executor
    // is not a command surface - sub-agent authority is gated upstream
    // by extractAndExecuteCommands / extractAndCreateTasks BEFORE the
    // task ever ran), so we apply the same passes the dashboard chat
    // route runs but DO NOT dispatch: just strip + persist facts.
    //
    //   1. stripOrchestrationMarkup: drop <command|need|task|
    //      shared_memory|agent> blocks + bare-JSON tool shapes (the
    //      Kasia "apify_run_actor" leak).
    //   2. persistSharedMemoryFromReply: peel <shared_memory> blocks
    //      off and persist them as real shared-memory rows so the
    //      facts aren't lost when the visible markup is stripped.
    //
    // Reference pattern is src/app/api/agents/[id]/chat/route.ts
    // around the assistantInsert site - same order, same intent.
    let mirrorBody = visibleReply;
    try {
      const sm = await persistSharedMemoryFromReply({
        orgId: input.orgId,
        sourceAgentId: input.assigneeAgentId,
        sourceChatId: null,
        reply: mirrorBody,
      });
      mirrorBody = sm.visibleReply || mirrorBody;
    } catch (err) {
      console.warn(
        `[tasks] shared-memory strip failed for run ${input.runId}: ${(err as Error).message}`,
      );
    }
    mirrorBody = stripOrchestrationMarkup(mirrorBody);

    // Mirror the output as an assistant chat message so the assignee's
    // Chat tab shows the work that just happened (operator can scroll
    // there to see the deliverable in context).
    //
    // Thread routing: this is an autonomous delegated run (a sibling
    // agent emitted a <task> block, NOT the operator typing in the
    // assignee's chat input). The dashboard chat route + SSR seed
    // already filter `metadata.thread === "proactive"` into the
    // Proactive (CEO) view, so tagging it here keeps autonomous run
    // output OUT of the operator's main operator/agent Q&A thread.
    await db.from("rgaios_agent_chat_messages").insert({
      organization_id: input.orgId,
      agent_id: input.assigneeAgentId,
      user_id: null,
      role: "assistant",
      content: `${input.title}\n\n${mirrorBody}`,
      metadata: {
        kind: "autonomous_run",
        thread: "proactive",
        subkind: "chat_task_output",
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

/**
 * Pull the optional prior-context fields off a chat-task run's
 * input_payload. extractAndCreateTasks (this file) and execAgentInvoke
 * (agent-commands.ts) own the WRITE side; this is the read side, kept
 * tolerant so a missing/oddly-shaped field just yields "no context"
 * rather than throwing inside the executor.
 *
 * Recognised fields (all optional, all string unless noted):
 *   - context              : free-form framing from the delegating agent
 *   - constraints          : boundaries / scope limits for the assignee
 *   - output_format        : the exact reply shape the delegator wants
 *   - operator_ask /
 *     origin_operator_ask  : the original operator question that kicked
 *                            off the delegation chain - threaded as a
 *                            `user` history turn
 *   - delegating_framing /
 *     framing              : how the delegating agent framed the handoff
 *                            - threaded as an `assistant` history turn
 *   - peer_positions /
 *     council_peers /
 *     peer_outputs         : string | string[]; the OTHER council heads'
 *                            positions on the same question, so this
 *                            head can argue against them (real debate
 *                            instead of parallel monologue)
 *
 * NOTE for the orchestration side: extractAndCreateTasks currently only
 * writes `{ delegated_by_agent_id, title }` onto input_payload, so for
 * <task>-block delegations these fields are absent and behaviour is
 * unchanged (bare title, empty history) until the write side starts
 * populating them. The council case (peer_positions) needs the
 * dispatcher - whatever stacks the council heads - to write each head's
 * sibling positions onto its run's input_payload; the read plumbing is
 * now here and ready for it.
 */
function extractTaskContext(payload: Record<string, unknown>): {
  context: string;
  constraints: string;
  outputFormat: string;
  operatorAsk: string;
  delegatingFraming: string;
  peerPositions: string[];
} {
  const str = (...keys: string[]): string => {
    for (const k of keys) {
      const v = payload[k];
      if (typeof v === "string" && v.trim()) return v.trim().slice(0, 4000);
    }
    return "";
  };
  const peers: string[] = [];
  for (const k of ["peer_positions", "council_peers", "peer_outputs"]) {
    const v = payload[k];
    if (typeof v === "string" && v.trim()) {
      peers.push(v.trim().slice(0, 4000));
    } else if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === "string" && item.trim()) {
          peers.push(item.trim().slice(0, 4000));
        } else if (
          item &&
          typeof item === "object" &&
          typeof (item as { position?: unknown }).position === "string"
        ) {
          // tolerate { agent, position } shaped entries
          const o = item as { agent?: unknown; position: string };
          const who =
            typeof o.agent === "string" && o.agent.trim()
              ? `${o.agent.trim()}: `
              : "";
          peers.push(`${who}${o.position.trim()}`.slice(0, 4000));
        }
      }
    }
    if (peers.length > 0) break;
  }
  return {
    context: str("context"),
    constraints: str("constraints"),
    outputFormat: str("output_format", "outputFormat"),
    operatorAsk: str("operator_ask", "origin_operator_ask"),
    delegatingFraming: str("delegating_framing", "framing"),
    peerPositions: peers,
  };
}
