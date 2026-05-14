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
import { tryDecryptSecret } from "@/lib/crypto";
import {
  callTool,
  listTools,
  text as toolText,
} from "@/lib/mcp/registry";
import type { ToolContext } from "@/lib/mcp/types";
import { createApproval } from "@/lib/approvals/queries";
import {
  runOauthToolLoop,
  type OauthToolDef,
  type ToolCallTrace,
} from "@/lib/llm/oauth-anthropic";
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
 *
 * `orgId` scopes the claim + every downstream read to the tenant that
 * owns the run. The service-role client bypasses RLS, so without this a
 * runId from another tenant could be claimed and executed.
 */
export async function executeRun(
  runId: string,
  orgId: string,
): Promise<void> {
  let ctx: RunContext | null = null;
  try {
    ctx = await claimRun(runId, orgId);
    if (!ctx) return; // already claimed by another worker, not pending, or wrong org

    const { routine, agent, run, trigger } = ctx;
    const toolCtx: ToolContext = { organizationId: run.organization_id };
    const writePolicy = (agent?.write_policy ?? {}) as Record<
      string,
      "direct" | "requires_approval" | "draft_only"
    >;
    const { aiSdkTools, oauthTools } = buildToolsets(
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
    let result: NormalisedRunResult;
    try {
      // Runtime selector per CTO brief §02 Decision 2:
      //   Path A (RUNTIME_PATH=cli): Claude Code CLI subprocess. Reuses the
      //     operator's Max OAuth token in ~/.claude. No ANTHROPIC_API_KEY
      //     needed. MCP tool use only fires if the operator has registered
      //     this v3 MCP server in claude_desktop_config (operational).
      //   Path B (default): raw fetch to /v1/messages with the org's
      //     Claude Max OAuth pool (mirrors lib/agent/chat.ts wire shape;
      //     bypasses @ai-sdk/anthropic's opaque "Failed after N attempts.
      //     Last error: Error" wrapper that hid real status codes).
      //     Falls back to @ai-sdk/anthropic + ANTHROPIC_API_KEY when the
      //     pool is empty or fully exhausted, so VPSes with a commercial
      //     key still get a working executor.
      // One env var flips per-VPS. Both paths build from the same systemPrompt
      // + userMessage so prompt drift can't sneak between them.
      if (process.env.RUNTIME_PATH === "cli") {
        const text = await generateViaClaudeCli(
          systemPrompt,
          userMessage,
          abortCtl.signal,
          run.organization_id,
        );
        result = { text, stepCount: 0, toolCalls: [] };
      } else {
        result = await generateWithOauthOrApiKey({
          organizationId: run.organization_id,
          model: runtimeToModel(agent?.runtime),
          systemPrompt,
          userMessage,
          aiSdkTools,
          oauthTools,
          abortSignal: abortCtl.signal,
        });
      }
    } finally {
      clearTimeout(wallClockTimer);
    }

    // "no exception thrown" is not "succeeded". The CLI path can exit 0
    // with an empty string, and either path can return a bare refusal -
    // recording those as succeeded hides real failures. Require some
    // actual output before calling it a success; otherwise fail with a
    // clear reason so the run shows up as needing attention.
    const outText = (result.text ?? "").trim();
    if (outText.length < 2) {
      await finaliseRun(
        runId,
        "failed",
        null,
        "Agent returned no output (empty response from the model runtime).",
      );
      await auditLog(run.organization_id, "run_failed", {
        run_id: run.id,
        routine_id: routine.id,
        agent_id: agent?.id ?? null,
        error: "empty model output",
      });
    } else {
      await finaliseRun(
        runId,
        "succeeded",
        {
          text: result.text,
          stepCount: result.stepCount,
          toolCalls: result.toolCalls,
        },
      );

      await auditLog(run.organization_id, "run_succeeded", {
        run_id: run.id,
        routine_id: routine.id,
        agent_id: agent?.id ?? null,
        text_preview: result.text.slice(0, 500),
      });
    }
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
async function generateViaClaudeCli(
  systemPrompt: string,
  userMessage: string,
  signal: AbortSignal,
  organizationId: string,
): Promise<string> {
  // Wire the org's MCP server (this Next app's /api/mcp endpoint) into
  // the CLI subprocess so spawned agents can fire `composio_use_tool`,
  // `agent_invoke`, etc. via the same tool registry the dashboard uses.
  // Without this, the CLI subprocess sees only Anthropic's built-in
  // Claude Code tools (file ops, bash, web fetch) and reports "tool not
  // available" when asked to invoke a Composio action.
  let mcpConfigPath: string | null = null;
  try {
    const { data: org } = await supabaseAdmin()
      .from("rgaios_organizations")
      .select("mcp_token")
      .eq("id", organizationId)
      .maybeSingle();
    const mcpToken = (org as { mcp_token?: string | null } | null)?.mcp_token;
    const appUrl =
      process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    if (mcpToken) {
      const cfg = {
        mcpServers: {
          rawgrowth: {
            type: "http",
            url: `${appUrl.replace(/\/$/, "")}/api/mcp`,
            headers: { Authorization: `Bearer ${mcpToken}` },
          },
        },
      };
      const os = await import("node:os");
      const path = await import("node:path");
      const fs = await import("node:fs/promises");
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-mcp-"));
      mcpConfigPath = path.join(dir, "mcp.json");
      await fs.writeFile(mcpConfigPath, JSON.stringify(cfg), { mode: 0o600 });
    }
  } catch (err) {
    console.warn(
      `[executor.cli] mcp-config setup failed for org ${organizationId}: ${(err as Error).message}`,
    );
  }

  return new Promise<string>((resolve, reject) => {
    const bin = process.env.CLAUDE_CLI_PATH ?? "claude";
    // Force HOME so claude CLI finds ~/.claude/.credentials.json and
    // ~/.claude.json from the bind-mounted host paths. The Next.js
    // container runs as `nextjs` whose HOME is /nonexistent, so without
    // this the CLI looks at /nonexistent/.claude/* and silently exits.
    const home = process.env.CLAUDE_CLI_HOME ?? "/home/node";
    // --dangerously-skip-permissions FIRST so MCP tool calls don't
    // prompt for per-tool consent inside the headless subprocess.
    const args = ["--dangerously-skip-permissions", "--print"];
    if (mcpConfigPath) args.push("--mcp-config", mcpConfigPath);
    const child = spawn(
      bin,
      args,
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, HOME: home },
      },
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
      // Best-effort cleanup of the temp mcp config (contains the org's
      // MCP bearer token). Fire-and-forget; never blocks the result.
      if (mcpConfigPath) {
        import("node:fs/promises")
          .then(async (fs) => {
            await fs.unlink(mcpConfigPath!).catch(() => {});
            const path = await import("node:path");
            await fs.rmdir(path.dirname(mcpConfigPath!)).catch(() => {});
          })
          .catch(() => {});
      }
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

// ─── Path B dispatcher: OAuth pool first, API key fallback ─────────

type ClaudeMaxRow = {
  id: string;
  user_id: string | null;
  metadata: Record<string, unknown> | null;
};

/**
 * Load every connected claude-max OAuth token for this org, decrypted.
 * Mirrors the rotation order in lib/llm/oauth-first.ts: Fisher-Yates the
 * pool so concurrent runs don't stampede the same token. We don't have a
 * caller user id at the executor layer (runs are headless) so the whole
 * pool is treated as borrowed and shuffled uniformly.
 */
async function loadOauthTokenPool(orgId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin()
    .from("rgaios_connections")
    .select("id, user_id, metadata")
    .eq("organization_id", orgId)
    .eq("provider_config_key", "claude-max")
    .eq("status", "connected");
  if (error || !data) return [];
  const rows = [...(data as unknown as ClaudeMaxRow[])];
  // Fisher-Yates shuffle so multiple in-flight runs don't all start with
  // the same token and immediately stampede its bucket.
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  const tokens: string[] = [];
  for (const row of rows) {
    const meta = (row.metadata ?? {}) as { access_token?: string };
    if (!meta.access_token) continue;
    const tok = tryDecryptSecret(meta.access_token);
    if (tok) tokens.push(tok);
  }
  return tokens;
}

/**
 * Normalised shape both the OAuth raw-fetch loop and the AI SDK
 * fallback flatten into. Keeps `finaliseRun` insulated from upstream
 * SDK shape drift, and means the run row always gets the same
 * (text, stepCount, toolCalls) tuple regardless of which path served
 * the request.
 */
export type NormalisedRunResult = {
  text: string;
  stepCount: number;
  toolCalls: string[];
};

type GenerateOptions = {
  organizationId: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
  /** Toolset for the AI SDK + ANTHROPIC_API_KEY fallback path. */
  aiSdkTools: ToolSet;
  /** Native Anthropic tool defs for the OAuth raw-fetch loop. */
  oauthTools: Record<string, OauthToolDef>;
  abortSignal: AbortSignal;
};

/**
 * Resolve auth and run the agent loop. Order of preference:
 *
 *   1. Org's Claude Max OAuth pool via raw fetch to /v1/messages
 *      (mirrors lib/agent/chat.ts wire shape). Native Anthropic tools
 *      execute server-side via the registered OauthToolDef.execute
 *      callbacks (which wrap the same MCP callTool() + write-policy +
 *      audit logic the AI SDK toolset uses).
 *
 *   2. ANTHROPIC_API_KEY commercial fallback via @ai-sdk/anthropic.
 *      Only reached when the OAuth pool is empty (no Claude Max
 *      connections) AND an API key env is present.
 *
 *   3. Otherwise rethrow the OAuth pool's last error (or a synthetic
 *      "no auth" error) so the run row records a concrete reason.
 *
 * The reason this dropped @ai-sdk/anthropic for OAuth: createAnthropic({
 * authToken }) was wrapping upstream 4xx/5xx into "Failed after 3
 * attempts. Last error: Error" with no surfaced status code, hiding
 * real failures from the run row's error column. Atlas chat already
 * proved a hand-rolled fetch + the same beta header works end-to-end,
 * so executor.ts now reuses that wire shape via lib/llm/oauth-anthropic.
 */
async function generateWithOauthOrApiKey(
  opts: GenerateOptions,
): Promise<NormalisedRunResult> {
  const tokens = await loadOauthTokenPool(opts.organizationId);

  if (tokens.length > 0) {
    try {
      const loop = await runOauthToolLoop({
        tokens,
        model: opts.model,
        // runOauthToolLoop already prepends CLAUDE_CODE_PREFIX when it
        // isn't present, so passing the raw systemPrompt is safe.
        system: opts.systemPrompt,
        userMessage: opts.userMessage,
        tools: opts.oauthTools,
        maxSteps: MAX_STEPS,
        // 4096 matches the chat.ts default; the executor's wall-clock
        // budget caps any single request well below this either way.
        maxTokens: 4096,
        abortSignal: opts.abortSignal,
        logPrefix: "[executor.oauth]",
      });
      return {
        text: loop.text,
        stepCount: loop.steps,
        toolCalls: loop.toolCalls.map((c) => c.name),
      };
    } catch (err) {
      // Pool exhausted or every token returned a non-rotatable error.
      // Fall through to the API key branch only if one is configured -
      // otherwise rethrow so the original status / body text from
      // AnthropicHttpError lands in the run row instead of being
      // shadowed by a generic "no auth" message.
      if (!process.env.ANTHROPIC_API_KEY) throw err;
      console.warn(
        `[executor.oauth] OAuth pool failed (${
          (err as Error).message?.slice(0, 200) ?? "unknown"
        }), falling back to ANTHROPIC_API_KEY`,
      );
    }
  }

  if (process.env.ANTHROPIC_API_KEY) {
    const sdkResult = await generateText({
      model: anthropic(opts.model),
      system: opts.systemPrompt,
      prompt: opts.userMessage,
      tools: opts.aiSdkTools,
      stopWhen: stepCountIs(MAX_STEPS),
      abortSignal: opts.abortSignal,
    });
    return normaliseAiSdkResult(sdkResult);
  }

  throw new Error(
    "No LLM auth available: no Claude Max OAuth token connected for this org and ANTHROPIC_API_KEY is unset. Connect Claude Max at /connections.",
  );
}

/**
 * Flatten the AI SDK's `generateText` result into the executor's
 * normalised tuple. The SDK exposes tool calls inside steps[].content[]
 * with type === "tool-call"; we collect their names so the run row
 * matches what the OAuth loop emits.
 */
function normaliseAiSdkResult(r: {
  text: string;
  steps?: Array<{ content: Array<{ type: string; toolName?: string }> }>;
}): NormalisedRunResult {
  const steps = r.steps ?? [];
  const toolCalls: string[] = [];
  for (const s of steps) {
    for (const c of s.content) {
      if (c.type === "tool-call" && typeof c.toolName === "string") {
        toolCalls.push(c.toolName);
      }
    }
  }
  return { text: r.text, stepCount: steps.length, toolCalls };
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
  // Prefer the role-template system_prompt (the agent's real persona,
  // written by auto-train on hire) over the one-line description.
  // buildAgentChatPreamble uses this exact precedence - without it,
  // every executor run (scheduled routines AND agent_invoke
  // delegations) drops the persona and the agent runs generic.
  const personaBlock =
    (agent?.system_prompt && agent.system_prompt.trim()) ||
    (agent?.description && agent.description.trim()) ||
    "";
  const agentIntro = agent
    ? `You are ${agent.name}${agent.title ? `, ${agent.title}` : ""}, an AI employee at this organization. Role: ${agent.role}.${personaBlock ? `\n\n${personaBlock}` : ""}`
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

// Core composio router tools are the *mechanism* for tool use, not a
// specific integration to gate. They register with no
// `requiresIntegration`, so their policyKey is the bare tool name -
// which an agent's write_policy never lists (policy keys are
// integration ids or workspace tool names). Without this allowlist the
// explicit-mode filter below silently drops `composio_use_tool` (and
// `composio_list_tools`) from any agent that has a configured
// write_policy, leaving routine runs unable to call ANY Composio app.
// write_policy still gates WHICH composio actions/apps run via the
// per-action denylist + approvals flow in composio-router.ts; this only
// keeps the tool itself reachable.
const ALWAYS_AVAILABLE_TOOLS = new Set<string>([
  "composio_use_tool",
  "composio_list_tools",
]);

type BuiltToolsets = {
  /** Shape consumed by @ai-sdk/anthropic's generateText fallback. */
  aiSdkTools: ToolSet;
  /** Native Anthropic tool defs for the OAuth raw-fetch loop. */
  oauthTools: Record<string, OauthToolDef>;
};

/**
 * Build BOTH toolsets in a single pass so the AI SDK fallback and the
 * OAuth raw-fetch loop see the exact same set of tools with identical
 * write-policy + approval + audit semantics. The two surfaces only
 * differ in their wire shape:
 *
 *   - aiSdkTools:  ToolSet of `tool({ description, inputSchema, execute })`
 *     entries the AI SDK feeds to /v1/messages via createAnthropic().
 *   - oauthTools:  Record<name, { spec: AnthropicTool, execute }>` the
 *     OAuth loop feeds verbatim into /v1/messages and uses to dispatch
 *     tool_use blocks back to the same MCP callTool() pipeline.
 *
 * `dispatchTool` is a closure over the policy + audit machinery shared
 * by both wrappers - any change to approval semantics lands in one place.
 */
function buildToolsets(
  toolCtx: ToolContext,
  runId: string,
  agentId: string | null,
  writePolicy: Record<string, "direct" | "requires_approval" | "draft_only">,
): BuiltToolsets {
  // Pass toolCtx so per-org custom tools (R08 isolation) surface to
  // the executor for the org that drafted them, while staying hidden
  // from every other tenant.
  const mcpTools = listTools(toolCtx);
  const explicit = Object.keys(writePolicy).length > 0;
  const aiSdkTools: ToolSet = {};
  const oauthTools: Record<string, OauthToolDef> = {};

  for (const t of mcpTools) {
    // write_policy keys are either an integration id (grants every tool
    // under that integration) or a workspace tool name. Policy on the
    // integration key applies to all its write tools.
    const policyKey = t.requiresIntegration ?? t.name;
    // Explicit mode: only offer tools the user enabled on the agent.
    // Legacy mode (empty policy): offer everything so older agents keep working.
    // Core composio router tools bypass the filter - they're the
    // mechanism for tool use, not a gated integration (see
    // ALWAYS_AVAILABLE_TOOLS above).
    if (
      explicit &&
      !(policyKey in writePolicy) &&
      !ALWAYS_AVAILABLE_TOOLS.has(t.name)
    ) {
      continue;
    }

    const dispatchTool = async (
      typedArgs: Record<string, unknown>,
    ): Promise<string> => {
      const configured = writePolicy[policyKey] ?? "direct";
      // Read tools are never gated  -  policy only matters for writes.
      const policy = t.isWrite ? configured : "direct";

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
      // Fire-and-forget the audit insert so cumulative round-trip
      // latency doesn't push the run past the 120s wall-clock cap
      // when the model makes many tool calls. Audit is observability,
      // not in the critical execution path.
      void auditLog(toolCtx.organizationId, "tool_call", {
        run_id: runId,
        agent_id: agentId,
        tool: t.name,
        is_error: result.isError ?? false,
      }).catch((err) => {
        console.error("[executor.audit] tool_call insert failed", err);
      });
      return result.content.map((c) => c.text).join("\n");
    };

    aiSdkTools[t.name] = tool({
      description: t.description,
      inputSchema: jsonSchema(t.inputSchema as Record<string, unknown>),
      execute: async (args: unknown) =>
        dispatchTool((args ?? {}) as Record<string, unknown>),
    });

    oauthTools[t.name] = {
      spec: {
        name: t.name,
        description: t.description,
        // Anthropic's native tool format expects `input_schema` (snake_case)
        // with a JSON Schema object body. The MCP registry stores schemas
        // in the same JSON Schema shape, so this is a verbatim handoff.
        input_schema: t.inputSchema as Record<string, unknown>,
      },
      execute: dispatchTool,
    };
  }

  return { aiSdkTools, oauthTools };
}

// Suppress unused-helper warning; kept exposed for future use.
void toolText;
// `ToolCallTrace` is re-exported by oauth-anthropic but not referenced
// directly here once the loop result is normalised; keep the import so
// the type stays attached to the symbol the helper actually returns.
type _ToolCallTraceKept = ToolCallTrace;
void ({} as _ToolCallTraceKept);

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
