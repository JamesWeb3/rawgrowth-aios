import { supabaseAdmin } from "@/lib/supabase/server";
import { dispatchRun } from "@/lib/runs/dispatch";
import { registerTool, text, textError } from "../registry";

/**
 * agent_invoke  -  fire-and-relay. A manager persona calls this mid-
 * conversation to ask a sub-agent for something; the reply comes back
 * as a single text block the manager can weave into its own answer.
 *
 * Implementation note: in v3 this does NOT spawn a second Claude Code
 * subprocess. Instead it enqueues a routine run tagged with the target
 * agent and waits (with a cap) for the drain-server to complete it.
 * That reuses the existing runs pipeline and keeps concurrency bounded
 * by the 4-spawn cap.
 */

// Hard ceiling on delegation chain length, mirrored from the chat
// agent-commands surface. A -> B -> C -> D is depth 3 (three hops); a
// fourth hop is refused so re-delegation can't recurse unbounded.
const MAX_DELEGATION_DEPTH = 3;

/**
 * Best-effort discovery of the delegation chain that led to the CALLER
 * of this tool. The MCP ToolContext only carries organizationId +
 * userId - no run id, no input_payload - so the incoming chain is not
 * cleanly threadable. The reachable signal is the DB: find the most
 * recent delegation/agent_invoke run assigned to the caller and read
 * the delegation_chain we wrote onto its input_payload. Empty chain =>
 * the caller is not itself a delegated agent.
 */
async function loadIncomingChain(
  db: ReturnType<typeof supabaseAdmin>,
  orgId: string,
  callerAgentId: string,
): Promise<{ chain: string[]; depth: number }> {
  if (!callerAgentId) return { chain: [], depth: 0 };
  try {
    const { data } = await db
      .from("rgaios_routine_runs")
      .select("input_payload, created_at, rgaios_routines!inner(assignee_agent_id)")
      .eq("organization_id", orgId)
      .eq("rgaios_routines.assignee_agent_id", callerAgentId)
      .in("source", ["chat_command", "agent_invoke"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const ip = (data as { input_payload?: unknown } | null)?.input_payload;
    if (ip && typeof ip === "object" && !Array.isArray(ip)) {
      const o = ip as Record<string, unknown>;
      const chain = Array.isArray(o.delegation_chain)
        ? (o.delegation_chain as unknown[]).filter(
            (x): x is string => typeof x === "string",
          )
        : [];
      const depth =
        typeof o.delegation_depth === "number"
          ? o.delegation_depth
          : chain.length;
      return { chain, depth };
    }
  } catch {
    // DB hiccup must not block delegation - fall back to "no known chain".
  }
  return { chain: [], depth: 0 };
}

registerTool({
  name: "agent_invoke",
  description:
    "Delegate a task to another agent in this organization. The target " +
    "agent runs the task and returns a single text reply. Use when the " +
    "current manager persona needs a sub-agent's specialty (e.g., a " +
    "Copywriter's draft) mid-conversation. For a clean handoff, pass " +
    "output_format (the exact shape you want the reply in) and " +
    "constraints (boundaries: what to avoid, scope limits, tone) - a " +
    "well-scoped handoff gives a sharper sub-agent reply.",
  inputSchema: {
    type: "object",
    required: ["agent_id", "prompt"],
    properties: {
      agent_id: {
        type: "string",
        description: "Which agent to invoke (UUID).",
      },
      prompt: {
        type: "string",
        description: "The task for the target agent, in plain English.",
      },
      output_format: {
        type: "string",
        description:
          "Optional. The exact output shape you expect back (e.g. " +
          "'3 bullet points', 'a JSON object with keys x,y', 'one " +
          "paragraph'). Appended to the task as a labelled block.",
      },
      constraints: {
        type: "string",
        description:
          "Optional. Boundaries for the sub-agent: what to avoid, " +
          "scope limits, tone, tools to prefer. Appended to the task " +
          "as a labelled block.",
      },
      context: {
        type: "string",
        description:
          "Optional. Free-form framing the sub-agent should have " +
          "before it starts: what was already tried, what the bigger " +
          "goal is, why this task matters. Threaded into the sub-agent's " +
          "prompt as a labelled context block.",
      },
      operator_ask: {
        type: "string",
        description:
          "Optional. The original operator question that kicked off " +
          "this delegation. Replayed to the sub-agent as the opening " +
          "user turn so it sees the conversation it is joining.",
      },
      timeout_ms: {
        type: "number",
        description:
          "How long to wait for completion. Defaults to 90s (must be <120s wall-clock cap).",
      },
    },
  },
  handler: async (args, ctx) => {
    const agentId = String(args.agent_id ?? "").trim();
    const basePrompt = String(args.prompt ?? "").trim();
    const outputFormat = String(args.output_format ?? "").trim();
    const constraints = String(args.constraints ?? "").trim();
    const context = String(args.context ?? "").trim();
    const operatorAsk = String(args.operator_ask ?? "").trim();
    const timeoutMs = Math.min(Number(args.timeout_ms ?? 90_000) || 90_000, 120_000);
    if (!agentId || !basePrompt) {
      return textError("agent_id and prompt are required.");
    }
    // Structured handoff: objective first, then optional OUTPUT FORMAT /
    // CONSTRAINTS blocks. A call with only `prompt` produces exactly
    // basePrompt - fully backward compatible with existing callers.
    const prompt = [
      basePrompt,
      outputFormat ? `OUTPUT FORMAT: ${outputFormat}` : "",
      constraints ? `CONSTRAINTS: ${constraints}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const db = supabaseAdmin();

    const { data: target } = await db
      .from("rgaios_agents")
      .select("id, name, title")
      .eq("id", agentId)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    if (!target) return textError("Agent not found in this organization.");

    // Cycle + depth guard (GAP #18 / Marti client-acceptance.html PHASE-0).
    // PRE-FIX: this keyed the incoming-chain lookup off ctx.userId. But
    // loadIncomingChain joins through rgaios_routines on
    // assignee_agent_id - which is an AGENT id, never a user id. So
    // for every agent->agent invocation the lookup matched zero rows,
    // returned an empty chain, and the MAX_DELEGATION_DEPTH=3 cap
    // never fired. A runaway delegation chain could recurse without
    // limit (P0 abuse vector flagged in Marti client-acceptance.html
    // PHASE-0 pre-req).
    //
    // POST-FIX: key the lookup off ctx.agentId. ToolContext.agentId
    // (src/lib/mcp/types.ts:14) is populated by exactly the
    // in-process call paths that constitute an agent->agent
    // delegation chain: executor, execToolCall (chat speaker),
    // decideApproval (stored approval row). When agentId is null
    // (external bearer-token MCP client - not part of a delegation
    // chain by definition) loadIncomingChain short-circuits to an
    // empty chain so the call still proceeds.
    const incoming = await loadIncomingChain(
      db,
      ctx.organizationId,
      String(ctx.agentId ?? ""),
    );
    if (incoming.chain.includes(agentId)) {
      return textError(
        `agent_invoke refused - delegation cycle: ${target.name} is already in this chain.`,
      );
    }
    if (incoming.depth + 1 > MAX_DELEGATION_DEPTH) {
      return textError(
        `agent_invoke refused - delegation depth limit (${MAX_DELEGATION_DEPTH}) reached; chain is too long to fan out further.`,
      );
    }
    // Outgoing chain = incoming chain + this hop's target. We append the
    // target (the MCP surface can't supply a verified caller id) so the
    // assignee's own follow-up agent_invoke sees a chain that includes
    // it, and the cycle check above still fires on re-entry.
    const outgoingChain = [...incoming.chain, agentId];
    const outgoingDepth = outgoingChain.length;

    // Find-or-create an "ad-hoc invocation" routine for this agent. We use
    // one long-lived routine per agent so run history stays grouped in the
    // dashboard under a recognisable title.
    const INVOKE_ROUTINE_TITLE = `Direct invocation  -  ${target.name}`;

    const { data: routine } = await db
      .from("rgaios_routines")
      .select("id, status")
      .eq("organization_id", ctx.organizationId)
      .eq("assignee_agent_id", agentId)
      .eq("title", INVOKE_ROUTINE_TITLE)
      .maybeSingle();

    let routineId = (routine as { id?: string } | null)?.id ?? null;
    if (!routineId) {
      // kind='delegation': this is a delegation holder, not an automated
      // workflow - it has no trigger. Keeps it off the /routines list
      // (listRoutinesForOrg filters to kind='workflow'); run history is
      // still reachable via the Tasks tab / runs queries.
      const { data: created, error } = await db
        .from("rgaios_routines")
        .insert({
          organization_id: ctx.organizationId,
          title: INVOKE_ROUTINE_TITLE,
          description:
            "Auto-created by agent_invoke. Holds direct manager→sub-agent delegations so their run history stays grouped.",
          assignee_agent_id: agentId,
          status: "active",
          kind: "delegation",
        })
        .select("id")
        .single();
      if (error || !created) {
        return textError(`Could not create invocation routine: ${error?.message ?? "unknown"}`);
      }
      routineId = created.id;
    }

    // Enqueue the run. Beyond `prompt` (the composed task text), write
    // the structured handoff fields under the exact names
    // executeChatTask's extractTaskContext reads back - context,
    // constraints, output_format, operator_ask. The READ side
    // (committed a01566c) already threads these into the delegated
    // agent's prompt + history; this is the WRITE side that populates
    // them. constraints / output_format are also folded into `prompt`
    // above for models that ignore history, but writing them structured
    // lets the read side surface each as its own labelled section.
    const inputPayload: Record<string, unknown> = {
      prompt,
      invoked_by: "manager",
      // Delegation chain bookkeeping (see loadIncomingChain). Written
      // on every run so the depth/cycle guard has data to read when
      // the assignee later invokes another agent.
      delegation_depth: outgoingDepth,
      delegation_chain: outgoingChain,
    };
    if (context) inputPayload.context = context;
    if (constraints) inputPayload.constraints = constraints;
    if (outputFormat) inputPayload.output_format = outputFormat;
    if (operatorAsk) inputPayload.operator_ask = operatorAsk;
    const { data: run, error: runErr } = await db
      .from("rgaios_routine_runs")
      .insert({
        organization_id: ctx.organizationId,
        routine_id: routineId,
        source: "agent_invoke",
        status: "pending",
        input_payload: inputPayload,
      })
      .select("id")
      .single();
    if (runErr || !run) {
      return textError(`Could not enqueue invocation: ${runErr?.message ?? "unknown"}`);
    }

    // Trigger the executor / drain. Without this the run sits in
    // `pending` until the systemd-tick fallback catches it (1-2 min),
    // which always loses the race against the timeoutMs cap below.
    dispatchRun(run.id, ctx.organizationId);

    // Poll for completion with a hard wall-clock cap.
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await new Promise((r) => setTimeout(r, 1500));
      const { data: current } = await db
        .from("rgaios_routine_runs")
        .select("status, output, error")
        .eq("id", run.id)
        .maybeSingle();
      if (!current) break;
      if (current.status === "succeeded") {
        const output = (current.output as { summary?: string } | null)?.summary;
        return text(
          output ?? "Sub-agent completed but returned no summary.",
        );
      }
      if (current.status === "failed") {
        return textError(`Sub-agent failed: ${current.error ?? "unknown error"}`);
      }
    }

    return textError(
      `Sub-agent did not complete within ${Math.round(timeoutMs / 1000)}s. Check the activity feed for progress.`,
    );
  },
});

export const AGENT_INVOKE_TOOL_REGISTERED = true;
