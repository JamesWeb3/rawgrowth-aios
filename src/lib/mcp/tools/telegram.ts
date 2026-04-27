import { registerTool, text, textError } from "../registry";
import { supabaseAdmin } from "@/lib/supabase/server";
import { editMessageText, sendMessage } from "@/lib/telegram/client";
import { tryDecryptSecret } from "@/lib/crypto";

/**
 * MCP tools for conversational Telegram. The client's Claude Code uses
 * these to read inbound messages the client has texted to their bot, and
 * to send replies back via the same bot. The actual bot token lives on
 * the VPS (in rgaios_connections.metadata.bot_token)  -  never exposed to
 * Claude Code.
 *
 * Workflow:
 *   1. Client texts the bot → webhook writes to rgaios_telegram_messages
 *   2. Client opens Claude Code, runs /rawgrowth-chat
 *   3. Claude calls telegram_inbox_read → sees unanswered messages
 *   4. Claude does the work (gmail search, etc.) and calls telegram_reply
 */

async function getTelegramConnection(organizationId: string) {
  const { data } = await supabaseAdmin()
    .from("rgaios_connections")
    .select("id, metadata, display_name, agent_id")
    .eq("organization_id", organizationId)
    .eq("provider_config_key", "telegram")
    .eq("status", "connected")
    .maybeSingle();
  return data;
}

// ─── telegram_inbox_read ───────────────────────────────────────────

registerTool({
  name: "telegram_inbox_read",
  description:
    "Read recent inbound messages from the connected Telegram bot. Defaults to unanswered messages only. Use this to see what the user has texted the bot since your last response.",
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
    const conn = await getTelegramConnection(ctx.organizationId);
    if (!conn) {
      return textError(
        "Telegram isn't connected for this organization. Connect a bot in the Rawclaw UI under /integrations first.",
      );
    }
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
    const rows = data ?? [];
    if (rows.length === 0) {
      return text(
        includeAnswered
          ? "No Telegram messages found."
          : "No unanswered Telegram messages. Inbox zero.",
      );
    }

    const lines = [
      `Found ${rows.length} ${includeAnswered ? "recent" : "unanswered"} Telegram message(s):`,
      "",
      ...rows.map((m) => {
        const who =
          m.sender_username != null
            ? `@${m.sender_username}`
            : (m.sender_first_name ?? `chat ${m.chat_id}`);
        const status = m.responded_at ? " ✓ answered" : "";
        return [
          `- \`${m.id}\` · ${who} · ${m.received_at}${status}`,
          `    chat_id: ${m.chat_id}`,
          `    > ${(m.text ?? "").slice(0, 400)}`,
        ].join("\n");
      }),
      "",
      "Reply with `telegram_reply` using the id above (or chat_id for freeform sends).",
    ];
    return text(lines.join("\n"));
  },
});

// ─── telegram_reply ────────────────────────────────────────────────

registerTool({
  name: "telegram_reply",
  description:
    "Reply to an inbound Telegram message. Pass either `message_id` (from telegram_inbox_read) to reply to a specific message and mark it answered, or `chat_id` to send a freeform message to any chat the bot has seen.",
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: {
      message_id: {
        type: "string",
        description:
          "Rawclaw id of an inbox message. The reply targets that chat and marks the message as answered.",
      },
      chat_id: {
        type: "number",
        description:
          "Telegram chat id. Use only if you don't have a message_id.",
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
    // Pull connection (and the agent_id it's bound to) up front so audit
    // rows on the brand-voice path can attribute hits to the right agent.
    const conn = await getTelegramConnection(ctx.organizationId);
    if (!conn) {
      return textError(
        "Telegram isn't connected for this organization. Connect a bot in the Rawclaw UI under /integrations first.",
      );
    }
    const agentId =
      (conn as { agent_id?: string | null }).agent_id ?? null;

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
        await supabaseAdmin()
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
      await supabaseAdmin()
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

    const botToken = tryDecryptSecret(
      (conn.metadata as { bot_token?: string } | null)?.bot_token,
    );
    if (!botToken) {
      return textError("Telegram bot token missing on the connection row.");
    }

    const db = supabaseAdmin();
    let chatId: number | null = null;
    let rawclawMessageId: string | null = null;
    let placeholderMessageId: number | null = null;

    if (args.message_id) {
      rawclawMessageId = String(args.message_id);
      const { data: msg } = await db
        .from("rgaios_telegram_messages")
        .select("chat_id, placeholder_message_id")
        .eq("id", rawclawMessageId)
        .eq("organization_id", ctx.organizationId)
        .maybeSingle();
      if (!msg) return textError(`No inbox message ${rawclawMessageId} found.`);
      chatId = msg.chat_id;
      placeholderMessageId =
        (msg as { placeholder_message_id?: number | null })
          .placeholder_message_id ?? null;
    } else if (args.chat_id !== undefined) {
      chatId = Number(args.chat_id);
    } else {
      return textError(
        "Either message_id or chat_id is required.",
      );
    }

    // If a thinking-placeholder bubble is active for this inbox row,
    // edit IT in place instead of sending a fresh bubble underneath.
    // The user sees the one bubble morph: "💭 Thinking…" → the real reply.
    try {
      if (placeholderMessageId !== null && chatId !== null) {
        await editMessageText(botToken, chatId, placeholderMessageId, body);
      } else {
        await sendMessage(botToken, chatId as number, body);
      }
    } catch (err) {
      // Placeholder may have expired (>48h) or been deleted. Fall back
      // to sending a new message rather than failing the whole tool call.
      if (placeholderMessageId !== null && chatId !== null) {
        try {
          await sendMessage(botToken, chatId, body);
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
          // Clear so the ticker in the webhook knows we've handled it.
          placeholder_message_id: null,
        })
        .eq("id", rawclawMessageId)
        .eq("organization_id", ctx.organizationId);
    }

    return text(
      rawclawMessageId
        ? `Replied to message \`${rawclawMessageId}\`${placeholderMessageId ? " (edited placeholder in place)" : ""}.`
        : `Sent message to chat ${chatId}.`,
    );
  },
});
