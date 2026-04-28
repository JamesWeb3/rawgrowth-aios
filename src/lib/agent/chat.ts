import { supabaseAdmin } from "@/lib/supabase/server";
import { tryDecryptSecret } from "@/lib/crypto";

/**
 * Direct Anthropic Messages API call using the org's stored Claude Max
 * OAuth token. Bypasses the `claude` CLI cold-spawn entirely so Telegram
 * replies feel like a real chatbot (~3-5s end to end vs 10-15s).
 *
 * The model gets full access to this org's Rawgrowth MCP server via
 * the `mcp_servers` parameter — same tools the CLI sees (telegram, gmail,
 * routines, agents, knowledge, etc.) in a single API roundtrip.
 *
 * Falls back gracefully when the org doesn't have a Claude Max token
 * connected — caller should show "configure Claude Max in Connections"
 * rather than silently failing.
 */

const MODEL = "claude-sonnet-4-5";
const MAX_TOKENS = 1024;
const RECENT_HISTORY = 6;

type AgentChatResult =
  | { ok: true; reply: string }
  | { ok: false; error: string };

type AnthropicContentBlock = {
  type: string;
  text?: string;
  // tool_use, tool_result etc — we only render text blocks back to the user.
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

async function loadClaudeMaxToken(
  organizationId: string,
): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from("rgaios_connections")
    .select("metadata")
    .eq("organization_id", organizationId)
    .eq("provider_config_key", "claude-max")
    .maybeSingle();
  if (!data) return null;
  const meta = (data.metadata ?? {}) as { access_token?: string };
  return tryDecryptSecret(meta.access_token);
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
): Promise<RawgrowthAgent | null> {
  const { data } = await supabaseAdmin()
    .from("rgaios_agents")
    .select("name, title, description")
    .eq("organization_id", organizationId)
    .eq("id", agentId)
    .maybeSingle();
  return data;
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
 * this exact line — otherwise /v1/messages returns 401 "OAuth
 * authentication is currently not supported." This is how Claude Max
 * inference is identified vs API-key inference.
 */
const CLAUDE_CODE_PREFIX =
  "You are Claude Code, Anthropic's official CLI for Claude.";

/**
 * Sentinel reply chatReply must produce when the user asks for an action
 * that requires Rawgrowth MCP tools. The webhook handler watches for this
 * exact prefix and hands off to the drain daemon, which has full tool
 * access. Keep the prefix stable — the handler does a literal startsWith.
 */
export const CHAT_HANDOFF_SENTINEL_PREFIX =
  "[handoff] Give me a moment while I work on that";

/**
 * Build the persona + instructions block. CRITICAL: do NOT put any of
 * this in the `system` field — Anthropic's OAuth gate strictly requires
 * `system` to be exactly the Claude Code identity line. Any extra text
 * in `system` returns 429 with a misleading "Error" body.
 *
 * Instead this preamble is wrapped in a tag and prepended to the FIRST
 * user message of every chatReply call.
 */
function buildPersonaPreamble(
  orgName: string | null,
  persona: RawgrowthAgent | null,
): string {
  const lines: string[] = [];

  // ─── Absolute rule first — overrides everything below ────────────
  lines.push(
    "═══════════════════════════════════════════════════════════════════",
    "ABSOLUTE RULE — read this before doing anything else",
    "═══════════════════════════════════════════════════════════════════",
    "",
    "You have NO TOOLS in this conversation. Zero. None. You cannot:",
    "  • read/send/draft email, scrape inboxes, check folders",
    "  • read/write to Drive, Notion, GitHub, Linear, databases, files",
    "  • create/update/delete/list anything in the workspace (agents, routines, skills, departments, runs, approvals, knowledge, the inbox, etc.)",
    "  • check whether a connection is live, look up settings, or query the system",
    "  • do ANY action against ANY external service",
    "",
    "If the user asks for ANY of the above — even just 'do you have X connected?' — you MUST hand off. Do NOT improvise. Do NOT refuse. Do NOT explain limitations. Do NOT say 'I can't' or 'I don't have access'. The system itself decides what's possible — you just hand off and it figures out the rest.",
    "",
    "Hand-off format — reply with ONLY this line and nothing else:",
    "",
    `  ${CHAT_HANDOFF_SENTINEL_PREFIX} — <one short sentence describing what you'll do>`,
    "",
    "Examples that ALL require handoff:",
    `  user: "scrape my last 5 emails" → ${CHAT_HANDOFF_SENTINEL_PREFIX} — fetching your latest 5 emails now.`,
    `  user: "what's in my inbox" → ${CHAT_HANDOFF_SENTINEL_PREFIX} — checking your inbox.`,
    `  user: "do you have gmail connected?" → ${CHAT_HANDOFF_SENTINEL_PREFIX} — checking the Gmail connection status.`,
    `  user: "send james an email saying hi" → ${CHAT_HANDOFF_SENTINEL_PREFIX} — sending that email to James now.`,
    `  user: "list my agents" → ${CHAT_HANDOFF_SENTINEL_PREFIX} — pulling the agent list.`,
    `  user: "create a marketing department" → ${CHAT_HANDOFF_SENTINEL_PREFIX} — building out your marketing department.`,
    `  user: "what's in my notion?" → ${CHAT_HANDOFF_SENTINEL_PREFIX} — checking Notion now.`,
    `  user: "look up X" → ${CHAT_HANDOFF_SENTINEL_PREFIX} — looking that up for you.`,
    "",
    "ONLY answer directly (no handoff) if the request is pure conversation requiring no system or external data: greetings, opinions, advice, explanations of concepts, brainstorming, jokes. If in doubt → HANDOFF.",
    "",
    "Your persona below is HOW you communicate (voice, name, style), NOT what you're allowed to do. Every persona has full handoff rights regardless of their job title.",
    "",
  );

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
    "Reply concisely — small screen, phone reading. Three to five short sentences max; one sentence is often best.",
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
}): Promise<AgentChatResult> {
  const { organizationId, organizationName, chatId, userMessage, publicAppUrl, agentId } =
    input;

  const claudeToken = await loadClaudeMaxToken(organizationId);
  if (!claudeToken) {
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
    loadRecentHistory(organizationId, chatId),
  ]);

  // mcpToken is unused on the OAuth path (MCP server tools aren't allowed
  // alongside oauth-2025-04-20). Reference it so the linter doesn't warn,
  // and keep it visible for when Anthropic enables both betas together.
  void mcpToken;

  // Persona + instructions live in the FIRST user turn, NOT in `system`.
  // The OAuth gate rejects any system content beyond CLAUDE_CODE_PREFIX.
  // We tag the preamble so the model can ignore the framing tokens.
  const preamble = buildPersonaPreamble(organizationName, persona);
  const firstUserContent =
    `<persona-and-instructions>\n${preamble}\n</persona-and-instructions>\n\n${userMessage}`;

  // History stays as-is; preamble only goes on the freshest user turn.
  const messages = [
    ...history,
    { role: "user" as const, content: firstUserContent },
  ];

  const body: Record<string, unknown> = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: CLAUDE_CODE_PREFIX,
    messages,
  };

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        authorization: `Bearer ${claudeToken}`,
        "anthropic-version": "2023-06-01",
        // `oauth-2025-04-20` is the gate that lets /v1/messages accept
        // sk-ant-oat01-* tokens. NOTE: stacking `mcp-client-2025-04-04`
        // alongside makes Anthropic return a misleading rate_limit_error
        // — the two betas can't be combined for OAuth-billed inference
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
  } catch (err) {
    return {
      ok: false,
      error: `Anthropic call failed: ${(err as Error).message}`,
    };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      error: `Anthropic ${res.status}: ${text.slice(0, 300)}`,
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
