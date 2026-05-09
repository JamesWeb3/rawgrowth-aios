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
const DEFAULT_MAX_TOKENS = 1024;
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
 */
async function loadClaudeMaxTokenPool(
  organizationId: string,
  callerUserId?: string | null,
): Promise<string[]> {
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
  const tokens: string[] = [];
  for (const row of ordered) {
    const meta = (row.metadata ?? {}) as { access_token?: string };
    if (!meta.access_token) continue;
    const tok = tryDecryptSecret(meta.access_token);
    if (tok) tokens.push(tok);
  }
  return tokens;
}

/**
 * 60s in-process cooldown on tokens we just saw 429 / 401 on. Same
 * window as oauth-first.ts because Anthropic's per-account buckets
 * recover on the same cadence regardless of which call site triggered
 * the throttle. Map cleared on process restart.
 */
const CHAT_TOKEN_COOLDOWN: Map<string, number> = new Map();
const CHAT_COOLDOWN_MS = 60_000;

function isChatTokenCold(token: string): boolean {
  const until = CHAT_TOKEN_COOLDOWN.get(token);
  if (!until) return false;
  if (Date.now() >= until) {
    CHAT_TOKEN_COOLDOWN.delete(token);
    return false;
  }
  return true;
}

function markChatTokenCold(token: string): void {
  CHAT_TOKEN_COOLDOWN.set(token, Date.now() + CHAT_COOLDOWN_MS);
}

/**
 * On Anthropic 401, attempt to silently refresh the access_token
 * using the stored refresh_token. Returns the new access_token on
 * success or null if refresh fails (no refresh_token, refresh
 * endpoint rejected, etc).
 */
async function tryRefreshClaudeMaxToken(
  organizationId: string,
): Promise<string | null> {
  const { encryptSecret } = await import("@/lib/crypto");
  const { refreshClaudeMaxAccessToken } = await import("@/lib/agent/oauth");
  const { data } = await supabaseAdmin()
    .from("rgaios_connections")
    .select("metadata")
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
    .eq("organization_id", organizationId)
    .eq("provider_config_key", "claude-max");
  await supabaseAdmin()
    .from("rgaios_audit_log")
    .insert({
      organization_id: organizationId,
      kind: "claude_max_token_refreshed",
      actor_type: "system",
      actor_id: "auto-refresh",
      detail: { expires_in: r.expires_in ?? null },
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
      "You are talking inside the operator dashboard. There is NO HANDOFF target on this surface. You also have NO MCP tools - you cannot run actions, read external systems, or query the workspace at runtime.",
      "",
      "Everything you need is already in this preamble: persona, your place in the org, past memories, the brand profile, per-agent files, and company corpus retrievals. ANSWER DIRECTLY using that context.",
      "",
      "Do NOT reply with '[handoff]'  -  it will appear as raw broken text. Do NOT pretend you are about to do something. Do NOT say 'let me look that up' or 'give me a moment'.",
      "",
      "If a question genuinely cannot be answered from the context, say so honestly in ONE sentence (e.g. 'I don't have that in my notes - want me to draft a routine to pull it?'), then stop.",
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
      "You have NO TOOLS in this conversation. Zero. None. You cannot:",
      "  • read/send/draft email, scrape inboxes, check folders",
      "  • read/write to Drive, Notion, GitHub, Linear, databases, files",
      "  • create/update/delete/list anything in the workspace (agents, routines, skills, departments, runs, approvals, knowledge, the inbox, etc.)",
      "  • check whether a connection is live, look up settings, or query the system",
      "  • do ANY action against ANY external service",
      "",
      "If the user asks for ANY of the above  -  even just 'do you have X connected?'  -  you MUST hand off. Do NOT improvise. Do NOT refuse. Do NOT explain limitations. Do NOT say 'I can't' or 'I don't have access'. The system itself decides what's possible  -  you just hand off and it figures out the rest.",
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
   * Optional: override Anthropic max_tokens. Default 1024 (chat reply
   * length). Mini-SaaS generator + other code-generation paths set this
   * higher (8192) so the model has room for a full HTML doc + assets.
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

  const claudeTokens = await loadClaudeMaxTokenPool(
    organizationId,
    callerUserId,
  );
  if (claudeTokens.length === 0) {
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

  // mcpToken is unused on the OAuth path (MCP server tools aren't allowed
  // alongside oauth-2025-04-20). Reference it so the linter doesn't warn,
  // and keep it visible for when Anthropic enables both betas together.
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
    for (let i = 0; i < claudeTokens.length; i++) {
      const tok = claudeTokens[i];
      if (!filter(tok)) continue;
      let r: Response;
      try {
        r = await callAnthropic(tok);
      } catch (err) {
        networkErr = err as Error;
        continue;
      }
      // 401: silent refresh + retry on the SAME token slot. If the
      // refresh helper updates the row's metadata, subsequent rotations
      // will pick up the fresh access_token from DB on the next call.
      if (r.status === 401) {
        const fresh = await tryRefreshClaudeMaxToken(organizationId);
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
        markChatTokenCold(tok);
        console.warn(
          `[chat] Claude Max token ${i + 1}/${claudeTokens.length} ${r.status}, cooling ${CHAT_COOLDOWN_MS / 1000}s, rotating`,
        );
      } else {
        console.warn(
          `[chat] Claude Max token ${i + 1}/${claudeTokens.length} returned ${r.status}, rotating`,
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

  const data = (await res.json()) as AnthropicMessageResponse;
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
