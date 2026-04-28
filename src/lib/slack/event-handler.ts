import { supabaseAdmin } from "@/lib/supabase/server";
import { tryDecryptSecret } from "@/lib/crypto";
import {
  downloadFile,
  getFileInfo,
  openDm,
  postMessage,
  type SlackFile,
} from "@/lib/slack/client";
import {
  listEnabledBindingsForChannel,
  markFired,
  type SlackBinding,
} from "@/lib/slack/bindings";
import { chatReply, CHAT_HANDOFF_SENTINEL_PREFIX } from "@/lib/agent/chat";

/**
 * Shape of the relevant inner-events Slack delivers to our webhook.
 * We only use the fields we actually care about.
 */
export type SlackInnerEvent = {
  type: string;
  channel?: string;
  channel_type?: string;
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  files?: SlackFile[];
  file_id?: string;
  subtype?: string;
  bot_id?: string;
};

/**
 * Process one inner event against all matching bindings for (team, channel).
 * Runs in an `after()` so the webhook 200s back to Slack within 3s.
 */
export async function handleSlackEvent(input: {
  teamId: string;
  event: SlackInnerEvent;
  organizationName: string | null;
  publicAppUrl: string;
}): Promise<void> {
  const { teamId, event, organizationName, publicAppUrl } = input;

  // Ignore messages from bots (including our own)  -  prevents infinite
  // reply loops when our agent posts back into the same channel.
  if (event.bot_id) return;
  if (event.subtype === "bot_message" || event.subtype === "message_deleted")
    return;

  const channel = event.channel;
  if (!channel) return;

  const bindings = await listEnabledBindingsForChannel({
    teamId,
    channelId: channel,
  });
  if (bindings.length === 0) return;

  // Self-hosted Rawclaw is one org per VPS, so there's at most one
  // Slack connection row and its team_id already matches the event's
  // team_id (bindings wouldn't exist otherwise). Just grab the token.
  const { data: orgConn } = await supabaseAdmin()
    .from("rgaios_connections")
    .select("organization_id, metadata")
    .eq("provider_config_key", "slack")
    .limit(1)
    .maybeSingle();

  const meta = (orgConn?.metadata ?? {}) as { bot_token?: string };
  const botToken = tryDecryptSecret(meta.bot_token);
  if (!botToken) return;

  for (const binding of bindings) {
    if (!triggerMatches(binding.trigger_type, event)) continue;

    await fireBinding({
      binding,
      event,
      botToken,
      organizationName,
      publicAppUrl,
    });
  }
}

function triggerMatches(
  trigger: SlackBinding["trigger_type"],
  event: SlackInnerEvent,
): boolean {
  switch (trigger) {
    case "new_message":
      // Any non-bot message posted to the channel (and not a file-only one).
      return event.type === "message" && !event.subtype;
    case "app_mention":
      return event.type === "app_mention";
    case "new_file":
    case "transcript":
      // Either a file_shared event or a message with files attached.
      return (
        event.type === "file_shared" ||
        (event.type === "message" &&
          Array.isArray(event.files) &&
          event.files.length > 0)
      );
    default:
      return false;
  }
}

async function fireBinding(input: {
  binding: SlackBinding;
  event: SlackInnerEvent;
  botToken: string;
  organizationName: string | null;
  publicAppUrl: string;
}): Promise<void> {
  const { binding, event, botToken, organizationName, publicAppUrl } = input;

  // ─── 1. Build the user-message content ─────────────────────────
  const parts: string[] = [];
  if (event.text) parts.push(event.text);

  // Pull file contents for transcript-style triggers.
  if (
    binding.trigger_type === "new_file" ||
    binding.trigger_type === "transcript"
  ) {
    const file = await resolveFile(botToken, event);
    if (file) {
      parts.push(`\n\n--- File: ${file.name ?? file.id} ---`);
      if (file.transcription?.preview?.content) {
        parts.push(file.transcription.preview.content);
      } else if (file.url_private_download) {
        try {
          const content = await downloadFile(
            botToken,
            file.url_private_download,
          );
          parts.push(content.slice(0, 200_000)); // 200k char ceiling
        } catch (err) {
          parts.push(
            `(couldn't download file contents: ${(err as Error).message})`,
          );
        }
      }
    }
  }

  const userMessage = parts.join("\n").trim();
  if (!userMessage) return;

  // ─── 2. Prompt the agent ───────────────────────────────────────
  // binding.prompt_template is prepended to the user message so the
  // agent knows what to do with the raw content (e.g. "extract tasks").
  const effectiveMessage = binding.prompt_template
    ? `${binding.prompt_template}\n\n---\n${userMessage}`
    : userMessage;

  const result = await chatReply({
    organizationId: binding.organization_id,
    organizationName,
    chatId: 0, // Slack channel, not Telegram  -  just a placeholder for history keying
    userMessage: effectiveMessage,
    publicAppUrl,
  });

  if (!result.ok) {
    console.error(
      `[slack] chatReply failed for binding ${binding.id}: ${result.error}`,
    );
    return;
  }

  // ─── 3a. Tool-handoff path ─────────────────────────────────────
  // chatReply returned the [handoff] sentinel  -  agent wants tools.
  // Hand off to the drain daemon with a one-shot prompt that includes
  // the Slack context + an instruction to post the final reply via
  // the slack_post_message MCP tool.
  if (result.reply.startsWith(CHAT_HANDOFF_SENTINEL_PREFIX)) {
    const ack = result.reply
      .slice(CHAT_HANDOFF_SENTINEL_PREFIX.length)
      .replace(/^\s*-\s*/, "")
      .trim() || "Working on it";

    // Post the immediate "🔧 working on it" so the user sees life
    // while drain grinds (~30-60s for tool-heavy work).
    try {
      await postMessage(botToken, {
        channel: event.channel!,
        text: `🔧 ${ack}`,
        thread_ts: event.thread_ts ?? event.ts,
      });
    } catch {
      /* non-fatal */
    }

    const channelId = event.channel!;
    const threadTs = event.thread_ts ?? event.ts ?? "";
    const personaLine = `${binding.slack_channel_name ? `In Slack channel #${binding.slack_channel_name} ` : ""}the operator just sent: "${userMessage.replace(/"/g, '\\"')}"`;
    const promptTemplateLine = binding.prompt_template
      ? `\n\nFollow this template for what to do with the message: ${binding.prompt_template}`
      : "";

    const prompt =
      `You are an agent in the user's Rawgrowth workspace. ${personaLine}.${promptTemplateLine}\n\n` +
      `You have access to MCP tools (gmail_search, gmail_get_message, gmail_draft, agents_list, etc.). Use whatever tools you need to complete the request.\n\n` +
      `When done, deliver your final answer by calling the slack_post_message MCP tool with:\n` +
      `  channel_id: "${channelId}"\n` +
      (threadTs ? `  thread_ts: "${threadTs}"\n` : "") +
      `  text: <your answer>\n\n` +
      `Do NOT print the answer as your final reply  -  ONLY post it via slack_post_message. Keep the answer concise (3-5 short sentences max, plain text or simple markdown  -  no tables, no long lists). After posting, you can stop.`;

    const drainUrl = process.env.RAWCLAW_DRAIN_URL;
    if (drainUrl) {
      try {
        await fetch(`${drainUrl.replace(/\/$/, "")}/run`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt }),
          signal: AbortSignal.timeout(2_000),
        });
      } catch (err) {
        console.error(
          `[slack] drain /run dispatch failed for binding ${binding.id}: ${(err as Error).message}`,
        );
      }
    } else {
      console.error(
        `[slack] no RAWCLAW_DRAIN_URL set  -  handoff cannot dispatch`,
      );
    }
    await markFired(binding.id);
    return;
  }

  // ─── 3b. Direct chat reply path (no tools needed) ──────────────
  try {
    await routeOutput({
      binding,
      event,
      botToken,
      body: result.reply,
    });
    await markFired(binding.id);
  } catch (err) {
    console.error(
      `[slack] output routing failed for binding ${binding.id}: ${(err as Error).message}`,
    );
  }
}

async function routeOutput(input: {
  binding: SlackBinding;
  event: SlackInnerEvent;
  botToken: string;
  body: string;
}): Promise<void> {
  const { binding, event, botToken, body } = input;
  const cfg = (binding.output_config ?? {}) as {
    channel_id?: string;
    user_id?: string;
    email?: string;
  };

  switch (binding.output_type) {
    case "slack_thread": {
      await postMessage(botToken, {
        channel: event.channel!,
        text: body,
        thread_ts: event.thread_ts ?? event.ts,
      });
      return;
    }
    case "slack_channel": {
      const target = cfg.channel_id;
      if (!target) throw new Error("output_config.channel_id missing");
      await postMessage(botToken, { channel: target, text: body });
      return;
    }
    case "dm_user": {
      const userId = cfg.user_id ?? event.user;
      if (!userId) throw new Error("output_config.user_id missing");
      const dmChannel = await openDm(botToken, userId);
      await postMessage(botToken, { channel: dmChannel, text: body });
      return;
    }
    case "gmail": {
      // Deferred  -  requires a server-side Gmail sender we haven't built.
      // Post the output back into the source channel as a thread note so
      // the operator sees something actionable, plus a loud TODO.
      await postMessage(botToken, {
        channel: event.channel!,
        text:
          `📧 Would email to ${cfg.email ?? "(no email configured)"}:\n\n${body}\n\n_(Gmail output isn't wired up yet  -  this is a placeholder)_`,
        thread_ts: event.thread_ts ?? event.ts,
      });
      return;
    }
  }
}

async function resolveFile(
  botToken: string,
  event: SlackInnerEvent,
): Promise<SlackFile | null> {
  if (Array.isArray(event.files) && event.files.length > 0) {
    return event.files[0];
  }
  if (event.file_id) {
    try {
      return await getFileInfo(botToken, event.file_id);
    } catch {
      return null;
    }
  }
  return null;
}
