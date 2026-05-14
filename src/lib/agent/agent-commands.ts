import { supabaseAdmin } from "@/lib/supabase/server";
import { composioAction } from "@/lib/mcp/proxy";

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

/**
 * Render a Composio tool result as one natural-language line for the
 * operator-visible "Commands executed" row. The raw JSON still rides
 * along in `detail` for the expandable trace view - this is just the
 * human-readable headline so Marti sees "Fetched 3 emails" instead of
 * a wall of {"data":{"messages":[{"attachmentList":[]...}]}}.
 */
function humanizeToolResult(
  app: string,
  action: string,
  result: unknown,
): string {
  const a = action.toUpperCase();
  // Composio v3 wraps payloads as { data: ..., successful, error }.
  const data =
    result && typeof result === "object" && "data" in result
      ? (result as { data?: unknown }).data
      : result;
  // Pull the array of items out of whatever wrapper Composio used.
  const listOf = (v: unknown): unknown[] | null => {
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      for (const k of ["messages", "items", "events", "data", "results"]) {
        if (Array.isArray(o[k])) return o[k] as unknown[];
      }
    }
    return null;
  };
  const countOf = (v: unknown): number | null => {
    const l = listOf(v);
    return l ? l.length : null;
  };
  const str = (v: unknown): string => {
    if (typeof v === "string") return v;
    if (v == null) return "";
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    // Composio's Gmail FETCH can return messageText/body as a nested
    // object ({ text, html, ... }) for HTML / multipart mail - String()
    // on that gives the useless "[object Object]" the agent complained
    // about. Pull the human-readable field out, or fall back to a
    // short JSON slice rather than the placeholder.
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      for (const k of ["text", "plain", "value", "body", "content", "html", "snippet"]) {
        if (typeof o[k] === "string" && (o[k] as string).trim()) {
          return o[k] as string;
        }
      }
      try {
        return JSON.stringify(v).slice(0, 200);
      } catch {
        return "";
      }
    }
    return String(v);
  };
  // Gmail
  if (app === "gmail" || a.startsWith("GMAIL")) {
    if (a.includes("FETCH") || a.includes("LIST")) {
      const list = listOf(data);
      if (!list) return "Checked Gmail - got a response.";
      if (list.length === 0) return "Inbox is empty - no emails matched.";
      // List the actual emails so the operator sees the inbox content
      // in chat, not just a count. subject + sender, one per line.
      const lines = list.slice(0, 10).map((m) => {
        const o = (m ?? {}) as Record<string, unknown>;
        const subject =
          str(o.subject) || str(o.snippet) || str(o.preview) || "(no subject)";
        const from =
          str(o.sender) || str(o.from) || str(o.fromEmail) || "(unknown sender)";
        // Body snippet + date: templated mail (membership confirmations,
        // form submissions) shares subject + sender, so subject alone
        // makes 3 distinct emails look like one duplicate. The snippet
        // is what tells them apart.
        const bodyRaw =
          str(o.messageText) ||
          str(o.snippet) ||
          str(o.preview) ||
          str(o.body);
        const snippet = bodyRaw
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 90);
        const when = str(o.messageTimestamp) || str(o.date) || str(o.internalDate);
        const tail = [
          when && when.slice(0, 16),
          snippet && `"${snippet}…"`,
        ]
          .filter(Boolean)
          .join(" ");
        return `• "${subject.slice(0, 80)}" - ${from.slice(0, 50)}${tail ? `\n  ${tail}` : ""}`;
      });
      const more = list.length > 10 ? `\n…and ${list.length - 10} more` : "";
      return `Fetched ${list.length} email${list.length === 1 ? "" : "s"}:\n${lines.join("\n")}${more}`;
    }
    if (a.includes("SEND")) return "Sent the email.";
    if (a.includes("DRAFT")) return "Created an email draft.";
    if (a.includes("PROFILE")) {
      const d = data as { response_data?: { emailAddress?: string; messagesTotal?: number } } | undefined;
      const email = d?.response_data?.emailAddress;
      const total = d?.response_data?.messagesTotal;
      return email
        ? `Confirmed Gmail is connected (${email}${total ? `, ${total} total messages` : ""}).`
        : "Confirmed the Gmail connection.";
    }
  }
  // Google Calendar
  if (app === "googlecalendar" || a.startsWith("GOOGLECALENDAR")) {
    if (a.includes("EVENTS") || a.includes("LIST")) {
      const n = countOf(data);
      return n === null
        ? "Checked the calendar."
        : `Found ${n} calendar event${n === 1 ? "" : "s"}.`;
    }
    if (a.includes("CREATE")) return "Created a calendar event.";
  }
  // Instagram
  if (app === "instagram" || a.startsWith("INSTAGRAM")) {
    const list = listOf(data);
    if (!list) return "Pulled Instagram data.";
    if (list.length === 0) return "No Instagram posts matched.";
    const lines = list.slice(0, 10).map((p) => {
      const o = (p ?? {}) as Record<string, unknown>;
      const cap =
        str(o.caption) || str(o.text) || str(o.title) || "(no caption)";
      const who = str(o.ownerUsername) || str(o.username) || str(o.owner);
      const likes = o.likesCount ?? o.likeCount ?? o.likes;
      const meta = [who && `@${who}`, likes != null && `${likes} likes`]
        .filter(Boolean)
        .join(" · ");
      return `• ${cap.slice(0, 100).replace(/\s+/g, " ")}${meta ? ` (${meta})` : ""}`;
    });
    const more = list.length > 10 ? `\n…and ${list.length - 10} more` : "";
    return `Pulled ${list.length} Instagram post${list.length === 1 ? "" : "s"}:\n${lines.join("\n")}${more}`;
  }
  // Slack
  if (app === "slack" || a.startsWith("SLACK")) {
    if (a.includes("POST") || a.includes("SEND")) return "Posted to Slack.";
  }
  // Generic fallback - still readable, no JSON wall.
  const n = countOf(data);
  if (n !== null) return `Ran ${app} ${action} - returned ${n} item${n === 1 ? "" : "s"}.`;
  return `Ran ${app} ${action}.`;
}

/**
 * Tolerant fallback: when LLMs (Atlas in particular) emit the right JSON
 * payload but forget the <command type="..."> wrapper, scan the reply for
 * bare JSON objects whose top-level shape matches a known command type and
 * treat them as such. Reduces "Atlas said 'creating now' but nothing
 * happened" failure mode where the model strips XML tags despite the
 * preamble teaching them. Same destructive-action denylist + speaker
 * authority gates apply downstream.
 *
 * Recognised shapes:
 *   { "tool": "composio_use_tool", "args": {...} }      → tool_call
 *   { "agent": "<name>", "task": "<text>" }              → agent_invoke
 *   { "title": "...", "description": "...", ... }       → routine_create
 *
 * Returns { type, body } pairs. Optionally fenced with ```json...```.
 */
function extractBareJsonCommands(
  reply: string,
): Array<{ type: string; body: string; rawSpan: string }> {
  const out: Array<{ type: string; body: string; rawSpan: string }> = [];
  // Find every top-level JSON object via a balanced brace scan. The old
  // lazy regex /\{[\s\S]*?\}(?=...)/ stopped at the FIRST `}` followed by
  // a newline, so a pretty-printed multi-line object (inner `}` then
  // `\n`) got truncated to an unparseable fragment. Instead, locate each
  // `{` and walk forward counting `{`/`}` depth - skipping braces inside
  // string literals and respecting `\` escapes - until depth returns to
  // zero. That captures the complete balanced object regardless of
  // internal whitespace or nesting.
  const scanBalancedObject = (
    src: string,
    start: number,
  ): { end: number } | null => {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < src.length; i++) {
      const ch = src[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          // i is the matching close brace; end is exclusive.
          return { end: i + 1 };
        }
      }
    }
    return null;
  };

  let cursor = 0;
  while (cursor < reply.length) {
    const open = reply.indexOf("{", cursor);
    if (open === -1) break;
    const match = scanBalancedObject(reply, open);
    if (!match) break;
    const span = reply.slice(open, match.end);
    // Resume scanning right after this object - top-level objects don't
    // overlap, so the next `{` we care about is past this one's close.
    cursor = match.end;
    if (!span) continue;
    // Preserve the fenced ```json``` handling: an LLM may wrap the bare
    // object in a code fence. The brace scan already isolates just the
    // `{...}`, but keep the strip for parity with the prior behaviour in
    // case a fence marker leaked into the slice.
    const stripped = span
      .replace(/^```(?:json)?\s*\n?/, "")
      .replace(/\n?```$/, "")
      .trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripped);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      continue;
    }
    const obj = parsed as Record<string, unknown>;
    if (
      typeof obj.tool === "string" &&
      obj.tool === "composio_use_tool" &&
      obj.args &&
      typeof obj.args === "object"
    ) {
      out.push({ type: "tool_call", body: stripped, rawSpan: span });
    } else if (
      typeof obj.agent === "string" &&
      typeof obj.task === "string"
    ) {
      out.push({ type: "agent_invoke", body: stripped, rawSpan: span });
    } else if (
      typeof obj.title === "string" &&
      typeof obj.description === "string" &&
      typeof obj.assignee === "string"
    ) {
      out.push({ type: "routine_create", body: stripped, rawSpan: span });
    }
  }
  return out;
}

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
    .select("id, name, role, department, is_department_head")
    .eq("organization_id", orgId);
  const list = (agents ?? []) as Array<{
    id: string;
    name: string;
    role: string | null;
    department: string | null;
    is_department_head: boolean | null;
  }>;
  // 1. Exact role match (prefers dept head when multiple agents share role).
  const roleMatches = list.filter((a) => (a.role ?? "").toLowerCase() === raw);
  const byRole =
    roleMatches.find((a) => a.is_department_head) ?? roleMatches[0];
  if (byRole) return { id: byRole.id, name: byRole.name, role: byRole.role };
  // 2. Exact full-name match.
  const byName = list.find((a) => a.name.toLowerCase() === raw);
  if (byName) return { id: byName.id, name: byName.name, role: byName.role };
  // 3. Department-head shorthand. Atlas often emits "Marketing Manager",
  //    "Sales Manager", "Finance Manager" instead of the seeded names
  //    ("Content Strategist x4z4y", "Sales Manager picsa", etc). Map
  //    "<dept-keyword> manager|head|lead" -> the dept head of <dept>.
  //    Without this every Atlas dispatch fails on first try.
  const headerMatch = raw.match(/^(.+?)\s+(manager|head|lead|director|chief)$/);
  const deptKeyword = headerMatch ? headerMatch[1] : raw;
  if (deptKeyword) {
    const byDept = list.find(
      (a) =>
        a.is_department_head === true &&
        (a.department ?? "").toLowerCase().includes(deptKeyword),
    );
    if (byDept) return { id: byDept.id, name: byDept.name, role: byDept.role };
  }
  // 4. Partial name match (case-insensitive substring). Catches
  //    "Sales Manager" -> "Sales Manager picsa". Prefer dept heads when
  //    multiple agents partial-match.
  const partialMatches = list.filter((a) =>
    a.name.toLowerCase().includes(raw) || raw.includes(a.name.toLowerCase()),
  );
  if (partialMatches.length > 0) {
    const partial =
      partialMatches.find((a) => a.is_department_head) ?? partialMatches[0];
    return { id: partial.id, name: partial.name, role: partial.role };
  }
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
  // Chat tool_call surface routes composio_use_tool plus a small set of
  // native MCP tools straight through the registry: the Apify actor
  // tools (Apify isn't a Composio app) and composio_list_tools (the
  // discovery tool - the model used to wrap it as
  // composio_use_tool({app:"composio",action:"composio_list_tools"})
  // which failed with "composio isn't connected"). Anything else is
  // refused: the dashboard chat path has no MCP drain handoff.
  const MCP_DIRECT_TOOLS = new Set([
    "apify_run_actor",
    "apify_list_actor_runs",
    "composio_list_tools",
  ]);
  if (tool !== "composio_use_tool" && !MCP_DIRECT_TOOLS.has(tool ?? "")) {
    return {
      ok: false,
      type: "tool_call",
      summary: `tool_call: supported tools are composio_use_tool, composio_list_tools, apify_run_actor, apify_list_actor_runs (got "${tool ?? "(missing)"}")`,
    };
  }
  if (!args || typeof args !== "object") {
    return {
      ok: false,
      type: "tool_call",
      summary: "tool_call: args must be a JSON object",
    };
  }

  // MCP-direct branch: route straight through the MCP registry. These
  // tools own their own auth + execution; we just adapt the MCP
  // ToolResult shape into a CommandResult so the orchestration card
  // renders the result the same way a composio result does.
  if (MCP_DIRECT_TOOLS.has(tool ?? "")) {
    try {
      await import("@/lib/mcp/tools"); // side-effect: register all MCP tools
      const { callTool } = await import("@/lib/mcp/registry");
      const res = await callTool(
        tool as string,
        args as Record<string, unknown>,
        { organizationId: orgId, userId: callerUserId },
      );
      const out = res.content?.map((c) => c.text).join("\n").trim() ?? "";
      if (res.isError) {
        return {
          ok: false,
          type: "tool_call",
          summary: `${tool} failed: ${out.slice(0, 240) || "unknown error"}`,
          detail: { tool },
        };
      }
      return {
        ok: true,
        type: "tool_call",
        summary: out.slice(0, 1200) || `${tool} ran - no items returned.`,
        detail: { tool, result_preview: out.slice(0, 4000) },
      };
    } catch (err) {
      return {
        ok: false,
        type: "tool_call",
        summary: `${tool} failed: ${(err as Error).message.slice(0, 200)}`,
        detail: { tool },
      };
    }
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
  //
  // TRASH + REVOKE added: Gmail's real delete verb is *_TRASH_* (e.g.
  // GMAIL_MOVE_TO_TRASH / GMAIL_TRASH_MESSAGE), which DELETE never
  // matched - so "delete my emails" actually slipped through. REVOKE
  // (token / OAuth / access revocation) is unambiguously destructive
  // and an agent should never fire it unattended from chat.
  //
  // Deliberately NOT added: SEND - agents legitimately need
  // GMAIL_SEND_EMAIL / SLACK_SEND_MESSAGE for core features, blocking
  // it breaks them. CANCEL / ARCHIVE - context-dependent (cancel a
  // calendar hold, archive a thread) and not unambiguously destructive,
  // so left callable to stay conservative.
  const destructive = /(?:^|[_\-])(DELETE|DROP|PURGE|REMOVE|WIPE|TRUNCATE|TRASH|REVOKE)(?:[_\-]|$)/i;
  if (destructive.test(action)) {
    return {
      ok: false,
      type: "tool_call",
      summary: `tool_call refused - destructive action ${action} (denylist)`,
    };
  }
  try {
    // Outer 45s hard ceiling. composioAction has its own 30s fetch
    // timeout, but a stalled DNS lookup / TLS handshake / connection
    // establishment can hang BEFORE that inner timer arms - leaving
    // the chat reply path never returning to the operator. Race the
    // call against AbortSignal.timeout so the outer path is guaranteed
    // to surface a textError within 45s no matter what composio does.
    const outerTimeout = new Promise<never>((_, reject) => {
      const signal = AbortSignal.timeout(45_000);
      signal.addEventListener("abort", () => {
        reject(new Error("__OUTER_COMPOSIO_TIMEOUT__"));
      });
    });
    let result: unknown;
    try {
      result = await Promise.race([
        composioAction(
          orgId,
          app,
          action,
          input as Record<string, unknown>,
          callerUserId,
        ),
        outerTimeout,
      ]);
    } catch (raceErr) {
      if ((raceErr as Error).message === "__OUTER_COMPOSIO_TIMEOUT__") {
        return {
          ok: false,
          type: "tool_call",
          summary: `composio ${app}/${action} timed out after 45s; check Composio status or retry`,
        };
      }
      throw raceErr;
    }
    // Natural-language summary instead of a raw JSON dump. The old code
    // pasted `JSON.stringify(result).slice(0,400)` straight into the
    // operator-visible "Commands executed" row - Marti saw walls of
    // {"data":{"messages":[{"attachmentList":[]...}]}}. Now we render a
    // human line ("Fetched 3 emails", "Sent the message") and keep the
    // raw payload in `detail` for the trace view AND for the two-pass
    // reply - the agent needs the full payload (e.g. email bodies) to
    // actually answer questions about it, so 4000 chars not 1000.
    let preview: string;
    try {
      preview = JSON.stringify(result).slice(0, 4000);
    } catch {
      preview = String(result).slice(0, 4000);
    }
    return {
      ok: true,
      type: "tool_call",
      summary: humanizeToolResult(app, action, result),
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
  // Resolve the speaker's display name for the delegation card. The
  // function only receives `speakerId`; `delegated_by_name` needs the
  // human-readable name so the operator sees who farmed the task out.
  const { data: speakerRow } = await db
    .from("rgaios_agents")
    .select("name")
    .eq("id", speakerId)
    .maybeSingle();
  const speakerName =
    (speakerRow as { name: string } | null)?.name ?? "an agent";
  // Create a routine + a pending run scoped to the assignee. The chat
  // task pipeline (tasks.ts executeChatTask) runs the assignee's chat
  // reply against this task description and stores the output. Same
  // shape rgaios_routines + rgaios_routine_runs use, so the Tasks tab
  // surfaces it identically.
  //
  // kind='delegation': this is a one-shot delegation artifact, not an
  // automated workflow (no trigger). Tagging it keeps it out of the
  // /routines list (listRoutinesForOrg filters to kind='workflow') so
  // delegation churn doesn't drown the real routines. Still visible via
  // the Tasks tab, which queries rgaios_routine_runs directly.
  const { data: routine, error: rErr } = await db
    .from("rgaios_routines")
    .insert({
      organization_id: orgId,
      title: taskText.slice(0, 200),
      description: taskText.slice(0, 4000),
      assignee_agent_id: resolved.id,
      status: "active",
      kind: "delegation",
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
    // Inline-execute the delegated run so the caller's reply can include
    // the actual delegated output. dispatchRun used to fire-and-forget
    // via after(), but Next.js 16 streaming responses don't reliably
    // flush after() until the SSE closes, leaving runs pending past the
    // poll deadline. Awaiting executeRun here blocks the agent_invoke
    // command result by ~5-30s but makes the orchestration deterministic.
    try {
      await import("@/lib/runs/executor").then((m) =>
        m.executeRun(runId, orgId),
      );
    } catch (err) {
      console.warn(
        `[agent-commands] executeRun failed inline for run ${runId}: ${(err as Error).message}`,
      );
    }
  }

  // Mirror the delegated run's outcome onto the CALLER's chat thread so
  // operator-side scrollback (and follow-up DMs from peer agents like
  // Marti -> Scan) retains the context of what Scan just farmed out to
  // Kasia. Without this, tasks.ts only writes to the assignee's thread
  // and the caller's chat loses the result across turns.
  //
  // Hoisted to function scope (not the `if (runId)` block) so the final
  // return can carry the real delegated output + status in `detail` -
  // the chat route streams that straight into the orchestration card so
  // the operator sees the dept head's ACTUAL result live, not just
  // "dispatched" + a refresh-only DB row.
  let finalStatus: string | null = null;
  let runOutput: Record<string, unknown> | null = null;
  let runError: string | null = null;
  if (runId) {
    const pollDeadline = Date.now() + 60_000;
    while (Date.now() < pollDeadline) {
      const { data: polled } = await db
        .from("rgaios_routine_runs")
        .select("status, output, error")
        .eq("id", runId)
        .maybeSingle();
      const row = polled as
        | { status: string | null; output: unknown; error: string | null }
        | null;
      if (
        row &&
        row.status &&
        row.status !== "pending" &&
        row.status !== "running"
      ) {
        finalStatus = row.status;
        runOutput =
          row.output && typeof row.output === "object" && !Array.isArray(row.output)
            ? (row.output as Record<string, unknown>)
            : null;
        runError = row.error ?? null;
        break;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }

    try {
      if (finalStatus === "succeeded") {
        // Run output shape depends on the executor path:
        //   executeRun (agent_invoke uses this) -> { text, stepCount, ... }
        //   executeChatTask                     -> { reply, executed_inline }
        // Read all three keys so the delegated output surfaces either way.
        const summaryRaw =
          (runOutput?.summary as string | undefined) ??
          (runOutput?.reply as string | undefined) ??
          (runOutput?.text as string | undefined) ??
          "";
        await db.from("rgaios_agent_chat_messages").insert({
          organization_id: orgId,
          agent_id: speakerId,
          user_id: null,
          role: "system",
          content: `Delegated to ${resolved.name}: ${summaryRaw.slice(0, 800)}`,
          metadata: {
            kind: "agent_invoke_completed",
            delegated_to: resolved.id,
            routine_run_id: runId,
          },
        } as never);
      } else {
        const errText =
          runError ??
          (finalStatus === null
            ? "timeout waiting for delegated run"
            : `run ended with status=${finalStatus}`);
        await db.from("rgaios_agent_chat_messages").insert({
          organization_id: orgId,
          agent_id: speakerId,
          user_id: null,
          role: "system",
          content: `Delegated to ${resolved.name} failed: ${errText.slice(0, 200)}`,
          metadata: {
            kind: "agent_invoke_failed",
            delegated_to: resolved.id,
            routine_run_id: runId,
          },
        } as never);
      }
    } catch (err) {
      console.warn(
        `[agent-commands] caller-thread mirror insert failed for run ${runId}: ${(err as Error).message}`,
      );
    }
  }

  // The real delegated output (the dept head's actual reply), pulled
  // from the polled run. This is what makes the orchestration "real" on
  // the operator's screen - the handoff card shows what the agent
  // produced, not just that a dispatch happened.
  const delegatedOutput =
    (runOutput?.summary as string | undefined) ??
    (runOutput?.reply as string | undefined) ??
    (runOutput?.text as string | undefined) ??
    null;
  const delegationOk = finalStatus === "succeeded";

  // summary: on success, lead with the actual result so even the flat
  // text fallback (legacy bubble / Telegram) carries real content.
  const summary = delegationOk && delegatedOutput
    ? `${resolved.name} delivered: ${delegatedOutput.slice(0, 400)}`
    : finalStatus && !delegationOk
      ? `${resolved.name} run ${finalStatus}: ${(runError ?? "no error text").slice(0, 200)}`
      : `Dispatched to ${resolved.name}: ${taskText.slice(0, 120)}`;

  return {
    ok: true,
    type: "agent_invoke",
    summary,
    detail: {
      routine_id: routineId,
      run_id: runId,
      assignee_agent_id: resolved.id,
      assignee_name: resolved.name,
      delegated_by_name: speakerName,
      task: taskText.slice(0, 400),
      delegated_status: finalStatus ?? "timeout",
      delegated_output: delegatedOutput,
      delegated_error: runError,
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
      // Resolve org timezone. Prefer the calendar booking default
      // timezone (set by operator on /booking/calendar), fall back
      // to UTC. Audit caught "9am every morning" firing at 6am local
      // for Sao Paulo because the trigger persisted timezone="UTC".
      let tz = "UTC";
      try {
        const { data: bind } = await db
          .from("rgaios_calendar_bindings")
          .select("default_timezone")
          .eq("organization_id", orgId)
          .maybeSingle();
        const fromBind = (bind as { default_timezone?: string } | null)
          ?.default_timezone;
        if (fromBind && typeof fromBind === "string" && fromBind.trim()) {
          tz = fromBind;
        }
      } catch {}
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
          config: { preset: "custom", cron, timezone: tz },
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
  /**
   * Optional: fired once per command, just BEFORE it executes. The chat
   * route uses this to stream a live "Kasia is answering now" /
   * "Running gmail" status to the operator while the (slow) tool call
   * or delegated run is in flight.
   */
  onProgress?: (ev: { type: string; label: string }) => void;
}): Promise<ExtractCommandsResult> {
  const { orgId, speakerAgentId, reply, callerUserId, onProgress } = input;
  const wrappedMatches = [...reply.matchAll(COMMAND_BLOCK_RE)];

  // Two-pass: prefer wrapped <command> blocks (canonical), then fall back
  // to bare JSON detection for LLM responses that drop the XML wrapper.
  type Pending = { type: string; body: string; rawSpan: string | null };
  const pending: Pending[] = wrappedMatches.map((m) => ({
    type: (m[1] ?? "").trim().toLowerCase(),
    body: m[2] ?? "",
    rawSpan: null,
  }));

  let visibleReply = reply.replace(COMMAND_BLOCK_RE, "").trim();

  if (pending.length === 0) {
    const bare = extractBareJsonCommands(reply);
    for (const b of bare) {
      pending.push({ type: b.type, body: b.body, rawSpan: b.rawSpan });
      visibleReply = visibleReply.replace(b.rawSpan, "").trim();
    }
  }

  if (pending.length === 0) {
    return { visibleReply: reply, results: [] };
  }

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
  for (const m of pending) {
    const type = m.type;
    const payload = tryParseJson(m.body);
    if (payload === null) {
      results.push({
        ok: false,
        type,
        summary: `command type=${type}: body is not valid JSON`,
      });
      continue;
    }
    // Live progress: tell the operator what is about to run BEFORE the
    // (slow) call starts - "Basia is answering now", "Running gmail".
    if (onProgress) {
      let label = type;
      if (type === "agent_invoke") {
        label = (payload as { agent?: string }).agent?.trim() || "an agent";
      } else if (type === "tool_call") {
        const tp = payload as {
          tool?: string;
          args?: { app?: string; action?: string };
        };
        label =
          tp.tool === "composio_use_tool"
            ? (tp.args?.app || tp.args?.action || "a tool")
            : tp.tool || "a tool";
      } else if (type === "routine_create") {
        label = (payload as { title?: string }).title?.trim() || "a routine";
      }
      try {
        onProgress({ type, label });
      } catch {
        /* progress is best-effort - never block execution */
      }
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
