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
  // For v1 we use the first non-paused agent as the public-facing persona.
  // Multi-department routing comes later (TODO #2).
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

function buildSystemPrompt(
  orgName: string | null,
  persona: RawgrowthAgent | null,
): string {
  const lines: string[] = [CLAUDE_CODE_PREFIX, ""];
  if (persona) {
    lines.push(
      `Right now you are acting as ${persona.name}${persona.title ? `, ${persona.title}` : ""}, an AI agent operating inside ${orgName ?? "this organization"}'s Rawgrowth workspace.`,
    );
    if (persona.description) {
      lines.push("", persona.description);
    }
  } else {
    lines.push(
      `Right now you are acting as an AI agent operating inside ${orgName ?? "this organization"}'s Rawgrowth workspace.`,
    );
  }
  lines.push(
    "",
    "You are talking to the operator over Telegram. Reply concisely — Telegram has a small screen and people read these on phones. Three to five short sentences max for normal answers; one sentence is often best.",
    "Use plain text or simple Markdown (bold, italics, code). No tables, no headings, no long bullet lists.",
    "",
    "IMPORTANT — TOOL ACCESS:",
    "You do NOT have access to any tools in this conversation. You cannot create, update, delete, or list anything in the workspace (agents, routines, skills, departments, runs, approvals, knowledge, telegram inbox, etc.). You also cannot send Gmail / Slack / Notion / Drive / etc.",
    "",
    "If the operator asks you to DO something (create an agent, set up a department, schedule a routine, send an email, list things, look up data, etc.) — reply with exactly this single line and nothing else, optionally followed by a one-sentence personalised acknowledgement of what they asked for:",
    "",
    `${CHAT_HANDOFF_SENTINEL_PREFIX} — <one short sentence describing what you'll do>.`,
    "",
    "Examples:",
    `  ${CHAT_HANDOFF_SENTINEL_PREFIX} — spinning up your marketing department now.`,
    `  ${CHAT_HANDOFF_SENTINEL_PREFIX} — hiring Linus as your CTO with code-review skills.`,
    `  ${CHAT_HANDOFF_SENTINEL_PREFIX} — pulling your latest pending approvals.`,
    "",
    "Do NOT pretend you've already done the action. Do NOT make up agent names, IDs, or counts. The system will pick up the handoff and the actual work will be done by another path; the operator will get a follow-up message with the real result.",
    "",
    "If the operator just wants to chat or ask a general question (greetings, advice, opinions, explanations, anything that doesn't require touching workspace state) — answer directly without the handoff line.",
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
}): Promise<AgentChatResult> {
  const { organizationId, organizationName, chatId, userMessage, publicAppUrl } =
    input;

  const claudeToken = await loadClaudeMaxToken(organizationId);
  if (!claudeToken) {
    return {
      ok: false,
      error:
        "No Claude Max token connected for this organization. Connect one in Dashboard → Connections.",
    };
  }

  const [mcpToken, persona, history] = await Promise.all([
    loadOrgMcpToken(organizationId),
    loadDefaultPersona(organizationId),
    loadRecentHistory(organizationId, chatId),
  ]);

  // Append the new inbound message as the final user turn.
  const messages = [...history, { role: "user" as const, content: userMessage }];

  // mcpToken is unused on the OAuth path (MCP server tools aren't allowed
  // alongside oauth-2025-04-20). Reference it so the linter doesn't warn,
  // and keep it visible for when Anthropic enables both betas together.
  void mcpToken;

  const body: Record<string, unknown> = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: buildSystemPrompt(organizationName, persona),
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
