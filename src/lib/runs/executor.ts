import { anthropic } from "@ai-sdk/anthropic";
import {
  generateText,
  stepCountIs,
  jsonSchema,
  tool,
  type ToolSet,
} from "ai";

import { supabaseAdmin } from "@/lib/supabase/server";
import {
  callTool,
  listTools,
  text as toolText,
} from "@/lib/mcp/registry";
import type { ToolContext } from "@/lib/mcp/types";
import { createApproval } from "@/lib/approvals/queries";
import {
  claimRun,
  finaliseRun,
  type RunContext,
} from "./queries";

// Load every tool module so they register into the in-memory registry.
import "@/lib/mcp/tools";

const MAX_STEPS = 12;

/** Map our agent.runtime strings to AI SDK model ids. */
function runtimeToModel(runtime: string): string {
  switch (runtime) {
    case "claude-opus-4-7":
      return "claude-opus-4-7";
    case "claude-haiku-4-5":
      return "claude-haiku-4-5";
    case "claude-sonnet-4-5":
    default:
      return "claude-sonnet-4-5";
  }
}

/**
 * Execute a single pending run end-to-end:
 *   1. Claim it (atomic status=pending→running).
 *   2. Build the system prompt from the routine + agent.
 *   3. Expose every registered MCP tool to the model.
 *   4. Let the model loop until it stops calling tools (or MAX_STEPS).
 *   5. Record the final output to the run row.
 *
 * Errors are caught and recorded to the run's error column; never rethrown
 * from the top-level so webhook callers don't see 500s.
 */
export async function executeRun(runId: string): Promise<void> {
  let ctx: RunContext | null = null;
  try {
    ctx = await claimRun(runId);
    if (!ctx) return; // already claimed by another worker, or not pending

    const { routine, agent, run, trigger } = ctx;
    const toolCtx: ToolContext = { organizationId: run.organization_id };
    const writePolicy = (agent?.write_policy ?? {}) as Record<
      string,
      "direct" | "requires_approval" | "draft_only"
    >;
    const tools = buildToolset(
      toolCtx,
      run.id,
      agent?.id ?? null,
      writePolicy,
    );

    const systemPrompt = buildSystemPrompt(routine.title, routine.description, agent);
    const userMessage = buildUserMessage(run, trigger);

    const result = await generateText({
      model: anthropic(runtimeToModel(agent?.runtime ?? "claude-sonnet-4-5")),
      system: systemPrompt,
      prompt: userMessage,
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
    });

    await finaliseRun(
      runId,
      "succeeded",
      {
        text: result.text,
        stepCount: result.steps?.length ?? 0,
        toolCalls: result.steps?.flatMap((s) =>
          s.content
            .filter((c) => c.type === "tool-call")
            .map((c) => (c as { toolName: string }).toolName),
        ),
      },
    );

    await auditLog(run.organization_id, "run_succeeded", {
      run_id: run.id,
      routine_id: routine.id,
      agent_id: agent?.id ?? null,
      text_preview: result.text.slice(0, 500),
    });
  } catch (err) {
    const message = (err as Error).message ?? "unknown error";
    if (ctx) {
      await finaliseRun(runId, "failed", null, message);
      await auditLog(ctx.run.organization_id, "run_failed", {
        run_id: ctx.run.id,
        error: message,
      });
    }
    // Swallow the throw — callers fire-and-forget.
    console.error("[executor]", runId, message);
  }
}

// ─── System prompt ──────────────────────────────────────────────────

function buildSystemPrompt(
  routineTitle: string,
  routineInstructions: string | null,
  agent: RunContext["agent"],
): string {
  const agentIntro = agent
    ? `You are ${agent.name}${agent.title ? `, ${agent.title}` : ""}, an AI employee at this organization. Role: ${agent.role}.${agent.description ? `\n\nYour responsibilities: ${agent.description}` : ""}`
    : `You are an autonomous AI agent running a routine for this organization.`;

  return [
    agentIntro,
    "",
    `You are currently executing the routine "${routineTitle}". The user's instructions are below. Follow them precisely.`,
    "",
    "**Operating rules:**",
    "- Use the provided tools to read data, take actions, and gather context. Do not fabricate facts — call tools when you need information.",
    "- Tools that write (draft emails, create docs, etc.) are labelled as such; prefer draft-first tools over direct-send when both exist.",
    "- When the routine is complete, return a short plain-text summary of what you did and any links (draft URLs, file ids, etc.) the user needs.",
    "- Stop after at most a dozen tool calls. If you need more, ask for approval instead of looping.",
    "",
    "**Routine instructions:**",
    routineInstructions ?? "(no instructions provided)",
  ].join("\n");
}

function buildUserMessage(
  run: RunContext["run"],
  trigger: RunContext["trigger"],
): string {
  const triggerLabel = trigger?.kind ?? run.source;
  const lines = [
    `**Trigger**: ${triggerLabel}`,
    `**Run id**: ${run.id}`,
    "",
  ];
  if (run.input_payload && Object.keys(run.input_payload).length > 0) {
    lines.push("**Input payload**:");
    lines.push("```json");
    lines.push(JSON.stringify(run.input_payload, null, 2));
    lines.push("```");
  } else {
    lines.push("No input payload. Work from the routine instructions alone.");
  }
  lines.push("");
  lines.push("Execute the routine now.");
  return lines.join("\n");
}

// ─── Toolset construction ──────────────────────────────────────────

function buildToolset(
  toolCtx: ToolContext,
  runId: string,
  agentId: string | null,
  writePolicy: Record<string, "direct" | "requires_approval" | "draft_only">,
): ToolSet {
  const mcpTools = listTools();
  const explicit = Object.keys(writePolicy).length > 0;
  const toolset: ToolSet = {};
  for (const t of mcpTools) {
    // write_policy keys are either an integration id (grants every tool
    // under that integration) or a workspace tool name. Policy on the
    // integration key applies to all its write tools.
    const policyKey = t.requiresIntegration ?? t.name;
    // Explicit mode: only offer tools the user enabled on the agent.
    // Legacy mode (empty policy): offer everything so older agents keep working.
    if (explicit && !(policyKey in writePolicy)) continue;
    toolset[t.name] = tool({
      description: t.description,
      inputSchema: jsonSchema(t.inputSchema as Record<string, unknown>),
      execute: async (args: unknown) => {
        const configured = writePolicy[policyKey] ?? "direct";
        // Read tools are never gated — policy only matters for writes.
        const policy = t.isWrite ? configured : "direct";
        const typedArgs = (args ?? {}) as Record<string, unknown>;

        if (policy === "requires_approval") {
          await createApproval({
            organizationId: toolCtx.organizationId,
            routineRunId: runId,
            agentId,
            toolName: t.name,
            toolArgs: typedArgs,
            reason: `Agent attempted ${t.name} — write policy requires approval.`,
          });
          await auditLog(toolCtx.organizationId, "approval_requested", {
            run_id: runId,
            agent_id: agentId,
            tool: t.name,
          });
          return `Action "${t.name}" requires human approval and has been queued in the Approvals inbox. It will execute once a human approves. Do not retry.`;
        }

        const result = await callTool(t.name, typedArgs, toolCtx);
        await auditLog(toolCtx.organizationId, "tool_call", {
          run_id: runId,
          agent_id: agentId,
          tool: t.name,
          is_error: result.isError ?? false,
        });
        const flat = result.content.map((c) => c.text).join("\n");
        return flat;
      },
    });
  }
  return toolset;
}

// Suppress unused-helper warning; kept exposed for future use.
void toolText;

// ─── Audit helper ──────────────────────────────────────────────────

async function auditLog(
  organizationId: string,
  kind: string,
  detail: Record<string, unknown>,
) {
  try {
    await supabaseAdmin()
      .from("rgaios_audit_log")
      .insert({
        organization_id: organizationId,
        kind,
        actor_type: "system",
        actor_id: "executor",
        detail,
      });
  } catch {
    /* audit must not fail the run */
  }
}
