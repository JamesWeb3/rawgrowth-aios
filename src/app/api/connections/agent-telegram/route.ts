import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { getMe, setWebhook } from "@/lib/telegram/client";
import { encryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";

/**
 * Per-Department-Head Telegram bots.
 *
 * GET  /api/connections/agent-telegram
 *      → list every bot for this org with its assigned head agent.
 *
 * POST /api/connections/agent-telegram
 *      Body: { agent_id: string, token: string }
 *      → validate the token via getMe, register the webhook back to
 *        /api/webhooks/agent-telegram/[bot_row_id], persist encrypted
 *        token. Agent must be marked as a department head.
 *
 * One bot per agent. Sub-agents (is_department_head=false) are rejected.
 */

type BotListRow = {
  id: string;
  agent_id: string;
  bot_id: number;
  bot_username: string | null;
  bot_first_name: string | null;
  status: string;
  created_at: string;
};

export async function GET() {
  const organizationId = await currentOrganizationId();
  const { data, error } = await supabaseAdmin()
    .from("rgaios_agent_telegram_bots")
    .select(
      `id, agent_id, bot_id, bot_username, bot_first_name, status, created_at,
       rgaios_agents!inner ( id, name, title, department )`,
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ bots: data ?? [] });
}

export async function POST(req: NextRequest) {
  try {
    const { agent_id, token } = (await req.json()) as {
      agent_id?: string;
      token?: string;
    };
    if (!agent_id || typeof agent_id !== "string") {
      return NextResponse.json(
        { error: "agent_id is required" },
        { status: 400 },
      );
    }
    if (!token || !token.includes(":")) {
      return NextResponse.json(
        { error: "Invalid bot token format" },
        { status: 400 },
      );
    }

    const organizationId = await currentOrganizationId();
    const db = supabaseAdmin();

    // Agent must exist + belong to this org + be a department head.
    const { data: agent } = await db
      .from("rgaios_agents")
      .select("id, name, is_department_head, department")
      .eq("id", agent_id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!agent) {
      return NextResponse.json(
        { error: "Agent not found" },
        { status: 404 },
      );
    }
    if (!agent.is_department_head) {
      return NextResponse.json(
        {
          error:
            "Telegram bots can only be assigned to department heads. Mark this agent as a department head first.",
        },
        { status: 400 },
      );
    }

    // Validate the token resolves to a real bot.
    const me = await getMe(token);
    if (!me.is_bot) {
      return NextResponse.json(
        { error: "Token did not resolve to a bot" },
        { status: 400 },
      );
    }

    const webhookSecret = crypto.randomBytes(24).toString("hex");

    // Upsert by agent_id (unique constraint) — replacing the bot for an
    // existing head is a clean operation, not an error.
    const { data: row, error: upsertErr } = await db
      .from("rgaios_agent_telegram_bots")
      .upsert(
        {
          organization_id: organizationId,
          agent_id,
          bot_id: me.id,
          bot_username: me.username ?? null,
          bot_first_name: me.first_name,
          bot_token: encryptSecret(token),
          webhook_secret: webhookSecret,
          status: "connected",
          metadata: {},
          updated_at: new Date().toISOString(),
        },
        { onConflict: "agent_id" },
      )
      .select("id")
      .single();
    if (upsertErr || !row) {
      return NextResponse.json(
        { error: upsertErr?.message ?? "Persist failed" },
        { status: 500 },
      );
    }

    // Register the webhook with Telegram. URL = our app + per-row id, so
    // multiple bots in the same org route to the same code path with a
    // different scope.
    const origin = (
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.NEXTAUTH_URL ??
      new URL(req.url).origin
    ).replace(/\/$/, "");
    const webhookUrl = `${origin}/api/webhooks/agent-telegram/${row.id}`;
    await setWebhook(token, webhookUrl, webhookSecret);

    await db.from("rgaios_audit_log").insert({
      organization_id: organizationId,
      kind: "connection_connected",
      actor_type: "system",
      actor_id: "agent-telegram",
      detail: {
        agent_id,
        agent_name: agent.name,
        bot: me.username ?? me.first_name,
        webhookUrl,
      },
    });

    return NextResponse.json({
      ok: true,
      bot_row_id: row.id,
      bot: { id: me.id, username: me.username, first_name: me.first_name },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
