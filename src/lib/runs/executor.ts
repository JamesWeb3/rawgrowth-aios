import { spawn } from "node:child_process";
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

// Hard cap per CTO brief §02 + §P07 + day1-reply §1.
const MAX_STEPS = 10;
// Wall-clock cap per CTO brief §02 + R05. Drains cleanly via AbortController.
const WALL_CLOCK_MS = 120_000;

// Aliases for runtime ids that the AI SDK expects in a different form.
// Anything not in this map is passed through verbatim; unknown values
// (e.g. gpt-4.1, gemini-2.5-pro) reach @ai-sdk/anthropic as-is and the
// SDK will surface its own error rather than silently routing to Sonnet.
const RUNTIME_ALIASES: Record<string, string> = {
  "claude-haiku-4-5-20251001": "claude-haiku-4-5",
};
const DEFAULT_RUNTIME = "claude-sonnet-4-6";

function runtimeToModel(runtime: string | null | undefined): string {
  if (!runtime) return DEFAULT_RUNTIME;
  return RUNTIME_ALIASES[runtime] ?? runtime;
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

    // Load context in parallel to avoid N+1 latency. Per CTO day1-reply §1:
    // each manager run loads brand profile + last 20 memories + pending inbox.
    const [brandVoice, recentMemory, pendingInbox] = await Promise.all([
      loadBrandVoice(run.organization_id),
      loadAgentMemory(run.organization_id, agent?.id ?? null),
      loadPendingInbox(run.organization_id, agent?.id ?? null),
    ]);
    const systemPrompt = buildSystemPrompt(
      routine.title,
      routine.description,
      agent,
      brandVoice,
      recentMemory,
      pendingInbox,
    );
    const userMessage = buildUserMessage(run, trigger);

    const abortCtl = new AbortController();
    const wallClockTimer = setTimeout(() => abortCtl.abort(), WALL_CLOCK_MS);
    let result;
    try {
      // Runtime selector per CTO brief §02 Decision 2:
      //   Path A (RUNTIME_PATH=cli): Claude Code CLI subprocess. Reuses the
      //     operator's Max OAuth token in ~/.claude. No ANTHROPIC_API_KEY
      //     needed. MCP tool use only fires if the operator has registered
      //     this v3 MCP server in claude_desktop_config (operational).
      //   Path B (default): @ai-sdk/anthropic + Commercial API key. Full
      //     in-process tool use via the AI SDK toolset.
      // One env var flips per-VPS. Both paths build from the same systemPrompt
      // + userMessage so prompt drift can't sneak between them.
      if (process.env.RUNTIME_PATH === "cli") {
        const text = await generateViaClaudeCli(
          systemPrompt,
          userMessage,
          abortCtl.signal,
        );
        result = { text, steps: [] as unknown[] };
      } else {
        result = await generateText({
          model: anthropic(runtimeToModel(agent?.runtime)),
          system: systemPrompt,
          prompt: userMessage,
          tools,
          stopWhen: stepCountIs(MAX_STEPS),
          abortSignal: abortCtl.signal,
        });
      }
    } finally {
      clearTimeout(wallClockTimer);
    }

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
    // Swallow the throw  -  callers fire-and-forget.
    console.error("[executor]", runId, message);
  }
}

/**
 * Path A runtime: spawn `claude --print` as a subprocess and read stdout.
 * Reuses the host's Claude Max OAuth token (lives in ~/.claude/), no API
 * key on the request path. Tool use fires only if the host's
 * claude_desktop_config registers this v3 MCP server; otherwise the model
 * just generates text. The wall-clock cap is shared with Path B via the
 * abort signal so a stuck CLI doesn't outlive the executor's timeout.
 */
function generateViaClaudeCli(
  systemPrompt: string,
  userMessage: string,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const bin = process.env.CLAUDE_CLI_PATH ?? "claude";
    const child = spawn(
      bin,
      ["--print", "--dangerously-skip-permissions"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    const onAbort = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });

    let out = "";
    let err = "";
    child.stdout.on("data", (b) => {
      out += b.toString("utf8");
    });
    child.stderr.on("data", (b) => {
      err += b.toString("utf8");
    });
    child.on("error", (e) => {
      signal.removeEventListener("abort", onAbort);
      reject(e);
    });
    child.on("close", (code) => {
      signal.removeEventListener("abort", onAbort);
      if (code !== 0) {
        reject(
          new Error(
            `claude --print exited ${code}: ${err.slice(0, 500) || "(no stderr)"}`,
          ),
        );
        return;
      }
      resolve(out.trim());
    });

    // Pipe the merged prompt as stdin. Claude Code's --print mode reads the
    // user message from stdin and ignores --system flags in some versions,
    // so we prepend the system block to the user message and let the model
    // read both as one input.
    child.stdin.write(`${systemPrompt}\n\n---\n\n${userMessage}`);
    child.stdin.end();
  });
}

// ─── System prompt ──────────────────────────────────────────────────

async function loadBrandVoice(organizationId: string): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from("rgaios_brand_profiles")
    .select("content")
    .eq("organization_id", organizationId)
    .eq("status", "approved")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const content = (data as { content: string | null } | null)?.content;
  return content && content.trim().length > 0 ? content.trim() : null;
}

export type MemoryEntry = {
  ts: string;
  kind: string;
  detail: Record<string, unknown> | null;
};

export type InboxEntry = {
  received_at: string;
  chat_id: number;
  sender: string | null;
  text: string | null;
};

/**
 * Last N audit_log entries scoped to this agent (filtered by
 * detail->>'agent_id'). Mirrors the agent panel "memory" tab in
 * src/app/agents/[id]/page.tsx so what the model sees matches the UI.
 */
async function loadAgentMemory(
  organizationId: string,
  agentId: string | null,
  limit = 20,
): Promise<MemoryEntry[]> {
  if (!agentId) return [];
  const { data } = await supabaseAdmin()
    .from("rgaios_audit_log")
    .select("ts, kind, detail")
    .eq("organization_id", organizationId)
    .filter("detail->>agent_id", "eq", agentId)
    .order("ts", { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as Array<{
    ts: string;
    kind: string;
    detail: Record<string, unknown> | null;
  }>;
  return rows.map((r) => ({ ts: r.ts, kind: r.kind, detail: r.detail }));
}

/**
 * Unanswered Telegram messages for this agent's connection. Bound via
 * rgaios_connections.agent_id (added in 0024_connection_agent_link).
 * Returns empty when the agent has no telegram connection wired up.
 */
async function loadPendingInbox(
  organizationId: string,
  agentId: string | null,
  limit = 20,
): Promise<InboxEntry[]> {
  if (!agentId) return [];
  const db = supabaseAdmin();
  const { data: conn } = await db
    .from("rgaios_connections")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("agent_id", agentId)
    .eq("provider_config_key", "telegram")
    .eq("status", "connected")
    .maybeSingle();
  const connId = (conn as { id: string } | null)?.id;
  if (!connId) return [];
  const { data } = await db
    .from("rgaios_telegram_messages")
    .select("received_at, chat_id, sender_username, sender_first_name, text")
    .eq("organization_id", organizationId)
    .eq("connection_id", connId)
    .is("responded_at", null)
    .order("received_at", { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as Array<{
    received_at: string;
    chat_id: number;
    sender_username: string | null;
    sender_first_name: string | null;
    text: string | null;
  }>;
  return rows.map((m) => ({
    received_at: m.received_at,
    chat_id: m.chat_id,
    sender:
      m.sender_username != null
        ? `@${m.sender_username}`
        : m.sender_first_name,
    text: m.text,
  }));
}

const SECTION_CHAR_CAP = 2000;

function capSection(body: string): string {
  if (body.length <= SECTION_CHAR_CAP) return body;
  return `${body.slice(0, SECTION_CHAR_CAP)}... [truncated]`;
}

function renderMemorySection(entries: MemoryEntry[]): string | null {
  if (entries.length === 0) return null;
  const lines = entries.map((e) => {
    // Compact detail to a one-line excerpt; full detail lives in DB.
    const detailStr = e.detail
      ? JSON.stringify(e.detail).replace(/\s+/g, " ").slice(0, 200)
      : "";
    return `- [${e.ts}] ${e.kind}: ${detailStr}`;
  });
  return capSection(lines.join("\n"));
}

function renderInboxSection(entries: InboxEntry[]): string | null {
  if (entries.length === 0) return null;
  const lines = entries.map((m) => {
    const who = m.sender ?? `chat ${m.chat_id}`;
    const excerpt = (m.text ?? "").replace(/\s+/g, " ").slice(0, 240);
    return `- [${m.received_at}] from ${who} (chat_id ${m.chat_id}): ${excerpt}`;
  });
  return capSection(lines.join("\n"));
}

function buildSystemPrompt(
  routineTitle: string,
  routineInstructions: string | null,
  agent: RunContext["agent"],
  brandVoice: string | null,
  recentMemory: MemoryEntry[],
  pendingInbox: InboxEntry[],
): string {
  const agentIntro = agent
    ? `You are ${agent.name}${agent.title ? `, ${agent.title}` : ""}, an AI employee at this organization. Role: ${agent.role}.${agent.description ? `\n\nYour responsibilities: ${agent.description}` : ""}`
    : `You are an autonomous AI agent running a routine for this organization.`;

  const lines = [
    agentIntro,
    "",
    `You are currently executing the routine "${routineTitle}". The user's instructions are below. Follow them precisely.`,
    "",
    "**Operating rules:**",
    "- Use the provided tools to read data, take actions, and gather context. Do not fabricate facts  -  call tools when you need information.",
    "- Tools that write (draft emails, create docs, etc.) are labelled as such; prefer draft-first tools over direct-send when both exist.",
    "- When the routine is complete, return a short plain-text summary of what you did and any links (draft URLs, file ids, etc.) the user needs.",
    "- Stop after at most a dozen tool calls. If you need more, ask for approval instead of looping.",
  ];

  if (brandVoice) {
    lines.push(
      "",
      "**Brand profile (use this voice in all user-facing copy):**",
      brandVoice,
    );
  }

  const memorySection = renderMemorySection(recentMemory);
  if (memorySection) {
    lines.push(
      "",
      `**Recent memory (last ${recentMemory.length} entries):**`,
      memorySection,
    );
  }

  const inboxSection = renderInboxSection(pendingInbox);
  if (inboxSection) {
    lines.push(
      "",
      "**Pending inbox (unanswered messages):**",
      inboxSection,
    );
  }

  lines.push(
    "",
    "**Routine instructions:**",
    routineInstructions ?? "(no instructions provided)",
  );

  return lines.join("\n");
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
        // Read tools are never gated  -  policy only matters for writes.
        const policy = t.isWrite ? configured : "direct";
        const typedArgs = (args ?? {}) as Record<string, unknown>;

        if (policy === "requires_approval") {
          await createApproval({
            organizationId: toolCtx.organizationId,
            routineRunId: runId,
            agentId,
            toolName: t.name,
            toolArgs: typedArgs,
            reason: `Agent attempted ${t.name}  -  write policy requires approval.`,
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
