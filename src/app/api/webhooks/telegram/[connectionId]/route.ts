import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { sendMessage, type TgUpdate } from "@/lib/telegram/client";
import { executeRun } from "@/lib/runs/executor";

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
  const token = meta.bot_token;
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
  const command = text.split(/\s+/)[0] ?? "";
  if (!command.startsWith("/")) {
    return NextResponse.json({ ok: true, skipped: "not a command" });
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

  // Kick off the actual execution asynchronously — the HTTP response to
  // Telegram has already been sent. after() keeps the function alive until
  // the agent loop finishes or hits maxDuration.
  after(async () => {
    await executeRun(run.id);
    // Ping the user back once execution completes so they see the result
    // without waiting on a second command.
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

  return NextResponse.json({ ok: true, run_id: run.id });
}
