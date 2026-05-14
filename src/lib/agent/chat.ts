import { spawn } from "node:child_process";

import { supabaseAdmin } from "@/lib/supabase/server";
import { tryDecryptSecret } from "@/lib/crypto";

/**
 * Direct Anthropic Messages API call using the org's stored Claude Max
 * OAuth token. Bypasses the `claude` CLI cold-spawn entirely so Telegram
 * replies feel like a real chatbot (~3-5s end to end vs 10-15s).
 *
 * The model gets full access to this org's Rawgrowth MCP server via
 * the `mcp_servers` parameter  -  same tools the CLI sees (telegram, gmail,
 * routines, agents, knowledge, etc.) in a single API roundtrip.
 *
 * Falls back gracefully when the org doesn't have a Claude Max token
 * connected  -  caller should show "configure Claude Max in Connections"
 * rather than silently failing.
 */

const MODEL = "claude-sonnet-4-6";
// Raised 1024 -> 32768. The agent now opens every reply with a real
// <thinking> ReAct block (see preamble.ts REASONING PROTOCOL) and is
// expected to reason in multiple compounding steps on top of the
// visible answer. 1024 (and even 4096) routinely collided with the cap,
// truncating the reasoning or the reply mid-sentence. 32k is the real
// headroom for genuine multi-step reasoning + a full reply - and
// max_tokens only caps output, it is not pre-paid, so the ceiling is
// free until the model actually uses it. Sonnet 4.6 supports a 64k
// output ceiling; 32k is the safe default that needs no extra beta
// header. The code-generation paths pass their own `maxTokens`
// override (8192) explicitly; callers wanting a tighter budget can
// still override downward.
const DEFAULT_MAX_TOKENS = 32768;
const RECENT_HISTORY = 6;

type AgentChatResult =
  | { ok: true; reply: string }
  | { ok: false; error: string };

type AnthropicContentBlock = {
  type: string;
  text?: string;
  // tool_use, tool_result etc  -  we only render text blocks back to the user.
};

type AnthropicMessageResponse = {
  id: string;
  content: AnthropicContentBlock[];
  stop_reason: string;
  model: string;
};

type RawgrowthAgent = {
  name: string;
  title: string | null;
  description: string | null;
};

type ClaudeMaxRow = {
  id: string;
  user_id: string | null;
  metadata: Record<string, unknown> | null;
};

/**
 * Load every connected Claude Max OAuth token for the org. Caller's own
 * row first (so their bucket is hit before borrowing other members'),
 * then the rest deterministically by row id. Mirrors the rotation order
 * in lib/llm/oauth-first.ts so both code paths drain the same pool the
 * same way - no surprise re-orderings between onboarding chat and agent
 * chat. Returns an empty array if no tokens exist or all decrypt-fail.
 *
 * Each entry pairs the decrypted access_token with the source row's
 * uuid PK so a 401-triggered refresh can scope its UPDATE to that one
 * row instead of clobbering every member's token in the org.
 */
type ClaudeMaxPoolEntry = { rowId: string; token: string };

async function loadClaudeMaxTokenPool(
  organizationId: string,
  callerUserId?: string | null,
): Promise<ClaudeMaxPoolEntry[]> {
  const { data, error } = await supabaseAdmin()
    .from("rgaios_connections")
    .select("id, user_id, metadata")
    .eq("organization_id", organizationId)
    .eq("provider_config_key", "claude-max")
    .eq("status", "connected");
  if (error || !data) return [];
  // Two-step cast: generated types lag the migration that added user_id
  // (0063), so the supabase-js inferred shape still claims the column
  // doesn't exist. Same pattern used in lib/llm/oauth-first.ts.
  const rows = data as unknown as ClaudeMaxRow[];
  const ordered = [...rows].sort((a, b) => {
    const aOwn = callerUserId && a.user_id === callerUserId ? 0 : 1;
    const bOwn = callerUserId && b.user_id === callerUserId ? 0 : 1;
    if (aOwn !== bOwn) return aOwn - bOwn;
    return a.id.localeCompare(b.id);
  });
  const entries: ClaudeMaxPoolEntry[] = [];
  for (const row of ordered) {
    const meta = (row.metadata ?? {}) as { access_token?: string };
    if (!meta.access_token) continue;
    const tok = tryDecryptSecret(meta.access_token);
    if (tok) entries.push({ rowId: row.id, token: tok });
  }
  return entries;
}

/**
 * Per-token cooldown driven by the server's actual retry-after / reset
 * hint, not a guessed fixed window. Most 429s on Claude Max OAuth are
 * the RPM bucket and clear in seconds, not minutes; a flat 5min cooldown
 * was parking healthy tokens uselessly. We now read `retry-after`
 * (RFC 7231) and `anthropic-ratelimit-*-reset` headers per response.
 *
 * Same semantics as oauth-anthropic.ts:markTokenCold so both call sites
 * (chat web surface + executor) behave consistently. Map keyed on the
 * decrypted access_token; cleared on process restart.
 */
const CHAT_TOKEN_COOLDOWN: Map<string, number> = new Map();
const CHAT_DEFAULT_COOLDOWN_MS = 30_000;
const CHAT_MAX_COOLDOWN_MS = 60 * 60_000;

function isChatTokenCold(token: string): boolean {
  const until = CHAT_TOKEN_COOLDOWN.get(token);
  if (!until) return false;
  if (Date.now() >= until) {
    CHAT_TOKEN_COOLDOWN.delete(token);
    return false;
  }
  return true;
}

function markChatTokenCold(
  token: string,
  retryAfterSec: number | null = null,
  resetAt: number | null = null,
): void {
  let waitMs: number;
  if (typeof retryAfterSec === "number" && retryAfterSec > 0) {
    waitMs = retryAfterSec * 1000;
  } else if (typeof resetAt === "number" && resetAt > Date.now()) {
    waitMs = resetAt - Date.now();
  } else {
    waitMs = CHAT_DEFAULT_COOLDOWN_MS;
  }
  waitMs = Math.min(Math.max(waitMs, 5_000), CHAT_MAX_COOLDOWN_MS);
  CHAT_TOKEN_COOLDOWN.set(token, Date.now() + waitMs);
}

/**
 * On Anthropic 401, attempt to silently refresh the access_token
 * using the stored refresh_token. Returns the new access_token on
 * success or null if refresh fails (no refresh_token, refresh
 * endpoint rejected, etc).
 *
 * Scoped to the SPECIFIC row whose token just 401'd. After migration
 * 0063 there can be multiple claude-max rows per org (one per member);
 * an org-wide UPDATE here would clobber every other member's
 * access_token with the freshly-refreshed one - blowing away their
 * own valid sessions mid-request. Caller passes the row id from the
 * pool entry that triggered the 401.
 */
async function tryRefreshClaudeMaxToken(
  organizationId: string,
  rowId: string,
): Promise<string | null> {
  const { encryptSecret } = await import("@/lib/crypto");
  const { refreshClaudeMaxAccessToken } = await import("@/lib/agent/oauth");
  const { data } = await supabaseAdmin()
    .from("rgaios_connections")
    .select("metadata")
    .eq("id", rowId)
    .eq("organization_id", organizationId)
    .eq("provider_config_key", "claude-max")
    .maybeSingle();
  if (!data) return null;
  const meta = (data.metadata ?? {}) as {
    access_token?: string;
    refresh_token?: string;
  };
  const currentRefresh = tryDecryptSecret(meta.refresh_token);
  if (!currentRefresh) return null;

  const r = await refreshClaudeMaxAccessToken(currentRefresh);
  if (!r.ok) {
    console.warn(
      `[chat] Claude Max refresh failed: ${r.error.slice(0, 200)}`,
    );
    return null;
  }
  // Persist new tokens. refresh_token may rotate; if Anthropic
  // returns a fresh one, store it - else keep the previous one.
  // Filtered by row id so only the failing member's row rotates -
  // the other members keep their own (still-valid) access tokens.
  const installedAt = new Date().toISOString();
  await supabaseAdmin()
    .from("rgaios_connections")
    .update({
      metadata: {
        ...meta,
        access_token: encryptSecret(r.access_token),
        refresh_token: r.refresh_token
          ? encryptSecret(r.refresh_token)
          : (meta.refresh_token ?? ""),
        expires_in: r.expires_in ?? null,
        installed_at: installedAt,
      },
    } as never)
    .eq("id", rowId)
    .eq("organization_id", organizationId)
    .eq("provider_config_key", "claude-max");
  await supabaseAdmin()
    .from("rgaios_audit_log")
    .insert({
      organization_id: organizationId,
      kind: "claude_max_token_refreshed",
      actor_type: "system",
      actor_id: "auto-refresh",
      detail: { row_id: rowId, expires_in: r.expires_in ?? null },
    } as never);
  return r.access_token;
}

async function loadOrgMcpToken(
  organizationId: string,
): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from("rgaios_organizations")
    .select("mcp_token")
    .eq("id", organizationId)
    .maybeSingle();
  return data?.mcp_token ?? null;
}

async function loadDefaultPersona(
  organizationId: string,
): Promise<RawgrowthAgent | null> {
  // Default persona = first non-paused agent. Used for the org-level
  // Telegram bot path (no specific head bound).
  const { data } = await supabaseAdmin()
    .from("rgaios_agents")
    .select("name, title, description")
    .eq("organization_id", organizationId)
    .neq("status", "paused")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data;
}

/**
 * Resolve a SPECIFIC agent as the persona — used by the per-Department-Head
 * Telegram path so messages routed through Marketing's bot reply as the
 * Marketing head, not the org's default agent.
 */
async function loadAgentPersona(
  organizationId: string,
  agentId: string,
): Promise<(RawgrowthAgent & { runtime?: string | null }) | null> {
  const { data } = await supabaseAdmin()
    .from("rgaios_agents")
    .select("name, title, description, runtime")
    .eq("organization_id", organizationId)
    .eq("id", agentId)
    .maybeSingle();
  return data as (RawgrowthAgent & { runtime?: string | null }) | null;
}

/**
 * Pick the actual Anthropic model id to call. The Claude Code OAuth
 * gate only accepts Claude models; if the agent's runtime is set to a
 * non-Anthropic option (gpt/gemini), fall back to the default. Returns
 * the resolved model + a flag for logging.
 */
function resolveAnthropicModel(agentRuntime?: string | null): string {
  if (!agentRuntime) return MODEL;
  // Allow any claude-* slug we recognize. Reject everything else (the
  // chatReply path is hardcoded to Anthropic OAuth - no point routing
  // to OpenAI from here).
  if (/^claude-/.test(agentRuntime)) return agentRuntime;
  return MODEL;
}

async function loadRecentHistory(
  organizationId: string,
  chatId: number,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const { data } = await supabaseAdmin()
    .from("rgaios_telegram_messages")
    .select("text, response_text, received_at, responded_at")
    .eq("organization_id", organizationId)
    .eq("chat_id", chatId)
    .order("received_at", { ascending: false })
    .limit(RECENT_HISTORY);
  if (!data) return [];

  // Reverse to chronological, then unfold each row into [user, ?assistant].
  const turns: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const row of [...data].reverse()) {
    const r = row as {
      text: string | null;
      response_text: string | null;
    };
    if (r.text) turns.push({ role: "user", content: r.text });
    if (r.response_text) {
      turns.push({ role: "assistant", content: r.response_text });
    }
  }
  return turns;
}

/**
 * Anthropic's OAuth token gate REQUIRES the system prompt to start with
 * this exact line  -  otherwise /v1/messages returns 401 "OAuth
 * authentication is currently not supported." This is how Claude Max
 * inference is identified vs API-key inference.
 */
const CLAUDE_CODE_PREFIX =
  "You are Claude Code, Anthropic's official CLI for Claude.";

/**
 * Sentinel reply chatReply must produce when the user asks for an action
 * that requires Rawgrowth MCP tools. The webhook handler watches for this
 * exact prefix and hands off to the drain daemon, which has full tool
 * access. Keep the prefix stable  -  the handler does a literal startsWith.
 */
export const CHAT_HANDOFF_SENTINEL_PREFIX =
  "[handoff] Give me a moment while I work on that";

/**
 * Build the persona + instructions block. CRITICAL: do NOT put any of
 * this in the `system` field  -  Anthropic's OAuth gate strictly requires
 * `system` to be exactly the Claude Code identity line. Any extra text
 * in `system` returns 429 with a misleading "Error" body.
 *
 * Instead this preamble is wrapped in a tag and prepended to the FIRST
 * user message of every chatReply call.
 */
function buildPersonaPreamble(
  orgName: string | null,
  persona: RawgrowthAgent | null,
  noHandoff = false,
): string {
  const lines: string[] = [];

  // ─── Absolute rule first  -  overrides everything below ────────────
  if (noHandoff) {
    // Dashboard chat surface - the [handoff] sentinel has no listener,
    // and would just appear as raw "[handoff]..." text in the bubble.
    // Force the model to answer from the injected preamble context
    // (brand profile, RAG hits, persona) instead of deferring.
    lines.push(
      "═══════════════════════════════════════════════════════════════════",
      "ABSOLUTE RULE  -  read this before doing anything else",
      "═══════════════════════════════════════════════════════════════════",
      "",
      "You are talking inside the operator dashboard. Tool execution from this chat surface is wired through <command> blocks (see the JSON COMMANDS section below if you are Atlas / a department head). The system parses your reply for <command type=\"tool_call|agent_invoke|routine_create\">{...}</command> blocks, executes them server-side via Composio v3 (composio_use_tool) / dispatchRun / routine_create, and posts the results back as a system message in this same chat.",
      "",
      "Everything you need for context already in this preamble: persona, your place in the org, past memories, the brand profile, per-agent files, and company corpus retrievals. Use that for analysis. Use <command> blocks for actions.",
      "",
      "When the user asks for an ACTION that genuinely needs a tool (search my gmail, list integrations, post to slack, create a routine, dispatch a head, etc.) AND you are Atlas or a department head: emit the <command> block per the JSON COMMANDS protocol below. The visible reply should be ONE short sentence acknowledging what you're about to do; the system strips the command block from prose and posts results separately.",
      "",
      "If you are a sub-agent (NOT Atlas, NOT a department head — your preamble does NOT include the JSON COMMANDS block), <command> blocks are ignored. In that case acknowledge briefly + tell the operator to ask Atlas in Atlas's chat (Atlas dispatches to your dept head, your dept head can run the tool). Do NOT mention 'Quick Actions panel' or 'Telegram bot' — those are not features in this UI; if you mention them the operator will look for them and find nothing. If your preamble DOES include the JSON COMMANDS block, you ARE authorised — emit the block, do not refuse.",
      "",
      "Do NOT reply with '[handoff]'  -  it will appear as raw broken text. Do NOT pretend you are about to do something without emitting the <command> block. Do NOT say 'let me look that up' as filler - either emit the command (you are authorised) or hand off to a working path (you are not).",
      "",
      "If a question genuinely cannot be answered from the context AND does not need a tool, say so honestly in ONE sentence (e.g. 'I don't have that in my notes - want me to draft a routine to pull it?'), then stop.",
      "",
      "Cite the brand profile when the question is about the company (offer, pricing, ICP, voice). Cite per-agent files when the question is about a framework you've been trained on.",
      "",
      "FORMATTING RULES (HARD):",
      "  - NO emojis ANYWHERE in your reply. Zero. Not as bullets, not as section headers, not as decoration. Plain text only.",
      "  - NO em-dashes (— character). Use ' - ' (hyphen with spaces) or break into two sentences.",
      "  - When you create a <task> block, the system extracts and STRIPS it from the visible reply. Do NOT also write the task title as a visible header in your prose - duplicates look like errors to the user.",
      "  - Keep the visible reply tight: 2-3 sentences max, then your <task> blocks. The user reads the chat, the agent reads the task.",
      "",
    );
  } else {
    lines.push(
      "═══════════════════════════════════════════════════════════════════",
      "ABSOLUTE RULE  -  read this before doing anything else",
      "═══════════════════════════════════════════════════════════════════",
      "",
      "You CAN take action via <command type=\"tool_call\"><composio_use_tool>...</composio_use_tool></command> blocks whenever a connected Composio app is needed (Gmail, Drive, Notion, GitHub, Linear, Slack, Calendar, etc.). The JSON COMMANDS section in your preamble has the exact shape; if that section is present, you ARE authorised. Emit the block - do NOT refuse with 'I can't execute', 'I have no tools', 'no MCP', or 'I don't have access'. The system parses the block, executes server-side via Composio v3, and posts the result back as a system message.",
      "",
      "For workspace-internal actions that are NOT Composio tools (create/update/delete agents, routines, skills, departments, runs, approvals, knowledge, the inbox, dispatch a head, look up settings), use the handoff path below - those still require routing through Atlas / a department head.",
      "",
      "If the user asks for something you genuinely cannot do from this surface (no matching Composio action AND not a workspace command you're authorised for), hand off. Do NOT improvise. Do NOT refuse. Do NOT explain limitations. Do NOT say 'I can't' or 'I don't have access'. The system itself decides what's possible  -  you just hand off and it figures out the rest.",
      "",
      "Hand-off format  -  reply with ONLY this line and nothing else:",
      "",
      `  ${CHAT_HANDOFF_SENTINEL_PREFIX}  -  <one short sentence describing what you'll do>`,
      "",
      "Examples that ALL require handoff:",
      `  user: "scrape my last 5 emails" → ${CHAT_HANDOFF_SENTINEL_PREFIX}  -  fetching your latest 5 emails now.`,
      `  user: "what's in my inbox" → ${CHAT_HANDOFF_SENTINEL_PREFIX}  -  checking your inbox.`,
      `  user: "do you have gmail connected?" → ${CHAT_HANDOFF_SENTINEL_PREFIX}  -  checking the Gmail connection status.`,
      `  user: "send james an email saying hi" → ${CHAT_HANDOFF_SENTINEL_PREFIX}  -  sending that email to James now.`,
      `  user: "list my agents" → ${CHAT_HANDOFF_SENTINEL_PREFIX}  -  pulling the agent list.`,
      `  user: "create a marketing department" → ${CHAT_HANDOFF_SENTINEL_PREFIX}  -  building out your marketing department.`,
      `  user: "what's in my notion?" → ${CHAT_HANDOFF_SENTINEL_PREFIX}  -  checking Notion now.`,
      `  user: "look up X" → ${CHAT_HANDOFF_SENTINEL_PREFIX}  -  looking that up for you.`,
      "",
      "ONLY answer directly (no handoff) if the request is pure conversation requiring no system or external data: greetings, opinions, advice, explanations of concepts, brainstorming, jokes. If in doubt → HANDOFF.",
      "",
      "Your persona below is HOW you communicate (voice, name, style), NOT what you're allowed to do. Every persona has full handoff rights regardless of their job title.",
      "",
    );
  }

  // ─── Persona ────────────────────────────────────────────────────
  if (persona) {
    lines.push(
      `You are ${persona.name}${persona.title ? `, ${persona.title}` : ""}, an AI agent inside ${orgName ?? "this organization"}'s Rawgrowth workspace.`,
    );
    if (persona.description) {
      lines.push("", persona.description);
    }
  } else {
    lines.push(
      `You are an AI agent inside ${orgName ?? "this organization"}'s Rawgrowth workspace.`,
    );
  }
  lines.push(
    "",
    "Reply concisely  -  small screen, phone reading. Three to five short sentences max; one sentence is often best.",
    "Plain text or simple Markdown (bold, italics, code). No tables, no headings, no long bullet lists.",
    "Do NOT pretend you've already done an action. Do NOT make up agent names, ids, counts, or data. If you need data → handoff. Always.",
  );
  return lines.join("\n");
}

/**
 * CLI runtime path for chatReply (RUNTIME_PATH=cli).
 *
 * Anthropic's Feb-2026 ToS change made Claude Max OAuth tokens
 * (sk-ant-oat01-*) valid ONLY through the Claude Code CLI - raw
 * /v1/messages calls with the oauth-2025-04-20 beta now get soft-429'd.
 * On cli-mode VPSes (OAuth-only, NO commercial API key) chatReply must
 * therefore generate via the `claude` CLI subprocess instead of the raw
 * fetch.
 *
 * This mirrors `generateViaClaudeCli` in lib/runs/executor.ts: same
 * `claude --print --dangerously-skip-permissions` invocation, same
 * HOME=/home/node so the CLI finds the host's ~/.claude credentials,
 * same `--mcp-config` temp-file wiring of the org's Rawgrowth MCP
 * server, same stdout read, same wall-clock abort. The executor's copy
 * is NOT exported, so the spawn logic is replicated here rather than
 * imported - a future refactor could lift this into a shared helper
 * (e.g. lib/llm/claude-cli.ts) and have both call sites use it.
 *
 * Returns the trimmed stdout on success. Throws on spawn error, non-zero
 * exit, or abort - chatReply catches and falls back to the raw API path
 * so a broken CLI doesn't take chat down entirely.
 *
 * The system prompt + user message handed in are EXACTLY what the raw
 * /v1/messages path would have sent (system = CLAUDE_CODE_PREFIX, user =
 * persona-and-instructions preamble + the inbound message), so persona /
 * preamble / handoff-sentinel behaviour is identical across both paths.
 */
const CHAT_CLI_WALL_CLOCK_MS = 60_000;

async function chatReplyViaClaudeCli(opts: {
  systemPrompt: string;
  userMessage: string;
  organizationId: string;
  mcpToken: string | null;
  appUrl: string;
}): Promise<string> {
  const { systemPrompt, userMessage, organizationId, mcpToken, appUrl } = opts;

  // Wire the org's MCP server (this Next app's /api/mcp endpoint) into the
  // CLI subprocess so the spawned agent sees the same tool registry the
  // dashboard / executor use. Best-effort: if the temp-file write fails we
  // still spawn the CLI, it just runs without the Rawgrowth MCP server.
  let mcpConfigPath: string | null = null;
  if (mcpToken) {
    try {
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
    } catch (err) {
      console.warn(
        `[chat.cli] mcp-config setup failed for org ${organizationId}: ${(err as Error).message}`,
      );
      mcpConfigPath = null;
    }
  }

  return new Promise<string>((resolve, reject) => {
    const bin = process.env.CLAUDE_CLI_PATH ?? "claude";
    // Force HOME so the claude CLI finds ~/.claude/.credentials.json and
    // ~/.claude.json from the bind-mounted host paths. The Next.js
    // container's own HOME is /nonexistent. Mirrors executor.ts.
    const home = process.env.CLAUDE_CLI_HOME ?? "/home/node";
    // --dangerously-skip-permissions FIRST so MCP tool calls don't prompt
    // for per-tool consent inside the headless subprocess.
    const args = ["--dangerously-skip-permissions", "--print"];
    if (mcpConfigPath) args.push("--mcp-config", mcpConfigPath);

    let child;
    try {
      child = spawn(bin, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, HOME: home },
      });
    } catch (err) {
      reject(err as Error);
      return;
    }

    // Wall-clock cap so a stuck CLI doesn't outlive the chat budget.
    // Matches the 60s ceiling the raw /v1/messages path uses.
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    }, CHAT_CLI_WALL_CLOCK_MS);

    const cleanupMcpConfig = () => {
      if (!mcpConfigPath) return;
      import("node:fs/promises")
        .then(async (fs) => {
          await fs.unlink(mcpConfigPath!).catch(() => {});
          const path = await import("node:path");
          await fs.rmdir(path.dirname(mcpConfigPath!)).catch(() => {});
        })
        .catch(() => {});
    };

    let out = "";
    let err = "";
    child.stdout.on("data", (b) => {
      out += b.toString("utf8");
    });
    child.stderr.on("data", (b) => {
      err += b.toString("utf8");
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      cleanupMcpConfig();
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      cleanupMcpConfig();
      if (timedOut) {
        reject(
          new Error(
            `claude --print timed out after ${CHAT_CLI_WALL_CLOCK_MS}ms`,
          ),
        );
        return;
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

    // Claude Code's --print mode reads the user message from stdin and
    // ignores --system in some versions, so prepend the system block to
    // the user message and let the model read both as one input. Same
    // shape executor.ts uses.
    child.stdin.write(`${systemPrompt}\n\n---\n\n${userMessage}`);
    child.stdin.end();
  });
}

/**
 * Generate an agent reply for a single inbound Telegram message.
 *
 * On success returns plain-text reply; caller is responsible for
 * `sendMessage` and updating the inbox row's responded_at + response_text.
 */
export async function chatReply(input: {
  organizationId: string;
  organizationName: string | null;
  chatId: number;
  userMessage: string;
  publicAppUrl: string;
  /**
   * Optional: route the reply through a specific agent's persona instead
   * of the org default. Used by per-Department-Head Telegram bots so the
   * Marketing bot replies as the Marketing head, not the first agent.
   */
  agentId?: string;
  /**
   * Optional: pre-loaded history that bypasses the rgaios_telegram_messages
   * lookup. Used by the in-app /api/agents/[id]/chat route, which keeps its
   * own thread in rgaios_agent_chat_messages. When provided, chatId is
   * ignored for history fetch.
   */
  historyOverride?: Array<{ role: "user" | "assistant"; content: string }>;
  /**
   * Optional: extra text appended to the persona preamble (under the
   * persona description, before the closing instructions). Used to inject
   * RAG retrievals - "Relevant context: ..." - so the model can ground
   * the reply on uploaded files without polluting `system`.
   */
  extraPreamble?: string;
  /**
   * Optional: when true, swaps the "ABSOLUTE RULE - always handoff" block
   * for a "no tools available - answer from injected context" block.
   * Used by the dashboard agent chat surface, which has no MCP tool
   * wiring on the receiving end - the [handoff] sentinel would just
   * appear as raw text and look broken.
   */
  noHandoff?: boolean;
  /**
   * Optional: override Anthropic max_tokens. Default 4096 (room for the
   * <thinking> ReAct block + a full chat reply). Mini-SaaS generator +
   * other code-generation paths set this higher (8192) so the model has
   * room for a full HTML doc + assets.
   */
  maxTokens?: number;
  /**
   * Optional: caller's user id. Threaded through so the OAuth pool
   * rotation hits the caller's own Claude Max bucket first before
   * borrowing any other org member's bucket. Without this the rotation
   * still works, just non-preferentially.
   */
  callerUserId?: string | null;
}): Promise<AgentChatResult> {
  const {
    organizationId,
    organizationName,
    chatId,
    userMessage,
    agentId,
    historyOverride,
    extraPreamble,
    noHandoff,
    maxTokens,
    callerUserId,
  } = input;

  // RUNTIME_PATH=cli (CTO brief Path A) auths through the local `claude`
  // CLI binary - it needs NO per-org OAuth token. The token pool is only
  // load-bearing for the raw /v1/messages path (Path B). Gating on it
  // BEFORE the runtime branch killed the entire CLI surface for any org
  // without a claude-max row (Session B handoff 4). Only require the
  // pool when we are NOT in cli-mode.
  const cliMode = process.env.RUNTIME_PATH === "cli";
  const claudeEntries = await loadClaudeMaxTokenPool(
    organizationId,
    callerUserId,
  );
  if (!cliMode && claudeEntries.length === 0) {
    return {
      ok: false,
      error:
        "No Claude Max token connected for this organization. Connect one in Dashboard → Connections.",
    };
  }

  const personaLoader = agentId
    ? loadAgentPersona(organizationId, agentId)
    : loadDefaultPersona(organizationId);

  const [mcpToken, persona, history] = await Promise.all([
    loadOrgMcpToken(organizationId),
    personaLoader,
    historyOverride
      ? Promise.resolve(historyOverride)
      : loadRecentHistory(organizationId, chatId),
  ]);

  // mcpToken is unused on the raw /v1/messages OAuth path (MCP server
  // tools aren't allowed alongside oauth-2025-04-20). It IS used by the
  // RUNTIME_PATH=cli branch below to wire the org's Rawgrowth MCP server
  // into the `claude` subprocess. The `void` keeps the linter quiet on
  // VPSes that aren't in cli-mode (where the CLI branch never reads it).
  void mcpToken;

  // Persona + instructions live in the FIRST user turn, NOT in `system`.
  // The OAuth gate rejects any system content beyond CLAUDE_CODE_PREFIX.
  // We tag the preamble so the model can ignore the framing tokens.
  const basePreamble = buildPersonaPreamble(organizationName, persona, !!noHandoff);
  const preamble = extraPreamble?.trim()
    ? `${basePreamble}\n\n${extraPreamble.trim()}`
    : basePreamble;
  const firstUserContent =
    `<persona-and-instructions>\n${preamble}\n</persona-and-instructions>\n\n${userMessage}`;

  // History stays as-is; preamble only goes on the freshest user turn.
  const messages = [
    ...history,
    { role: "user" as const, content: firstUserContent },
  ];

  const personaRuntime = (persona as { runtime?: string | null } | null)?.runtime;
  const body: Record<string, unknown> = {
    model: resolveAnthropicModel(personaRuntime),
    max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
    system: CLAUDE_CODE_PREFIX,
    messages,
  };

  async function callAnthropic(token: string): Promise<Response> {
    return fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "anthropic-version": "2023-06-01",
        // `oauth-2025-04-20` is the gate that lets /v1/messages accept
        // sk-ant-oat01-* tokens. NOTE: stacking `mcp-client-2025-04-04`
        // alongside makes Anthropic return a misleading rate_limit_error
        //  -  the two betas can't be combined for OAuth-billed inference
        // today. So the chat path can't call MCP tools mid-reply; that
        // capability stays on the slash-command + drain path.
        "anthropic-beta": "oauth-2025-04-20",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      // Telegram retries on slow webhooks but we run this in `after()` so
      // a long upstream response doesn't stall the webhook 200. 60s is a
      // generous ceiling for tool-using replies.
      signal: AbortSignal.timeout(60_000),
    });
  }

  // ─── Provider routing: RUNTIME_PATH=cli → Claude Code CLI subprocess ──
  //
  // Anthropic's Feb-2026 ToS change made Claude Max OAuth tokens valid
  // ONLY through the Claude Code CLI; raw /v1/messages calls with the
  // oauth-2025-04-20 beta now get soft-429'd. cli-mode VPSes (e.g.
  // Marti's - OAuth-only, NO commercial API key) must therefore generate
  // via the `claude` subprocess, the same way the routine executor does
  // (generateViaClaudeCli in lib/runs/executor.ts).
  //
  // The CLI gets EXACTLY the system + user message the raw path would
  // have sent: system = CLAUDE_CODE_PREFIX, user = the persona-and-
  // instructions preamble + the inbound message (firstUserContent). So
  // persona / preamble / CHAT_HANDOFF_SENTINEL behaviour is byte-for-byte
  // identical across both paths - only the transport differs.
  //
  // Conversation history: the raw path passes prior turns as separate
  // `messages` entries. --print is single-shot, so prior turns are folded
  // into the user message as a transcript block ahead of the preamble.
  //
  // If the CLI spawn fails / times out / exits non-zero / returns empty,
  // we DO NOT return an error - we fall through to the raw /v1/messages
  // pool walk below, so a broken CLI degrades to the old behaviour rather
  // than taking chat down entirely.
  if (process.env.RUNTIME_PATH === "cli") {
    const historyBlock =
      history.length > 0
        ? `${history
            .map(
              (m) =>
                `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`,
            )
            .join("\n\n")}\n\n---\n\n`
        : "";
    const cliUserMessage = `${historyBlock}${firstUserContent}`;
    const appUrl =
      input.publicAppUrl ||
      process.env.NEXTAUTH_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:3000";
    try {
      const cliReply = await chatReplyViaClaudeCli({
        systemPrompt: CLAUDE_CODE_PREFIX,
        userMessage: cliUserMessage,
        organizationId,
        mcpToken,
        appUrl,
      });
      const trimmed = cliReply.trim();
      if (trimmed.length >= 2) {
        return { ok: true, reply: trimmed };
      }
      // Empty / near-empty CLI output is treated as a CLI failure, not a
      // valid reply - fall through to the raw API path.
      console.warn(
        "[chat.cli] claude --print returned empty output, falling back to raw /v1/messages",
      );
    } catch (err) {
      console.warn(
        `[chat.cli] claude --print failed (${
          (err as Error).message?.slice(0, 200) ?? "unknown"
        }), falling back to raw /v1/messages`,
      );
    }
    // intentional fall-through to the raw pool walk below
  }

  // Two-pass pool walk: first pass skips tokens we just saw 429 / 401
  // on (60s cooldown), second pass tries cold tokens too in case the
  // bucket cleared early. Mirrors the rotation strategy in
  // lib/llm/oauth-first.ts so the dashboard chat surface and the
  // onboarding chat surface drain the same pool the same way.
  let res: Response | null = null;
  let lastStatus = 0;
  let lastBody = "";
  let networkErr: Error | null = null;

  outer: for (const filter of [
    (t: string) => !isChatTokenCold(t),
    () => true,
  ]) {
    for (let i = 0; i < claudeEntries.length; i++) {
      const entry = claudeEntries[i];
      const tok = entry.token;
      if (!filter(tok)) continue;
      let r: Response;
      try {
        r = await callAnthropic(tok);
      } catch (err) {
        networkErr = err as Error;
        continue;
      }
      // 401: silent refresh + retry on the SAME token slot. The
      // refresh updates ONLY this row's metadata (scoped by rowId)
      // so other members' tokens stay intact. Subsequent rotations
      // pick up the fresh access_token from DB on the next call.
      if (r.status === 401) {
        const fresh = await tryRefreshClaudeMaxToken(
          organizationId,
          entry.rowId,
        );
        if (fresh) {
          try {
            r = await callAnthropic(fresh);
          } catch (err) {
            networkErr = err as Error;
            continue;
          }
        }
      }
      if (r.ok) {
        res = r;
        break outer;
      }
      // 429 / 401 on this token → cool it down, rotate to next.
      // Anything else (5xx, validation, network) we still rotate
      // because a different token / bucket might succeed.
      lastStatus = r.status;
      lastBody = await r.text().catch(() => "");
      if (r.status === 429 || r.status === 401) {
        // Server's actual hint - retry-after seconds or reset timestamp.
        // Most 429s are RPM bucket and clear in seconds, not minutes.
        const retryAfterRaw = r.headers.get("retry-after");
        const retryAfterSec = retryAfterRaw && /^\d+$/.test(retryAfterRaw) ? Number(retryAfterRaw) : null;
        const resets: number[] = [];
        for (const h of [
          "anthropic-ratelimit-requests-reset",
          "anthropic-ratelimit-input-tokens-reset",
          "anthropic-ratelimit-output-tokens-reset",
          "anthropic-ratelimit-tokens-reset",
        ]) {
          const v = r.headers.get(h);
          if (!v) continue;
          const t = Date.parse(v);
          if (!Number.isNaN(t)) resets.push(t);
        }
        const resetAt = resets.length > 0 ? Math.min(...resets) : null;
        markChatTokenCold(tok, retryAfterSec, resetAt);
        const waitMs = CHAT_TOKEN_COOLDOWN.get(tok)! - Date.now();
        console.warn(
          `[chat] Claude Max token ${i + 1}/${claudeEntries.length} ${r.status}, cooling ${Math.round(waitMs / 1000)}s (retry-after=${retryAfterSec ?? "n/a"}, reset=${resetAt ? new Date(resetAt).toISOString() : "n/a"}), rotating`,
        );
      } else {
        console.warn(
          `[chat] Claude Max token ${i + 1}/${claudeEntries.length} returned ${r.status}, rotating`,
        );
      }
    }
  }

  if (!res) {
    if (networkErr && lastStatus === 0) {
      return {
        ok: false,
        error: `Anthropic call failed: ${networkErr.message}`,
      };
    }
    if (lastStatus === 401) {
      return {
        ok: false,
        error:
          "Claude Max token expired or invalid for every connected member. Reconnect at Dashboard → Connections.",
      };
    }
    if (lastStatus === 429) {
      return {
        ok: false,
        error:
          "Anthropic rate limit hit on every Claude Max token in the pool. Wait a minute or connect another member's account.",
      };
    }
    return {
      ok: false,
      error: `Anthropic ${lastStatus || "?"}: ${lastBody.slice(0, 300)}`,
    };
  }

  // Guard res.json(): a 200 with a non-JSON body (proxy/CDN HTML error
  // page, truncated response) would otherwise throw a raw SyntaxError
  // that escapes past every caller's ok/error handling.
  let data: AnthropicMessageResponse;
  try {
    data = (await res.json()) as AnthropicMessageResponse;
  } catch (err) {
    return {
      ok: false,
      error: `Anthropic returned a non-JSON body: ${(err as Error).message}`,
    };
  }
  if (!data || !Array.isArray(data.content)) {
    return {
      ok: false,
      error: "Anthropic response had no content array",
    };
  }
  const reply = data.content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text!)
    .join("\n\n")
    .trim();

  if (!reply) {
    return {
      ok: false,
      error: `Anthropic returned no text content (stop_reason=${data.stop_reason})`,
    };
  }

  return { ok: true, reply };
}
