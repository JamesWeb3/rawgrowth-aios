import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  downloadFile,
  editMessageText,
  getFilePath,
  sendChatAction,
  sendMessage,
  type TgUpdate,
} from "@/lib/telegram/client";
import { tryDecryptSecret } from "@/lib/crypto";
import { chatReply, CHAT_HANDOFF_SENTINEL_PREFIX } from "@/lib/agent/chat";
import { surfaceThinkingTelegram } from "@/lib/agent/thinking";
import { buildAgentChatPreamble } from "@/lib/agent/preamble";
import { transcribeVoice } from "@/lib/agent/voice-transcribe";
import { describeImage } from "@/lib/agent/image-describe";

/**
 * Per-Department-Head Telegram webhook.
 *
 * Telegram POSTs here for every inbound message. The bot row id in the
 * path tells us which head agent owns this bot — we load that agent and
 * pass it to chatReply() as the persona, so the Marketing bot replies as
 * the Marketing head, the Engineering bot as the CTO, etc.
 *
 * This is intentionally separate from the (legacy) org-level
 * /api/webhooks/telegram/[connectionId] handler. Sub-agents cannot have
 * bots — only department heads — so there is exactly one agent per
 * inbound message.
 */

const THINKING_FRAMES = [
  "💭 Thinking",
  "✨ Pondering",
  "🧠 Analysing",
  "⚙️ Working",
  "🔍 Looking into it",
  "📝 Planning",
  "🎯 Focusing",
  "🧩 Putting it together",
];

function startProgressUpdates(opts: {
  token: string;
  chatId: number;
  messageId: number;
  inboxRowId: string;
  acknowledgement: string;
  intervalMs?: number;
  maxMs?: number;
}) {
  const intervalMs = opts.intervalMs ?? 2_500;
  const maxMs = opts.maxMs ?? 5 * 60_000;
  const startedAt = Date.now();
  let frame = 0;

  const tick = async () => {
    const { data } = await supabaseAdmin()
      .from("rgaios_telegram_messages")
      .select("responded_at, placeholder_message_id")
      .eq("id", opts.inboxRowId)
      .maybeSingle();
    const row = data as
      | { responded_at?: string | null; placeholder_message_id?: number | null }
      | null;
    if (row && !row.placeholder_message_id) return;
    if (row && row.responded_at) return;

    if (Date.now() - startedAt > maxMs) {
      editMessageText(
        opts.token,
        opts.chatId,
        opts.messageId,
        `⌛ ${opts.acknowledgement}\nStill working - I'll keep going in the background.`,
      ).catch(() => {});
      return;
    }

    const phrase = THINKING_FRAMES[frame % THINKING_FRAMES.length];
    frame += 1;
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    const elapsedStr =
      elapsed < 60
        ? `${elapsed}s`
        : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;

    await editMessageText(
      opts.token,
      opts.chatId,
      opts.messageId,
      `${phrase}…\n_${opts.acknowledgement} · ${elapsedStr}_`,
    ).catch(() => {});

    setTimeout(() => {
      void tick();
    }, intervalMs);
  };

  setTimeout(() => {
    void tick();
  }, intervalMs);
}

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ botRowId: string }> },
) {
  const { botRowId } = await params;
  const db = supabaseAdmin();

  // 1. Resolve the bot row → its agent + decrypt the bot token.
  const { data: bot, error: botErr } = await db
    .from("rgaios_agent_telegram_bots")
    .select("id, organization_id, agent_id, bot_token, webhook_secret")
    .eq("id", botRowId)
    .maybeSingle();
  if (botErr || !bot) {
    return NextResponse.json({ error: "unknown bot" }, { status: 404 });
  }

  // 2. Verify Telegram's signed secret header.
  // Stored encrypted (enc:v1:...) since round-2 audit; tryDecryptSecret
  // is a no-op for any legacy plaintext rows so this stays compatible
  // until the operator rotates the bot. timingSafeEqual avoids the
  // length-leaking `!==` compare.
  const headerSecret = req.headers.get("x-telegram-bot-api-secret-token");
  const storedSecret = tryDecryptSecret(bot.webhook_secret);
  if (!headerSecret || !storedSecret) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  const a = Buffer.from(headerSecret);
  const b = Buffer.from(storedSecret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  const token = tryDecryptSecret(bot.bot_token);
  if (!token) {
    return NextResponse.json({ error: "bot token missing" }, { status: 500 });
  }

  const organizationId = bot.organization_id;
  const agentId = bot.agent_id;

  // 3. Parse the inbound update.
  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const msg = update.message;
  if (!msg) {
    return NextResponse.json({ ok: true, skipped: "non-message update" });
  }

  // Resolve the inbound message into a single text string. Voice notes
  // get transcribed via Whisper; photos get described via Claude vision.
  // We tag the result so the agent knows the original modality.
  const resolved = await resolveUserMessage({
    msg,
    botToken: token,
    organizationId,
  });

  if (!resolved.ok) {
    // Couldn't extract anything useful — surface the error in-chat so the
    // sender knows we received the message but can't read it. Don't waste
    // an LLM round-trip when there's nothing to act on.
    try {
      await sendMessage(token, msg.chat.id, `⚠️ ${resolved.error}`);
    } catch {
      /* delivery best-effort */
    }
    return NextResponse.json({ ok: true, skipped: resolved.error });
  }

  const text = resolved.text;

  // Log the inbound message into the unified inbox table, scoped to this
  // bot row so each head's chat history stays separate.
  const { data: inboxRow } = await db
    .from("rgaios_telegram_messages")
    .insert({
      organization_id: organizationId,
      agent_telegram_bot_id: bot.id,
      chat_id: msg.chat.id,
      sender_user_id: msg.from?.id ?? null,
      sender_username: msg.from?.username ?? null,
      sender_first_name: msg.from?.first_name ?? null,
      message_id: msg.message_id,
      text,
    })
    .select("id")
    .single();
  const inboxRowId = (inboxRow as { id?: string } | null)?.id ?? null;

  // ─── Reply path ─────────────────────────────────────────────────
  // We respond 200 to Telegram immediately and run chatReply in after()
  // so Telegram never retries on a slow upstream.
  after(async () => {
    sendChatAction(token, msg.chat.id, "typing").catch(() => {});

    // Chris's bug 10 (2026-05-12): the Telegram typing indicator expires
    // after ~5s but chatReply takes 10-60s for tool-using agents, so
    // the bot looked dead after the first "thinking" pulse. Refresh the
    // typing indicator every 4s for the duration of the reply path.
    // Cleared in every return / error branch below via `clearTyping()`.
    const typingTimer = setInterval(() => {
      sendChatAction(token, msg.chat.id, "typing").catch(() => {});
    }, 4_000);
    const clearTyping = () => {
      clearInterval(typingTimer);
    };

    try {

    let placeholderId: number | null = null;
    try {
      const sent = await sendMessage(token, msg.chat.id, "💭 Thinking…");
      placeholderId = sent.message_id;
    } catch {
      placeholderId = null;
    }
    if (placeholderId !== null && inboxRowId) {
      try {
        await supabaseAdmin()
          .from("rgaios_telegram_messages")
          .update({ placeholder_message_id: placeholderId })
          .eq("id", inboxRowId);
      } catch {
        /* non-fatal */
      }
    }

    const publicAppUrl = (
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.NEXTAUTH_URL ??
      new URL(req.url).origin
    ).replace(/\/$/, "");

    const { data: orgRow } = await supabaseAdmin()
      .from("rgaios_organizations")
      .select("name")
      .eq("id", organizationId)
      .maybeSingle();

    // Build the same brand+org+RAG preamble the dashboard chat uses
    // so the Telegram bot replies are grounded in the client's actual
    // offer/voice/SOPs instead of generic SaaS phrasing. Best-effort -
    // a missing embedder just skips RAG.
    const extraPreamble = await buildAgentChatPreamble({
      orgId: organizationId,
      agentId,
      orgName: orgRow?.name ?? null,
      queryText: text,
    }).catch(() => "");

    // The key difference vs the legacy webhook: agentId is passed so the
    // persona is THIS bot's owner, not the org default.
    const result = await chatReply({
      organizationId,
      organizationName: orgRow?.name ?? null,
      chatId: msg.chat.id,
      userMessage: text,
      publicAppUrl,
      agentId,
      extraPreamble,
    });

    if (!result.ok) {
      const drainUrl = process.env.RAWCLAW_DRAIN_URL;
      if (drainUrl) {
        if (placeholderId !== null) {
          editMessageText(token, msg.chat.id, placeholderId, "💭 thinking…").catch(
            () => {},
          );
        }
        fetch(drainUrl, {
          method: "POST",
          signal: AbortSignal.timeout(500),
        }).catch(() => {});
        // Drain takes over the message lifecycle; let it manage typing
        // from here. Clear our refresher so we don't double-fire while
        // drain spawns claude CLI.
        clearTyping();
        return;
      }
      if (placeholderId !== null) {
        await editMessageText(
          token,
          msg.chat.id,
          placeholderId,
          `⚠️ ${result.error}`,
        ).catch(() => {});
      } else {
        await sendMessage(token, msg.chat.id, `⚠️ ${result.error}`).catch(
          () => {},
        );
      }
      clearTyping();
      return;
    }

    // Tool-handoff sentinel — chatReply detected a request that needs
    // MCP tools. Acknowledge in the placeholder, fire the drain daemon.
    if (result.reply.startsWith(CHAT_HANDOFF_SENTINEL_PREFIX)) {
      const acknowledgement = result.reply
        .slice(CHAT_HANDOFF_SENTINEL_PREFIX.length)
        .replace(/^\s*[—-]\s*/, "")
        .trim() || "Working on it";

      if (placeholderId !== null) {
        await editMessageText(
          token,
          msg.chat.id,
          placeholderId,
          `🔧 ${acknowledgement}`,
        ).catch(() => {});
      }

      const drainUrl = process.env.RAWCLAW_DRAIN_URL;
      if (drainUrl) {
        fetch(drainUrl, {
          method: "POST",
          signal: AbortSignal.timeout(500),
        }).catch(() => {});

        if (placeholderId !== null && inboxRowId) {
          startProgressUpdates({
            token,
            chatId: msg.chat.id,
            messageId: placeholderId,
            inboxRowId,
            acknowledgement,
          });
        }
      }
      // Drain owns progress + final reply from here; stop refreshing
      // typing from this handler.
      clearTyping();
      return;
    }

    // Reasoning trace: pull the agent's <thinking> block, log it to
    // /trace, prepend it as a "💭 ..." line so the operator sees the plan.
    const replyWithThinking = await surfaceThinkingTelegram({
      reply: result.reply,
      organizationId,
      agentId,
      messagePreview: msg.text ?? "",
    });

    // Brand-voice guard before send. chatReply returns raw model text;
    // without this wrap, banned words from the model reach the customer
    // and §9 auto-fail kicks in.
    const { applyBrandFilter } = await import("@/lib/brand/apply-filter");
    const guarded = await applyBrandFilter(replyWithThinking, {
      organizationId,
      agentId,
      surface: "telegram_chat",
    });
    const replyToSend = guarded.ok
      ? guarded.text
      : `⚠️ Reply blocked by brand-voice guard. Operator: see activity feed.`;

    // Plain reply — swap the placeholder for the real text.
    try {
      if (placeholderId !== null) {
        await editMessageText(token, msg.chat.id, placeholderId, replyToSend);
      } else {
        await sendMessage(token, msg.chat.id, replyToSend);
      }
    } catch {
      /* delivery failure logged elsewhere */
    }

    clearTyping();

    await supabaseAdmin()
      .from("rgaios_telegram_messages")
      .update({
        responded_at: new Date().toISOString(),
        response_text: replyToSend,
        placeholder_message_id: null,
      })
      .eq("id", inboxRowId ?? "");
    } catch (err) {
      clearTyping();
      console.error("[agent-telegram] after() crashed", {
        bot_row_id: botRowId,
        error: (err as Error)?.message,
        stack: (err as Error)?.stack,
      });
      try {
        await sendMessage(
          token,
          msg.chat.id,
          "I hit an internal error. Operator has been notified.",
        );
      } catch {
        /* best-effort */
      }
    }
  });

  return NextResponse.json({ ok: true, inboxed: true, agent_id: agentId });
}

// ─── Multimodal input → text resolver ─────────────────────────────
//
// Telegram delivers messages in three shapes we care about:
//   • text  — pass through
//   • voice — OGG/Opus blob → Whisper transcript
//   • photo — JPEG (highest-resolution variant) → Claude vision description
//
// We always return a single string (possibly tagged) so chatReply can
// stay text-only. Captions on photos are merged into the description
// so the agent has full context.

type ResolvedMessage =
  | { ok: true; text: string }
  | { ok: false; error: string };

async function resolveUserMessage(input: {
  msg: NonNullable<TgUpdate["message"]>;
  botToken: string;
  organizationId: string;
}): Promise<ResolvedMessage> {
  const { msg, botToken, organizationId } = input;

  // Voice note → transcribe.
  if (msg.voice) {
    try {
      const filePath = await getFilePath(botToken, msg.voice.file_id);
      const { bytes, mimeType } = await downloadFile(botToken, filePath);
      const result = await transcribeVoice({
        bytes,
        mimeType: msg.voice.mime_type ?? mimeType,
      });
      if (!result.ok) return { ok: false, error: result.error };
      return { ok: true, text: `[voice note]\n${result.text}` };
    } catch (err) {
      return {
        ok: false,
        error: `Couldn't read that voice note: ${(err as Error).message}`,
      };
    }
  }

  // Photo → describe (highest-resolution variant) and merge any caption.
  if (msg.photo && msg.photo.length > 0) {
    const largest = msg.photo[msg.photo.length - 1];
    try {
      const filePath = await getFilePath(botToken, largest.file_id);
      const { bytes, mimeType } = await downloadFile(botToken, filePath);
      const result = await describeImage({
        organizationId,
        bytes,
        mimeType,
        hint: msg.caption?.trim() || undefined,
      });
      if (!result.ok) return { ok: false, error: result.error };
      const captionLine = msg.caption?.trim()
        ? `\n\nSender caption: ${msg.caption.trim()}`
        : "";
      return {
        ok: true,
        text: `[image attached]\n${result.description}${captionLine}`,
      };
    } catch (err) {
      return {
        ok: false,
        error: `Couldn't read that image: ${(err as Error).message}`,
      };
    }
  }

  // Fallback: plain text.
  if (msg.text && msg.text.trim()) {
    return { ok: true, text: msg.text.trim() };
  }

  return { ok: false, error: "Empty or unsupported message type" };
}
