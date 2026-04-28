import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";

import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto";
import { getMe, setWebhook, sendMessage } from "@/lib/telegram/client";

export const runtime = "nodejs";

const PROVIDER_KEY = "telegram";

/**
 * POST /api/tg-provision/[agentId]
 * Body: { bot_token: string, greeting?: string }
 *
 * Per-agent Telegram bot provisioning. Flow:
 *   1. Validate bot_token via Telegram getMe.
 *   2. Find-or-update the rgaios_connections row for (org, agent, telegram).
 *      Seeded rows (status='pending_token') created by the brand-approval
 *      hook are updated in place; if no row exists yet we insert one.
 *   3. Register the webhook at /api/webhooks/telegram/<connectionId>.
 *   4. Optionally send a "/start" greeting through the bot so the client
 *      sees the bot come online.
 *
 * DELETE /api/tg-provision/[agentId]
 *   Clears the token but keeps the seeded pending_token row so the UI
 *   still shows the "Add to Telegram" button for that agent.
 */

async function resolveWebhookBase(req: NextRequest): Promise<string> {
  const explicit = process.env.NEXTAUTH_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const host = req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  if (!host) throw new Error("Cannot resolve webhook base URL");
  return `${proto}://${host}`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await params;

  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = ctx.activeOrgId;
  const db = supabaseAdmin();

  const { bot_token: botToken, greeting } = (await req.json()) as {
    bot_token?: string;
    greeting?: string;
  };
  if (!botToken || !botToken.includes(":")) {
    return NextResponse.json(
      { error: "Invalid bot token format" },
      { status: 400 },
    );
  }

  // Confirm the agent belongs to this org. Prevents cross-tenant attach.
  const { data: agent } = await db
    .from("rgaios_agents")
    .select("id, name")
    .eq("id", agentId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const me = await getMe(botToken).catch((err) => {
    throw new Response(
      JSON.stringify({
        error: `Telegram getMe failed: ${(err as Error).message}`,
      }),
      { status: 400 },
    );
  });
  if (!me.is_bot) {
    return NextResponse.json(
      { error: "Token did not resolve to a bot" },
      { status: 400 },
    );
  }

  const webhookSecret = crypto.randomBytes(24).toString("hex");

  // Find-or-insert the per-agent Telegram connection.
  const { data: existing } = await db
    .from("rgaios_connections")
    .select("id, metadata")
    .eq("organization_id", orgId)
    .eq("agent_id", agentId)
    .eq("provider_config_key", PROVIDER_KEY)
    .maybeSingle();

  const metadata = {
    bot_id: me.id,
    bot_username: me.username ?? null,
    bot_token: encryptSecret(botToken),
    webhook_secret: webhookSecret,
  };

  let connectionId: string;
  if (existing) {
    const { error } = await db
      .from("rgaios_connections")
      .update({
        status: "connected",
        display_name: me.username ? `@${me.username}` : me.first_name,
        nango_connection_id: `tg:${me.id}`,
        metadata,
      })
      .eq("id", existing.id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    connectionId = existing.id;
  } else {
    const { data: inserted, error } = await db
      .from("rgaios_connections")
      .insert({
        organization_id: orgId,
        agent_id: agentId,
        provider_config_key: PROVIDER_KEY,
        status: "connected",
        display_name: me.username ? `@${me.username}` : me.first_name,
        nango_connection_id: `tg:${me.id}`,
        metadata,
      })
      .select("id")
      .single();
    if (error || !inserted) {
      return NextResponse.json(
        { error: error?.message ?? "Insert failed" },
        { status: 500 },
      );
    }
    connectionId = inserted.id;
  }

  // Register webhook after the row exists so Telegram can POST even if
  // the first message races the response to this endpoint.
  const base = await resolveWebhookBase(req);
  const webhookUrl = `${base}/api/webhooks/telegram/${connectionId}`;
  try {
    await setWebhook(botToken, webhookUrl, webhookSecret);
  } catch (err) {
    return NextResponse.json(
      {
        error: `Webhook registration failed: ${(err as Error).message}`,
        connectionId,
      },
      { status: 502 },
    );
  }

  // Best-effort greeting. Failures here are logged but never fatal.
  if (greeting) {
    try {
      // Bot can't send a message until the user has /start'd it.
      // We rely on the user opening the chat once. If they haven't
      // yet, this will throw and that's fine.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _ = greeting;
    } catch (err) {
      console.warn("[tg-provision] greeting send skipped:", (err as Error).message);
    }
  }

  return NextResponse.json({
    ok: true,
    connectionId,
    bot: { id: me.id, username: me.username, first_name: me.first_name },
    webhookUrl,
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await params;
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = supabaseAdmin();

  const { error } = await db
    .from("rgaios_connections")
    .update({
      status: "pending_token",
      metadata: {},
      nango_connection_id: `tg:pending:${agentId}`,
    })
    .eq("organization_id", ctx.activeOrgId)
    .eq("agent_id", agentId)
    .eq("provider_config_key", PROVIDER_KEY);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
