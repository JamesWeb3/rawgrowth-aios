import { registerTool, text, textError } from "../registry";
import { supabaseAdmin } from "@/lib/supabase/server";
import { editMessageText, sendMessage } from "@/lib/telegram/client";
import { tryDecryptSecret } from "@/lib/crypto";

/**
 * MCP tools for conversational Telegram. Used by the drain skill
 * `/rawgrowth-chat` (and any other Claude Code session) to read inbound
 * messages and reply via the right bot. Bot tokens never leave the VPS
 * (encrypted in rgaios_connections.metadata.bot_token or
 * rgaios_agent_telegram_bots.bot_token) — Claude Code only sees an
 * opaque message_id / chat_id.
 *
 * Token lookup is dual-path:
 *   • Per-Department-Head bots — the new model. Inbox rows carry an
 *     `agent_telegram_bot_id` pointing at `rgaios_agent_telegram_bots`,
 *     which holds the encrypted token for THAT specific bot.
 *   • Legacy org-level bots — the old model. Inbox rows carry a
 *     `connection_id` pointing at `rgaios_connections` with
 *     provider_config_key='telegram'. Kept as a fallback so any
 *     organisation that hasn't migrated yet still works.
 *
 * The bot token never leaves the VPS. Tools only return the resolved
 * chat_id and any drafts/responses.
 */

type AnyInboxRow = {
  id: string;
  organization_id: string;
  chat_id: number;
  text: string | null;
  responded_at: string | null;
  received_at: string;
  sender_username: string | null;
  sender_first_name: string | null;
  placeholder_message_id: number | null;
  connection_id: string | null;
  agent_telegram_bot_id: string | null;
};

/**
 * Resolve the bot token + display name for an inbox row, regardless of
 * whether it came in through a per-head bot or the legacy org-level bot.
 */
async function resolveBotForInboxRow(row: {
  organization_id: string;
  agent_telegram_bot_id: string | null;
  connection_id: string | null;
}): Promise<{ token: string; label: string; agentId: string | null } | null> {
  const db = supabaseAdmin();

  if (row.agent_telegram_bot_id) {
    const { data } = await db
      .from("rgaios_agent_telegram_bots")
      .select("bot_token, bot_username, bot_first_name, agent_id")
      .eq("id", row.agent_telegram_bot_id)
      .eq("organization_id", row.organization_id)
      .maybeSingle();
    if (data) {
      const token = tryDecryptSecret(data.bot_token);
      if (token) {
        return {
          token,
          label: data.bot_username ? `@${data.bot_username}` : (data.bot_first_name ?? "bot"),
          agentId: data.agent_id ?? null,
        };
      }
    }
  }

  if (row.connection_id) {
    const { data } = await db
      .from("rgaios_connections")
      .select("metadata, display_name, agent_id")
      .eq("id", row.connection_id)
      .eq("organization_id", row.organization_id)
      .eq("provider_config_key", "telegram")
      .maybeSingle();
    if (data) {
      const token = tryDecryptSecret(
        (data.metadata as { bot_token?: string } | null)?.bot_token,
      );
      if (token) {
        return {
          token,
          label: data.display_name ?? "bot",
          agentId: (data as { agent_id?: string | null }).agent_id ?? null,
        };
      }
    }
  }

  return null;
}

/**
 * Resolve the bot that OWNS a given chat. There is no separate
 * conversation table — the conversation's bot linkage lives on the
 * inbox rows themselves (every `rgaios_telegram_messages` row carries
 * either `agent_telegram_bot_id` or `connection_id` for the bot it
 * arrived on). So the most recent message for this chat_id within the
 * org tells us which bot the chat belongs to. This is the correct
 * per-conversation routing on a multi-bot org — picking "any" bot can
 * send the reply out through the wrong persona.
 */
async function resolveBotForChat(
  organizationId: string,
  chatId: number,
): Promise<{ token: string; label: string; agentId: string | null } | null> {
  const db = supabaseAdmin();

  const { data: lastMsg } = await db
    .from("rgaios_telegram_messages")
    .select("agent_telegram_bot_id, connection_id")
    .eq("organization_id", organizationId)
    .eq("chat_id", chatId)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastMsg && (lastMsg.agent_telegram_bot_id || lastMsg.connection_id)) {
    const bot = await resolveBotForInboxRow({
      organization_id: organizationId,
      agent_telegram_bot_id: lastMsg.agent_telegram_bot_id,
      connection_id: lastMsg.connection_id,
    });
    if (bot) return bot;
  }

  return null;
}

/**
 * Resolve the per-head bot wired to a specific agent. Used as the
 * second-choice route for a raw chat_id with no message history: if we
 * know the calling agent (ctx.agentId), send through THAT agent's bot
 * rather than guessing.
 */
async function resolveBotForAgent(
  organizationId: string,
  agentId: string,
): Promise<{ token: string; label: string; agentId: string | null } | null> {
  const db = supabaseAdmin();

  const { data } = await db
    .from("rgaios_agent_telegram_bots")
    .select("bot_token, bot_username, bot_first_name, agent_id")
    .eq("organization_id", organizationId)
    .eq("agent_id", agentId)
    .eq("status", "connected")
    .maybeSingle();
  if (data) {
    const token = tryDecryptSecret(data.bot_token);
    if (token) {
      return {
        token,
        label: data.bot_username ? `@${data.bot_username}` : (data.bot_first_name ?? "bot"),
        agentId: data.agent_id ?? null,
      };
    }
  }

  return null;
}

/**
 * Find ANY connected bot for the org. LAST-RESORT fallback only — used
 * when the caller passes a raw chat_id with no message history AND we
 * can't tie the call to an agent. On a multi-bot org this is a guess
 * (oldest per-head bot, then legacy), so callers log a warning.
 * Prefers a per-head bot (newer model) and falls back to legacy.
 */
async function pickAnyBotForOrg(
  organizationId: string,
): Promise<{ token: string; label: string; agentId: string | null } | null> {
  const db = supabaseAdmin();

  const { data: head } = await db
    .from("rgaios_agent_telegram_bots")
    .select("bot_token, bot_username, bot_first_name, agent_id")
    .eq("organization_id", organizationId)
    .eq("status", "connected")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (head) {
    const token = tryDecryptSecret(head.bot_token);
    if (token) {
      return {
        token,
        label: head.bot_username ? `@${head.bot_username}` : (head.bot_first_name ?? "bot"),
        agentId: head.agent_id ?? null,
      };
    }
  }

  const { data: legacy } = await db
    .from("rgaios_connections")
    .select("id, metadata, display_name, agent_id")
    .eq("organization_id", organizationId)
    .eq("provider_config_key", "telegram")
    .eq("status", "connected")
    .maybeSingle();
  if (legacy) {
    const token = tryDecryptSecret(
      (legacy.metadata as { bot_token?: string } | null)?.bot_token,
    );
    if (token) {
      return {
        token,
        label: legacy.display_name ?? "bot",
        agentId: (legacy as { agent_id?: string | null }).agent_id ?? null,
      };
    }
  }

  return null;
}

/**
 * Pick the bot to send a freeform chat_id reply through, in priority
 * order so multi-bot orgs route to the right persona:
 *   (a) the bot that owns this conversation — newest inbox row for the
 *       chat_id carries the connection/bot linkage;
 *   (b) the bot wired to the calling agent (ctx.agentId);
 *   (c) last-resort: any connected bot, with a warning that it's a guess.
 */
async function resolveBotForChatIdReply(
  organizationId: string,
  chatId: number,
  agentId: string | null | undefined,
): Promise<{ token: string; label: string; agentId: string | null } | null> {
  const owner = await resolveBotForChat(organizationId, chatId);
  if (owner) return owner;

  if (agentId) {
    const agentBot = await resolveBotForAgent(organizationId, agentId);
    if (agentBot) return agentBot;
  }

  const fallback = await pickAnyBotForOrg(organizationId);
  if (fallback) {
    console.warn(
      `[telegram_reply] no conversation history or agent-bot link for chat ${chatId} ` +
        `(org ${organizationId}, agent ${agentId ?? "unknown"}) — guessing bot ${fallback.label}; ` +
        `reply may go out through the wrong bot on a multi-bot org`,
    );
  }
  return fallback;
}

// ─── telegram_inbox_read ───────────────────────────────────────────

registerTool({
  name: "telegram_inbox_read",
  description:
    "Read recent inbound Telegram messages across every bot connected to this organization (per-Department-Head bots + any legacy org-level bot). Defaults to unanswered messages only.",
  inputSchema: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description: "Max messages to return (default 20, max 100).",
      },
      include_answered: {
        type: "boolean",
        description:
          "If true, include messages that have already been replied to. Default false.",
      },
    },
  },
  handler: async (args, ctx) => {
    const limit = Math.min(Number(args.limit ?? 20) || 20, 100);
    const includeAnswered = Boolean(args.include_answered ?? false);

    let q = supabaseAdmin()
      .from("rgaios_telegram_messages")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .order("received_at", { ascending: false })
      .limit(limit);
    if (!includeAnswered) q = q.is("responded_at", null);

    const { data, error } = await q;
    if (error) return textError(`telegram_inbox_read: ${error.message}`);
    const rows = (data ?? []) as AnyInboxRow[];
    if (rows.length === 0) {
      return text(
        includeAnswered
          ? "No Telegram messages found."
          : "No unanswered Telegram messages. Inbox zero.",
      );
    }

    // Resolve bot label per-message so the caller can tell which bot a
    // message came in through (Maya's bot vs Sentinel's bot, etc.).
    const labels = await Promise.all(
      rows.map(async (m) => (await resolveBotForInboxRow(m))?.label ?? "(bot disconnected)"),
    );

    const lines = [
      `Found ${rows.length} ${includeAnswered ? "recent" : "unanswered"} Telegram message(s):`,
      "",
      ...rows.map((m, i) => {
        const who =
          m.sender_username != null
            ? `@${m.sender_username}`
            : (m.sender_first_name ?? `chat ${m.chat_id}`);
        const status = m.responded_at ? " ✓ answered" : "";
        return [
          `- \`${m.id}\` · ${who} → ${labels[i]} · ${m.received_at}${status}`,
          `    chat_id: ${m.chat_id}`,
          `    > ${(m.text ?? "").slice(0, 400)}`,
        ].join("\n");
      }),
      "",
      "Reply with `telegram_reply` using the id above (preferred — keeps the placeholder bubble in place).",
    ];
    return text(lines.join("\n"));
  },
});

// ─── telegram_reply ────────────────────────────────────────────────

registerTool({
  name: "telegram_reply",
  description:
    "Reply to an inbound Telegram message. Pass `message_id` (from telegram_inbox_read) to reply through the SAME bot the message came in on and edit the thinking-placeholder in place. Or pass `chat_id` for a freeform send through any connected bot.",
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: {
      message_id: {
        type: "string",
        description:
          "Rawclaw id of an inbox message. Reply targets that chat, uses the same bot, and marks the message answered.",
      },
      chat_id: {
        type: "number",
        description:
          "Telegram chat id. Use only if you don't have a message_id; routes through any connected bot.",
      },
      text: {
        type: "string",
        description: "The reply text. Supports plain markdown.",
      },
    },
    required: ["text"],
  },
  handler: async (args, ctx) => {
    const raw = String(args.text ?? "").trim();
    if (!raw) return textError("text is required");

    const db = supabaseAdmin();
    let chatId: number | null = null;
    let rawclawMessageId: string | null = null;
    let placeholderMessageId: number | null = null;
    let bot: { token: string; label: string; agentId: string | null } | null =
      null;

    if (args.message_id) {
      rawclawMessageId = String(args.message_id);
      const { data: msg } = await db
        .from("rgaios_telegram_messages")
        .select(
          "chat_id, placeholder_message_id, organization_id, agent_telegram_bot_id, connection_id",
        )
        .eq("id", rawclawMessageId)
        .eq("organization_id", ctx.organizationId)
        .maybeSingle();
      if (!msg) return textError(`No inbox message ${rawclawMessageId} found.`);
      chatId = msg.chat_id;
      placeholderMessageId = msg.placeholder_message_id ?? null;
      bot = await resolveBotForInboxRow({
        organization_id: msg.organization_id,
        agent_telegram_bot_id: msg.agent_telegram_bot_id,
        connection_id: msg.connection_id,
      });
    } else if (args.chat_id !== undefined) {
      chatId = Number(args.chat_id);
      bot = await resolveBotForChatIdReply(
        ctx.organizationId,
        chatId,
        ctx.agentId,
      );
    } else {
      return textError("Either message_id or chat_id is required.");
    }

    if (!bot) {
      return textError(
        "No connected Telegram bot for this org. Connect a bot to a Department Head agent first (Agents → edit → Telegram bot).",
      );
    }

    // Brand-voice guard (CTO brief §P09). Two-pass flow:
    //   1. checkBrandVoice on raw output.
    //   2. If hit, regenerateWithBrandReminder (Haiku, 10s timeout,
    //      explicit "do not use these words" reminder). Result is
    //      already re-checked inside the helper.
    //   3. If still hit (or regen errored), hard-fail: refuse to send and
    //      surface to the operator via rgaios_audit_log
    //      (kind=brand_voice_hard_fail).
    //   4. On clean-after-regen, audit a lower-severity
    //      brand_voice_regenerated entry so the activity feed shows when
    //      Claude tripped the filter.
    const { checkBrandVoice, regenerateWithBrandReminder } = await import(
      "@/lib/brand/runtime-filter"
    );
    const agentId = bot.agentId;

    let body = raw;
    const firstPass = checkBrandVoice(raw);
    if (!firstPass.ok) {
      console.warn(
        `[telegram_reply] brand-voice pass-1 hit: ${firstPass.hits.join(",")}, regenerating`,
      );
      const regen = await regenerateWithBrandReminder(raw, firstPass.hits, {
        organizationId: ctx.organizationId,
        agentId,
      });
      if (!regen.ok) {
        console.error(
          `[telegram_reply] brand-voice hard-fail after pass-2: ${regen.hits.join(",")}`,
        );
        await db
          .from("rgaios_audit_log")
          .insert({
            organization_id: ctx.organizationId,
            kind: "brand_voice_hard_fail",
            actor_type: "system",
            actor_id: "telegram_reply",
            detail: {
              agent_id: agentId,
              original_excerpt: raw.slice(0, 500),
              final_attempt_excerpt: regen.finalAttempt.slice(0, 500),
              hits_first: firstPass.hits,
              hits_second: regen.hits,
            },
          });
        return textError(
          `Brand voice guard: copy still contained banned words after one regeneration. Operator review needed. Hits: ${regen.hits.join(", ")}`,
        );
      }
      body = regen.text;
      await db
        .from("rgaios_audit_log")
        .insert({
          organization_id: ctx.organizationId,
          kind: "brand_voice_regenerated",
          actor_type: "system",
          actor_id: "telegram_reply",
          detail: {
            agent_id: agentId,
            hits_first: firstPass.hits,
            original_excerpt: raw.slice(0, 500),
            final_excerpt: body.slice(0, 500),
          },
        });
    }

    // Edit the thinking-placeholder in place if one is active — the user
    // sees a single bubble morph from "💭 Thinking…" into the real reply.
    try {
      if (placeholderMessageId !== null && chatId !== null) {
        await editMessageText(bot.token, chatId, placeholderMessageId, body);
      } else {
        await sendMessage(bot.token, chatId as number, body);
      }
    } catch (err) {
      // Placeholder expired (>48h) or was deleted — fall back to a new send.
      if (placeholderMessageId !== null && chatId !== null) {
        try {
          await sendMessage(bot.token, chatId, body);
        } catch (err2) {
          return textError(`telegram_reply: ${(err2 as Error).message}`);
        }
      } else {
        return textError(`telegram_reply: ${(err as Error).message}`);
      }
    }

    if (rawclawMessageId) {
      await db
        .from("rgaios_telegram_messages")
        .update({
          responded_at: new Date().toISOString(),
          response_text: body,
          placeholder_message_id: null,
        })
        .eq("id", rawclawMessageId)
        .eq("organization_id", ctx.organizationId);
    }

    return text(
      rawclawMessageId
        ? `Replied to message \`${rawclawMessageId}\` via ${bot.label}${placeholderMessageId ? " (edited placeholder in place)" : ""}.`
        : `Sent message to chat ${chatId} via ${bot.label}.`,
    );
  },
});
