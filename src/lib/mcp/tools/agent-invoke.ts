import { supabaseAdmin } from "@/lib/supabase/server";
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

registerTool({
  name: "agent_invoke",
  description:
    "Delegate a task to another agent in this organization. The target " +
    "agent runs the task and returns a single text reply. Use when the " +
    "current manager persona needs a sub-agent's specialty (e.g., a " +
    "Copywriter's draft) mid-conversation.",
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
      timeout_ms: {
        type: "number",
        description:
          "How long to wait for completion. Defaults to 90s (must be <120s wall-clock cap).",
      },
    },
  },
  handler: async (args, ctx) => {
    const agentId = String(args.agent_id ?? "").trim();
    const prompt = String(args.prompt ?? "").trim();
    const timeoutMs = Math.min(Number(args.timeout_ms ?? 90_000) || 90_000, 120_000);
    if (!agentId || !prompt) {
      return textError("agent_id and prompt are required.");
    }

    const db = supabaseAdmin();

    const { data: target } = await db
      .from("rgaios_agents")
      .select("id, name, title")
      .eq("id", agentId)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    if (!target) return textError("Agent not found in this organization.");

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
      const { data: created, error } = await db
        .from("rgaios_routines")
        .insert({
          organization_id: ctx.organizationId,
          title: INVOKE_ROUTINE_TITLE,
          description:
            "Auto-created by agent_invoke. Holds direct manager→sub-agent delegations so their run history stays grouped.",
          assignee_agent_id: agentId,
          status: "active",
        })
        .select("id")
        .single();
      if (error || !created) {
        return textError(`Could not create invocation routine: ${error?.message ?? "unknown"}`);
      }
      routineId = created.id;
    }

    // Enqueue the run.
    const { data: run, error: runErr } = await db
      .from("rgaios_routine_runs")
      .insert({
        organization_id: ctx.organizationId,
        routine_id: routineId,
        source: "agent_invoke",
        status: "pending",
        input_payload: { prompt, invoked_by: "manager" },
      })
      .select("id")
      .single();
    if (runErr || !run) {
      return textError(`Could not enqueue invocation: ${runErr?.message ?? "unknown"}`);
    }

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
