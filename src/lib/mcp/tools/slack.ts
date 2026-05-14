import { registerTool, text, textError } from "../registry";
import { supabaseAdmin } from "@/lib/supabase/server";
import { tryDecryptSecret } from "@/lib/crypto";
import { postMessage } from "@/lib/slack/client";

/**
 * MCP tools for posting to Slack from agent runtime.
 *
 * Why this exists: when a Slack-bound agent needs tool access, the
 * webhook hands off to the drain daemon which spawns `claude --print`.
 * That claude session has full rawgrowth MCP tools (gmail, etc.) but
 * needs a way to deliver the final reply back to the originating Slack
 * channel  -  hence this tool.
 *
 * Token resolution: the org's Slack bot token is stored encrypted in
 * rgaios_connections (provider_config_key='slack'). The lookup is
 * org-scoped on organization_id - supabaseAdmin() bypasses RLS, so an
 * unscoped query would return an arbitrary org's row on any box that
 * hosts more than one org (admin / self-hosted / hosted SaaS).
 */

async function getBotToken(orgId: string): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from("rgaios_connections")
    .select("metadata")
    .eq("organization_id", orgId)
    .eq("provider_config_key", "slack")
    .limit(1)
    .maybeSingle();
  const meta = (data?.metadata ?? {}) as { bot_token?: string };
  return tryDecryptSecret(meta.bot_token);
}

registerTool({
  name: "slack_post_message",
  description:
    "Post a message to a Slack channel as the connected Rawgrowth bot. Required: channel_id (Slack channel id like C0123ABCD or a user id for DMs), text. Optional: thread_ts to reply in a thread.",
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: {
      channel_id: {
        type: "string",
        description:
          "Slack channel id (C0123…) or a thread root id for thread replies.",
      },
      text: {
        type: "string",
        description: "Message body (Slack markdown supported).",
      },
      thread_ts: {
        type: "string",
        description:
          "Optional Slack message ts to reply in a thread.",
      },
    },
    required: ["channel_id", "text"],
  },
  handler: async (args, ctx) => {
    const channel = String(args.channel_id ?? "").trim();
    const body = String(args.text ?? "").trim();
    if (!channel || !body) {
      return textError("channel_id and text are required");
    }
    const token = await getBotToken(ctx.organizationId);
    if (!token) {
      return textError(
        "Slack isn't installed for this organization. Connect it at /connections.",
      );
    }
    // Brief §P09 + §12: every outbound user-facing surface gates on the
    // brand-voice two-pass filter. Telegram_reply does this inline; the
    // shared helper covers Slack so the same audit + hard-fail semantics
    // apply here.
    const { applyBrandFilter } = await import("@/lib/brand/apply-filter");
    const filtered = await applyBrandFilter(body, {
      organizationId: ctx.organizationId,
      surface: "slack_post_message",
    });
    if (!filtered.ok) return textError(filtered.error);

    try {
      const sent = await postMessage(token, {
        channel,
        text: filtered.text,
        thread_ts: args.thread_ts ? String(args.thread_ts) : undefined,
      });
      return text(
        `Posted to channel ${sent.channel} (ts: ${sent.ts}).`,
      );
    } catch (err) {
      return textError(`slack_post_message failed: ${(err as Error).message}`);
    }
  },
});
