import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  sendChatAction,
  sendMessage,
  type TgUpdate,
} from "@/lib/telegram/client";
import { dispatchRun } from "@/lib/runs/dispatch";
import { isHosted } from "@/lib/deploy-mode";
import { tryDecryptSecret } from "@/lib/crypto";
import { chatReply } from "@/lib/agent/chat";

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
 * Execution of the routine itself (invoking Claude Agent SDK) comes in Phase 8 —
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
  if (!msg || !msg.text) {
    return NextResponse.json({ ok: true, skipped: "non-message update" });
  }

  const text = msg.text.trim();

  // Log EVERY inbound message into the Telegram inbox so the client's
  // Claude Code can read them via the telegram_inbox_read MCP tool.
  // Slash commands also get logged (marked responded_at when the routine
  // fires so they don't clutter the inbox).
  await db.from("rgaios_telegram_messages").insert({
    organization_id: organizationId,
    connection_id: conn.id,
    chat_id: msg.chat.id,
    sender_user_id: msg.from?.id ?? null,
    sender_username: msg.from?.username ?? null,
    sender_first_name: msg.from?.first_name ?? null,
    message_id: msg.message_id,
    text,
  });

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
      // Show "typing…" the moment we start. Auto-clears in 5s or when
      // the next message lands — whichever happens first.
      sendChatAction(token, msg.chat.id, "typing").catch(() => {});

      // Resolve the org's public-facing URL for MCP wiring.
      const publicAppUrl =
        process.env.NEXT_PUBLIC_APP_URL ??
        process.env.NEXTAUTH_URL ??
        new URL(req.url).origin;

      // Look up org name (cosmetic, used in system prompt).
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
        // Fallback: if the dashboard doesn't yet have a Claude Max token
        // (e.g. legacy clients still using a manually-written .credentials.json
        // or `claude auth login`), keep the slow path alive — ping the drain
        // daemon so the local `claude` CLI handles the reply. Better to be
        // slow than silent.
        const drainUrl = process.env.RAWCLAW_DRAIN_URL;
        if (drainUrl) {
          fetch(drainUrl, {
            method: "POST",
            signal: AbortSignal.timeout(500),
          }).catch(() => {});
          return;
        }
        await sendMessage(
          token,
          msg.chat.id,
          `⚠️ ${result.error}`,
        ).catch(() => {});
        return;
      }

      try {
        await sendMessage(token, msg.chat.id, result.reply);
      } catch {
        /* swallow — Telegram delivery failure is logged elsewhere */
      }

      // Mark the inbound row as responded so the diagnostics panel +
      // pending-counts stay accurate. We track on the LATEST inbound
      // for this chat id since we haven't piped the row id through.
      await supabaseAdmin()
        .from("rgaios_telegram_messages")
        .update({
          responded_at: new Date().toISOString(),
          response_text: result.reply,
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
    await sendMessage(
      token,
      msg.chat.id,
      `⚠️ No routine bound to \`${commandKey}\`.`,
    );
    return NextResponse.json({ ok: true, skipped: "no matching routine" });
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
  // In self-hosted mode the executor doesn't exist, so we skip — Claude Code
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
