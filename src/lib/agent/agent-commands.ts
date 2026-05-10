import { supabaseAdmin } from "@/lib/supabase/server";
import { composioAction } from "@/lib/mcp/proxy";
import { dispatchRun } from "@/lib/runs/dispatch";

/**
 * Atlas / dept-head JSON command extraction. The chat reply may include
 * one or more <command type="..."> blocks whose body is a JSON object.
 * The chat route post-processes the reply: blocks are stripped from the
 * visible text and each command is executed server-side, with results
 * appended back to the chat as system messages.
 *
 * This is the response-side counterpart to the MCP wire-protocol that
 * Anthropic's OAuth gate refuses to combine with `mcp_servers` today
 * (oauth-2025-04-20 + mcp-client-2025-04-04 are mutually exclusive on
 * one inference call). Instead of asking the model to emit native
 * tool_use blocks, we teach it to emit fenced JSON commands that this
 * module dispatches.
 *
 * Block format (the parser is forgiving on whitespace):
 *
 *   <command type="tool_call">
 *   { "tool": "composio_use_tool",
 *     "args": { "app": "slack", "action": "SLACK_SEND_MESSAGE", "input": {...} } }
 *   </command>
 *
 *   <command type="agent_invoke">
 *   { "agent": "Sales Manager", "task": "Run a CRM stale-leads scan" }
 *   </command>
 *
 *   <command type="routine_create">
 *   { "title": "Weekly recap", "description": "...", "assignee": "marketer" }
 *   </command>
 *
 * Speaker authority: only Atlas (role=ceo) and department heads may
 * emit commands. Sub-agents trying to fan out commands are rejected
 * with an audit row (matches agent-blocks.ts policy).
 */

const COMMAND_BLOCK_RE =
  /<command\s+type="([^"]+)"\s*>([\s\S]*?)<\/command>/gi;

export type CommandResult = {
  ok: boolean;
  type: string;
  summary: string;
  detail?: Record<string, unknown>;
};

export type ExtractCommandsResult = {
  visibleReply: string;
  results: CommandResult[];
};

type SpeakerInfo = {
  id: string;
  role: string | null;
  is_department_head: boolean | null;
  name: string;
};

function tryParseJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Tolerate fenced ```json ... ``` wrapping that some models add even
  // when we tell them not to. Strip the fence first.
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  const body = fenceMatch ? fenceMatch[1] : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

async function loadSpeaker(
  orgId: string,
  agentId: string,
): Promise<SpeakerInfo | null> {
  const { data } = await supabaseAdmin()
    .from("rgaios_agents")
    .select("id, role, is_department_head, name")
    .eq("organization_id", orgId)
    .eq("id", agentId)
    .maybeSingle();
  return (data as SpeakerInfo | null) ?? null;
}

async function resolveAgent(
  orgId: string,
  label: string,
): Promise<{ id: string; name: string; role: string | null } | null> {
  const raw = label.trim().toLowerCase();
  if (!raw) return null;
  const db = supabaseAdmin();
  const { data: agents } = await db
    .from("rgaios_agents")
    .select("id, name, role, is_department_head")
    .eq("organization_id", orgId);
  const list = (agents ?? []) as Array<{
    id: string;
    name: string;
    role: string | null;
    is_department_head: boolean | null;
  }>;
  // Prefer department-head when multiple agents share a role - matches
  // tasks.ts resolveAssignee semantics.
  const roleMatches = list.filter((a) => (a.role ?? "").toLowerCase() === raw);
  const byRole =
    roleMatches.find((a) => a.is_department_head) ?? roleMatches[0];
  if (byRole) return { id: byRole.id, name: byRole.name, role: byRole.role };
  const byName = list.find((a) => a.name.toLowerCase() === raw);
  if (byName) return { id: byName.id, name: byName.name, role: byName.role };
  return null;
}

async function execToolCall(
  orgId: string,
  speakerId: string,
  payload: unknown,
  callerUserId: string | null,
): Promise<CommandResult> {
  if (!payload || typeof payload !== "object") {
    return {
      ok: false,
      type: "tool_call",
      summary: "tool_call payload must be a JSON object",
    };
  }
  const { tool, args } = payload as { tool?: string; args?: unknown };
  if (tool !== "composio_use_tool") {
    return {
      ok: false,
      type: "tool_call",
      summary: `tool_call: only composio_use_tool is supported from chat (got "${tool ?? "(missing)"}")`,
    };
  }
  if (!args || typeof args !== "object") {
    return {
      ok: false,
      type: "tool_call",
      summary: "tool_call: args must be a JSON object",
    };
  }
  const a = args as {
    app?: string;
    action?: string;
    input?: Record<string, unknown>;
  };
  const app = (a.app ?? "").trim().toLowerCase();
  const action = (a.action ?? "").trim();
  const input = a.input ?? {};
  if (!app || !action) {
    return {
      ok: false,
      type: "tool_call",
      summary: "tool_call: app + action are required",
    };
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    return {
      ok: false,
      type: "tool_call",
      summary: "tool_call: input must be an object",
    };
  }
  // Mirror the destructive-action denylist from composio_use_tool MCP
  // tool. Defense-in-depth: even if a sub-agent somehow slips past the
  // speaker authority check, dangerous DELETE/PURGE/etc actions are
  // refused at the chat-command surface too.
  const destructive = /(?:^|[_\-])(DELETE|DROP|PURGE|REMOVE|WIPE|TRUNCATE)(?:[_\-]|$)/i;
  if (destructive.test(action)) {
    return {
      ok: false,
      type: "tool_call",
      summary: `tool_call refused - destructive action ${action} (denylist)`,
    };
  }
  try {
    const result = await composioAction(
      orgId,
      app,
      action,
      input as Record<string, unknown>,
      callerUserId,
    );
    let preview: string;
    try {
      preview = JSON.stringify(result).slice(0, 400);
    } catch {
      preview = String(result).slice(0, 400);
    }
    return {
      ok: true,
      type: "tool_call",
      summary: `Ran composio ${app}/${action} - ${preview}`,
      detail: { app, action, result_preview: preview },
    };
  } catch (err) {
    return {
      ok: false,
      type: "tool_call",
      summary: `composio ${app}/${action} failed: ${(err as Error).message.slice(0, 200)}`,
    };
  }
}

async function execAgentInvoke(
  orgId: string,
  speakerId: string,
  payload: unknown,
): Promise<CommandResult> {
  if (!payload || typeof payload !== "object") {
    return {
      ok: false,
      type: "agent_invoke",
      summary: "agent_invoke payload must be a JSON object",
    };
  }
  const { agent, task } = payload as { agent?: string; task?: string };
  const target = (agent ?? "").trim();
  const taskText = (task ?? "").trim();
  if (!target || !taskText) {
    return {
      ok: false,
      type: "agent_invoke",
      summary: "agent_invoke requires agent + task",
    };
  }
  const resolved = await resolveAgent(orgId, target);
  if (!resolved) {
    return {
      ok: false,
      type: "agent_invoke",
      summary: `agent_invoke: agent "${target}" not found in this org`,
    };
  }
  // Pedro rule: dept heads + Atlas may delegate. Sub-agents may not -
  // already gated at the speaker authority check above. We additionally
  // refuse self-invoke (would just loop the chat reply we're inside).
  if (resolved.id === speakerId) {
    return {
      ok: false,
      type: "agent_invoke",
      summary: "agent_invoke refused - cannot invoke yourself; emit a <task> block instead",
    };
  }
  const db = supabaseAdmin();
  // Create a routine + a pending run scoped to the assignee. The chat
  // task pipeline (tasks.ts executeChatTask) runs the assignee's chat
  // reply against this task description and stores the output. Same
  // shape rgaios_routines + rgaios_routine_runs use, so the Tasks tab
  // surfaces it identically.
  const { data: routine, error: rErr } = await db
    .from("rgaios_routines")
    .insert({
      organization_id: orgId,
      title: taskText.slice(0, 200),
      description: taskText.slice(0, 4000),
      assignee_agent_id: resolved.id,
      status: "active",
    } as never)
    .select("id")
    .single();
  if (rErr || !routine) {
    return {
      ok: false,
      type: "agent_invoke",
      summary: `agent_invoke: routine insert failed: ${rErr?.message ?? "unknown"}`,
    };
  }
  const routineId = (routine as { id: string }).id;
  const { data: run } = await db
    .from("rgaios_routine_runs")
    .insert({
      organization_id: orgId,
      routine_id: routineId,
      source: "chat_command",
      status: "pending",
      input_payload: {
        delegated_by_agent_id: speakerId,
        title: taskText.slice(0, 200),
      },
    } as never)
    .select("id")
    .single();
  const runId = (run as { id: string } | null)?.id ?? null;
  if (runId) {
    try {
      dispatchRun(runId, orgId);
    } catch (err) {
      console.warn(
        `[agent-commands] dispatchRun failed for run ${runId}: ${(err as Error).message}`,
      );
    }
  }
  return {
    ok: true,
    type: "agent_invoke",
    summary: `Dispatched to ${resolved.name}: ${taskText.slice(0, 120)}`,
    detail: {
      routine_id: routineId,
      run_id: runId,
      assignee_agent_id: resolved.id,
      assignee_name: resolved.name,
    },
  };
}

async function execRoutineCreate(
  orgId: string,
  speakerId: string,
  payload: unknown,
): Promise<CommandResult> {
  if (!payload || typeof payload !== "object") {
    return {
      ok: false,
      type: "routine_create",
      summary: "routine_create payload must be a JSON object",
    };
  }
  const p = payload as {
    title?: string;
    description?: string;
    assignee?: string;
    schedule?: string;
  };
  const title = (p.title ?? "").trim();
  const description = (p.description ?? p.title ?? "").trim();
  if (!title) {
    return {
      ok: false,
      type: "routine_create",
      summary: "routine_create requires title",
    };
  }
  // Default assignee = speaker. If the model passed an explicit name /
  // role, resolve it like agent_invoke; on miss, fall back to speaker.
  let assigneeId = speakerId;
  let assigneeName = "self";
  if (p.assignee && p.assignee.trim()) {
    const resolved = await resolveAgent(orgId, p.assignee);
    if (resolved) {
      assigneeId = resolved.id;
      assigneeName = resolved.name;
    }
  }
  const db = supabaseAdmin();
  const { data: routine, error: rErr } = await db
    .from("rgaios_routines")
    .insert({
      organization_id: orgId,
      title: title.slice(0, 200),
      description: description.slice(0, 4000),
      assignee_agent_id: assigneeId,
      status: "active",
    } as never)
    .select("id")
    .single();
  if (rErr || !routine) {
    return {
      ok: false,
      type: "routine_create",
      summary: `routine_create insert failed: ${rErr?.message ?? "unknown"}`,
    };
  }
  const routineId = (routine as { id: string }).id;
  // Schedule support: if `schedule` is provided, persist a trigger row.
  // We accept the simple presets the chat preamble teaches (daily,
  // weekly, hourly). Anything else is recorded but not auto-fired.
  if (p.schedule && typeof p.schedule === "string") {
    const cronByPreset: Record<string, string> = {
      hourly: "0 * * * *",
      daily: "0 9 * * *",
      weekly: "0 9 * * 1",
    };
    const cron = cronByPreset[p.schedule.trim().toLowerCase()] ?? null;
    if (cron) {
      try {
        // kind='schedule' (not 'cron') matches the canonical TriggerKind
        // union in routines/constants.ts. Older rows with kind='cron' are
        // tolerated by triggerFromRow but new inserts go through the same
        // path the UI + MCP routines_create use.
        await db.from("rgaios_routine_triggers").insert({
          organization_id: orgId,
          routine_id: routineId,
          kind: "schedule",
          enabled: true,
          config: { preset: "custom", cron, timezone: "UTC" },
        } as never);
      } catch (err) {
        console.warn(
          `[agent-commands] trigger insert failed for routine ${routineId}: ${(err as Error).message}`,
        );
      }
    }
  }
  return {
    ok: true,
    type: "routine_create",
    summary: `Created routine "${title}" assigned to ${assigneeName}${p.schedule ? ` (${p.schedule})` : ""}`,
    detail: {
      routine_id: routineId,
      assignee_agent_id: assigneeId,
      schedule: p.schedule ?? null,
    },
  };
}

/**
 * Strip <command> blocks out of `reply` and execute them. Returns the
 * cleaned reply + per-command results so the chat route can append a
 * system message summarising what just happened.
 *
 * Speaker authority: Atlas (role=ceo) + department heads only. Other
 * agents have their commands stripped from the visible text but get a
 * single rejection result so the audit log shows the attempt.
 */
export async function extractAndExecuteCommands(input: {
  orgId: string;
  speakerAgentId: string;
  reply: string;
  callerUserId?: string | null;
}): Promise<ExtractCommandsResult> {
  const { orgId, speakerAgentId, reply, callerUserId } = input;
  const matches = [...reply.matchAll(COMMAND_BLOCK_RE)];
  if (matches.length === 0) {
    return { visibleReply: reply, results: [] };
  }
  const visibleReply = reply.replace(COMMAND_BLOCK_RE, "").trim();

  const speaker = await loadSpeaker(orgId, speakerAgentId);
  if (!speaker) {
    return { visibleReply, results: [] };
  }
  const isAtlas = speaker.role === "ceo";
  const isHead = speaker.is_department_head === true;
  if (!isAtlas && !isHead) {
    console.warn(
      `[agent-commands] ${speaker.name} (role=${speaker.role}, head=${speaker.is_department_head}) is not authorised to emit commands`,
    );
    return {
      visibleReply,
      results: [
        {
          ok: false,
          type: "rejected",
          summary: `Commands rejected - ${speaker.name} is not Atlas or a department head`,
        },
      ],
    };
  }

  const results: CommandResult[] = [];
  for (const m of matches) {
    const type = (m[1] ?? "").trim().toLowerCase();
    const payload = tryParseJson(m[2] ?? "");
    if (payload === null) {
      results.push({
        ok: false,
        type,
        summary: `command type=${type}: body is not valid JSON`,
      });
      continue;
    }
    if (type === "tool_call") {
      results.push(
        await execToolCall(orgId, speakerAgentId, payload, callerUserId ?? null),
      );
    } else if (type === "agent_invoke") {
      results.push(await execAgentInvoke(orgId, speakerAgentId, payload));
    } else if (type === "routine_create") {
      results.push(await execRoutineCreate(orgId, speakerAgentId, payload));
    } else {
      results.push({
        ok: false,
        type,
        summary: `unknown command type "${type}" - supported: tool_call, agent_invoke, routine_create`,
      });
    }
  }

  // Audit one row per command. Best-effort - chat reply still surfaces
  // to the operator even if the audit insert fails.
  try {
    const db = supabaseAdmin();
    await db.from("rgaios_audit_log").insert(
      results.map((r) => ({
        organization_id: orgId,
        kind: r.ok ? `chat_command_${r.type}` : "chat_command_rejected",
        actor_type: "agent",
        actor_id: speakerAgentId,
        detail: {
          type: r.type,
          ok: r.ok,
          summary: r.summary.slice(0, 500),
          ...(r.detail ?? {}),
        },
      })) as never,
    );
  } catch (err) {
    console.warn(
      `[agent-commands] audit insert failed: ${(err as Error).message}`,
    );
  }
  return { visibleReply, results };
}
