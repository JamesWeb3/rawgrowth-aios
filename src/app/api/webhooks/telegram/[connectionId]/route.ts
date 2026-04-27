import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  editMessageText,
  sendChatAction,
  sendMessage,
  type TgUpdate,
} from "@/lib/telegram/client";
import { dispatchRun } from "@/lib/runs/dispatch";
import { isHosted } from "@/lib/deploy-mode";
import { tryDecryptSecret } from "@/lib/crypto";
import { chatReply, CHAT_HANDOFF_SENTINEL_PREFIX } from "@/lib/agent/chat";
import { transcribeVoice } from "@/lib/voice/transcribe";

/**
 * Rotating animation frames for the thinking bubble. We cycle through
 * these every ~2.5s so the user gets visible "I'm alive" feedback while
 * the drain daemon works. Keep each phrase short  -  Telegram bubbles
 * with changing lengths look jittery if they reflow the line a lot.
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

/**
 * Cycle an animated "thinking…" status through the placeholder bubble
 * while drain is grinding. Exits cleanly when:
 *   • placeholder_message_id on the inbox row is cleared (drain
 *     edited the bubble itself with the final reply), or
 *   • responded_at fills in (backstop), or
 *   • maxMs elapsed (runaway guard).
 */
function startProgressUpdates(opts: {
  token: string;
  chatId: number;
  messageId: number;
  inboxRowId: string;
  organizationId: string;
  acknowledgement: string;
  intervalMs?: number;
  maxMs?: number;
}) {
  const intervalMs = opts.intervalMs ?? 2_500;
  const maxMs = opts.maxMs ?? 5 * 60_000;
  const startedAt = Date.now();
  let frame = 0;

  const tick = async () => {
    // Check the DB row for ownership + responded state.
    const { data } = await supabaseAdmin()
      .from("rgaios_telegram_messages")
      .select("responded_at, placeholder_message_id")
      .eq("id", opts.inboxRowId)
      .maybeSingle();
    const row = data as
      | { responded_at?: string | null; placeholder_message_id?: number | null }
      | null;

    // Drain has already edited the placeholder with the final reply  - 
    // our job is done, don't touch the bubble.
    if (row && !row.placeholder_message_id) return;
    // Belt-and-braces: if responded_at is set we also stop (shouldn't
    // happen unless something went wrong with placeholder_message_id).
    if (row && row.responded_at) return;

    if (Date.now() - startedAt > maxMs) {
      editMessageText(
        opts.token,
        opts.chatId,
        opts.messageId,
        `⌛ ${opts.acknowledgement}\nStill working  -  I'll keep going in the background.`,
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

/**
 * POST /api/webhooks/telegram/[connectionId]
 *
 * Telegram Bot API posts updates here. We:
 *   1. Load the connection by id and verify the X-Telegram-Bot-Api-Secret-Token.
 *   2. Parse the message. If it's a bot command matching a routine trigger,
 *      fire the routine (insert a run row, bump last_run_at).
 *   3. Reply in-chat so the user gets feedback.
 *
 * Execution of the routine itself (invoking Claude Agent SDK) comes in Phase 8  - 
 * for now we confirm receipt and mark the run as "pending".
 */

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await params;
  const db = supabaseAdmin();

  // 1. Look up the connection this webhook is scoped to.
  const { data: conn, error: connErr } = await db
    .from("rgaios_connections")
    .select("*")
    .eq("id", connectionId)
    .eq("provider_config_key", "telegram")
    .maybeSingle();
  if (connErr || !conn) {
    return NextResponse.json({ error: "unknown connection" }, { status: 404 });
  }

  // 2. Verify Telegram's signed secret header.
  const meta = (conn.metadata ?? {}) as {
    bot_token?: string;
    webhook_secret?: string;
  };
  const headerSecret = req.headers.get("x-telegram-bot-api-secret-token");
  if (!meta.webhook_secret || headerSecret !== meta.webhook_secret) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  const token = tryDecryptSecret(meta.bot_token);
  if (!token) {
    return NextResponse.json({ error: "bot token missing" }, { status: 500 });
  }

  const organizationId = conn.organization_id;

  // 3. Parse the update.
  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const msg = update.message;
  if (!msg || (!msg.text && !msg.voice)) {
    return NextResponse.json({ ok: true, skipped: "non-message update" });
  }

  // Voice notes: transcribe inline before the drain pipeline sees the
  // message so downstream (inbox row, /rawgrowth-chat slash, MCP
  // telegram_reply) stays a text-only code path.
  let text = msg.text?.trim() ?? "";
  if (!text && msg.voice) {
    try {
      const result = await transcribeVoice(token, msg.voice.file_id);
      text = result.text;
      console.debug(
        `[telegram] org=${organizationId} voice→text via ${result.source} in ${result.durationMs}ms`,
      );
    } catch (err) {
      console.error("[telegram] voice transcribe failed:", (err as Error).message);
      text = "[voice transcription failed  -  please resend as text]";
    }
  }
  if (!text) {
    return NextResponse.json({ ok: true, skipped: "empty message" });
  }

  // Log EVERY inbound message into the Telegram inbox so the client's
  // Claude Code can read them via the telegram_inbox_read MCP tool.
  // Slash commands also get logged (marked responded_at when the routine
  // fires so they don't clutter the inbox).
  const { data: inboxRow } = await db
    .from("rgaios_telegram_messages")
    .insert({
      organization_id: organizationId,
      connection_id: conn.id,
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

  const command = text.split(/\s+/)[0] ?? "";
  if (!command.startsWith("/")) {
    // Free-text message → instant chat path.
    // Hot path: direct Anthropic /v1/messages call from inside the
    // Next.js process, with this org's MCP server wired in. Skips the
    // 5-10s claude CLI cold-spawn and gives a real chatbot feel.
    //
    // We respond 200 to Telegram immediately and do the LLM call in
    // after() so Telegram never retries on a slow upstream.
    after(async () => {
      // Header "typing…" indicator (auto-clears in 5s).
      sendChatAction(token, msg.chat.id, "typing").catch(() => {});

      // Placeholder bubble  -  an actual message the user sees appear in
      // the conversation instantly. We'll editMessageText it when the
      // real reply is ready, so the "…" morphs into the final answer.
      let placeholderId: number | null = null;
      try {
        const sent = await sendMessage(token, msg.chat.id, "💭 Thinking…");
        placeholderId = sent.message_id;
      } catch {
        placeholderId = null;
      }
      // Record the placeholder id against the inbox row so telegram_reply
      // (MCP tool) can edit this bubble in place rather than sending a
      // fresh message underneath it.
      if (placeholderId !== null && inboxRowId) {
        try {
          await supabaseAdmin()
            .from("rgaios_telegram_messages")
            .update({ placeholder_message_id: placeholderId })
            .eq("id", inboxRowId);
        } catch {
          /* non-fatal  -  ticker will still run, just can't edit in place */
        }
      }

      const publicAppUrl =
        process.env.NEXT_PUBLIC_APP_URL ??
        process.env.NEXTAUTH_URL ??
        new URL(req.url).origin;

      const { data: orgRow } = await supabaseAdmin()
        .from("rgaios_organizations")
        .select("name")
        .eq("id", organizationId)
        .maybeSingle();

      const result = await chatReply({
        organizationId,
        organizationName: orgRow?.name ?? null,
        chatId: msg.chat.id,
        userMessage: text,
        publicAppUrl: publicAppUrl.replace(/\/$/, ""),
      });

      if (!result.ok) {
        // Edit the placeholder into an error breadcrumb only if we
        // aren't falling back to the drain daemon (which will post its
        // own reply in a moment).
        const drainUrl = process.env.RAWCLAW_DRAIN_URL;
        if (drainUrl) {
          // Placeholder stays visible briefly, then the drain-path reply
          // will be sent as a NEW message. Clean up the placeholder so
          // the chat doesn't end up with a dangling "…".
          if (placeholderId !== null) {
            editMessageText(token, msg.chat.id, placeholderId, "💭 thinking…").catch(
              () => {},
            );
          }
          fetch(drainUrl, {
            method: "POST",
            signal: AbortSignal.timeout(500),
          }).catch(() => {});
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
        return;
      }

      // Tool-handoff sentinel: chatReply detected a request that needs
      // MCP tools (which it doesn't have access to). Acknowledge in the
      // placeholder, fire the drain daemon, and keep the user informed
      // with periodic progress updates while drain grinds.
      if (result.reply.startsWith(CHAT_HANDOFF_SENTINEL_PREFIX)) {
        const acknowledgement = result.reply
          .slice(CHAT_HANDOFF_SENTINEL_PREFIX.length)
          .replace(/^\s*[ - -]\s*/, "")
          .trim() || "Working on it";

        if (placeholderId !== null) {
          await editMessageText(
            token,
            msg.chat.id,
            placeholderId,
            `🔧 ${acknowledgement}`,
          ).catch(() => {});
        } else {
          await sendMessage(token, msg.chat.id, `🔧 ${acknowledgement}`).catch(
            () => {},
          );
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
              organizationId,
              acknowledgement,
            });
          }
        }
        // Don't mark responded  -  drain will do that when it finishes.
        return;
      }

      // Plain chat reply  -  swap the placeholder for the real text.
      try {
        if (placeholderId !== null) {
          await editMessageText(token, msg.chat.id, placeholderId, result.reply);
        } else {
          await sendMessage(token, msg.chat.id, result.reply);
        }
      } catch {
        /* Telegram delivery failure  -  logged elsewhere */
      }

      await supabaseAdmin()
        .from("rgaios_telegram_messages")
        .update({
          responded_at: new Date().toISOString(),
          response_text: result.reply,
          placeholder_message_id: null,
        })
        .eq("organization_id", organizationId)
        .eq("chat_id", msg.chat.id)
        .eq("message_id", msg.message_id);
    });

    return NextResponse.json({ ok: true, inboxed: true, path: "instant" });
  }

  // Strip any "@BotName" suffix Telegram may append in group chats.
  const commandKey = command.split("@")[0] ?? "";
  const argsText = text.slice(command.length).trim();

  // 4. Find a routine whose trigger matches this command, scoped to this org.
  const { data: triggers, error: tErr } = await db
    .from("rgaios_routine_triggers")
    .select("*, rgaios_routines!inner(id, organization_id, title, status)")
    .eq("organization_id", organizationId)
    .eq("kind", "telegram")
    .eq("enabled", true);
  if (tErr) {
    return NextResponse.json({ error: tErr.message }, { status: 500 });
  }

  type TriggerJoin = {
    id: string;
    routine_id: string;
    organization_id: string;
    config: Record<string, unknown>;
    rgaios_routines: {
      id: string;
      organization_id: string;
      title: string;
      status: string;
    } | null;
  };
  const match = (triggers as TriggerJoin[] | null)?.find((t) => {
    const cfg = (t.config ?? {}) as { command?: string };
    return cfg.command === commandKey;
  });

  if (!match || !match.rgaios_routines) {
    // Unbound slash command  -  fall through to the instant chat path so
    // the agent handles it naturally (e.g. /start, /help, anything the
    // user types with a slash prefix that isn't an explicit routine).
    after(async () => {
      sendChatAction(token, msg.chat.id, "typing").catch(() => {});

      let placeholderId: number | null = null;
      try {
        const sent = await sendMessage(token, msg.chat.id, "💭 Thinking…");
        placeholderId = sent.message_id;
      } catch {
        placeholderId = null;
      }
      // Record the placeholder id against the inbox row so telegram_reply
      // (MCP tool) can edit this bubble in place rather than sending a
      // fresh message underneath it.
      if (placeholderId !== null && inboxRowId) {
        try {
          await supabaseAdmin()
            .from("rgaios_telegram_messages")
            .update({ placeholder_message_id: placeholderId })
            .eq("id", inboxRowId);
        } catch {
          /* non-fatal  -  ticker will still run, just can't edit in place */
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

      const result = await chatReply({
        organizationId,
        organizationName: orgRow?.name ?? null,
        chatId: msg.chat.id,
        userMessage: text,
        publicAppUrl,
      });

      if (!result.ok) {
        const drainUrl = process.env.RAWCLAW_DRAIN_URL;
        if (drainUrl) {
          if (placeholderId !== null) {
            editMessageText(
              token,
              msg.chat.id,
              placeholderId,
              "💭 thinking…",
            ).catch(() => {});
          }
          fetch(drainUrl, {
            method: "POST",
            signal: AbortSignal.timeout(500),
          }).catch(() => {});
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
        return;
      }

      // Tool-handoff sentinel (same as free-text branch).
      if (result.reply.startsWith(CHAT_HANDOFF_SENTINEL_PREFIX)) {
        const acknowledgement = result.reply
          .slice(CHAT_HANDOFF_SENTINEL_PREFIX.length)
          .replace(/^\s*[ - -]\s*/, "")
          .trim() || "Working on it";

        if (placeholderId !== null) {
          await editMessageText(
            token,
            msg.chat.id,
            placeholderId,
            `🔧 ${acknowledgement}`,
          ).catch(() => {});
        } else {
          await sendMessage(token, msg.chat.id, `🔧 ${acknowledgement}`).catch(
            () => {},
          );
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
              organizationId,
              acknowledgement,
            });
          }
        }
        return;
      }

      try {
        if (placeholderId !== null) {
          await editMessageText(token, msg.chat.id, placeholderId, result.reply);
        } else {
          await sendMessage(token, msg.chat.id, result.reply);
        }
      } catch {
        /* telegram delivery failure logged elsewhere */
      }

      await supabaseAdmin()
        .from("rgaios_telegram_messages")
        .update({
          responded_at: new Date().toISOString(),
          response_text: result.reply,
          placeholder_message_id: null,
        })
        .eq("organization_id", organizationId)
        .eq("chat_id", msg.chat.id)
        .eq("message_id", msg.message_id);
    });
    return NextResponse.json({
      ok: true,
      inboxed: true,
      path: "instant-fallthrough",
    });
  }

  const routine = match.rgaios_routines;
  if (routine.status !== "active") {
    await sendMessage(
      token,
      msg.chat.id,
      `⏸ Routine *${routine.title}* is paused. Unpause it in Rawgrowth to enable.`,
    );
    return NextResponse.json({ ok: true, skipped: "paused" });
  }

  // 5. Fire the routine. MVP: insert a run row + bump last_run_at.
  //    Phase 8 will pick up pending runs and actually execute the agent.
  const { data: run, error: runErr } = await db
    .from("rgaios_routine_runs")
    .insert({
      organization_id: organizationId,
      routine_id: routine.id,
      trigger_id: match.id,
      source: "telegram",
      status: "pending",
      input_payload: {
        telegram: {
          chat_id: msg.chat.id,
          from: msg.from,
          command: commandKey,
          args: argsText,
          raw_text: msg.text,
        },
      },
    })
    .select("*")
    .single();
  if (runErr || !run) {
    await sendMessage(
      token,
      msg.chat.id,
      `❌ Couldn't queue the routine: ${runErr?.message ?? "unknown error"}`,
    );
    return NextResponse.json(
      { error: runErr?.message ?? "insert failed" },
      { status: 500 },
    );
  }

  await db
    .from("rgaios_routines")
    .update({ last_run_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("id", routine.id);

  await db.from("rgaios_audit_log").insert({
    organization_id: organizationId,
    kind: "routine_triggered",
    actor_type: "system",
    actor_id: "telegram",
    detail: {
      routine_id: routine.id,
      command: commandKey,
      args: argsText,
      chat_id: msg.chat.id,
    },
  });

  await sendMessage(
    token,
    msg.chat.id,
    `✅ *${routine.title}* queued.${argsText ? `\nargs: \`${argsText}\`` : ""}`,
  );

  // Route to executor in hosted, or leave pending for Claude Code in self-hosted.
  dispatchRun(run.id, run.organization_id);

  // In hosted mode, wait for completion and ping Telegram with the result.
  // In self-hosted mode the executor doesn't exist, so we skip  -  Claude Code
  // will pick the run up and the user can check the app for output.
  if (isHosted) {
    after(async () => {
      try {
        const { data: finished } = await supabaseAdmin()
          .from("rgaios_routine_runs")
          .select("status, output, error")
          .eq("id", run.id)
          .maybeSingle();
        if (finished?.status === "succeeded") {
          const out = (finished.output as { text?: string } | null)?.text ?? "";
          const preview = out.slice(0, 1800);
          await sendMessage(
            token,
            msg.chat.id,
            `🎯 *${routine.title}* finished.\n\n${preview || "(no output)"}`,
          );
        } else if (finished?.status === "failed") {
          await sendMessage(
            token,
            msg.chat.id,
            `❌ *${routine.title}* failed: ${finished.error ?? "unknown error"}`,
          );
        }
      } catch {
        /* best-effort follow-up */
      }
    });
  }

  return NextResponse.json({ ok: true, run_id: run.id });
}
