import { registerTool, text, textError } from "../registry";
import { supabaseAdmin } from "@/lib/supabase/server";
import { tryDecryptSecret } from "@/lib/crypto";

/**
 * Outbound-only Telegram send. Unlike telegram_reply this does not
 * resolve an inbox row - the caller supplies bot_username + chat_id
 * directly, and we look up the connection wired for THIS org.
 *
 * Bot tokens never leave the VPS; lookup is scoped by
 * organization_id so cross-tenant calls cannot reach another org's
 * bot row.
 */

const MAX_TEXT = 4000;

registerTool({
  name: "telegram_send_message",
  description:
    "Send a Telegram message to a known chat_id using one of the org's wired bots. Use this when the operator asks you to DM someone, e.g. notify Marti of a launch.",
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: {
      bot_username: {
        type: "string",
        description:
          "Username of the wired bot to send through (e.g. \"marti_marketing_bot\").",
      },
      chat_id: {
        type: "number",
        description: "Telegram chat id to deliver the message to.",
      },
      text: {
        type: "string",
        description: `Message body. Max ${MAX_TEXT} characters.`,
      },
    },
    required: ["bot_username", "chat_id", "text"],
  },
  handler: async (args, ctx) => {
    const botUsername = String(args.bot_username ?? "").trim();
    if (!botUsername) return textError("bot_username is required");

    const chatIdRaw = args.chat_id;
    const chatId = Number(chatIdRaw);
    if (chatIdRaw === undefined || chatIdRaw === null || !Number.isFinite(chatId)) {
      return textError("chat_id is required");
    }

    const body = String(args.text ?? "");
    if (!body.trim()) return textError("text is required");
    if (body.length > MAX_TEXT) {
      return textError(`text exceeds ${MAX_TEXT} chars`);
    }

    const db = supabaseAdmin();
    const { data, error } = await db
      .from("rgaios_connections")
      .select("metadata")
      .eq("organization_id", ctx.organizationId)
      .eq("provider_config_key", "telegram")
      .filter("metadata->>bot_username", "eq", botUsername)
      .maybeSingle();

    if (error) return textError(`telegram_send_message: ${error.message}`);
    if (!data) return textError("bot not wired for this org");

    const token = tryDecryptSecret(
      (data.metadata as { bot_token?: string } | null)?.bot_token,
    );
    if (!token) return textError("bot not wired for this org");

    let res: Response;
    try {
      res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: body }),
      });
    } catch (err) {
      return textError(`telegram_send_message: ${(err as Error).message}`);
    }

    if (res.status === 200) {
      return text(`Sent to chat ${chatId}`);
    }

    let respBody = "";
    try {
      respBody = await res.text();
    } catch {
      respBody = "(no body)";
    }
    return textError(
      `telegram_send_message: ${res.status} ${respBody.slice(0, 500)}`,
    );
  },
});
