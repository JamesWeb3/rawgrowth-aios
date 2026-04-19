import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { upsertConnection } from "@/lib/connections/queries";
import { getMe, setWebhook } from "@/lib/telegram/client";

export const runtime = "nodejs";

const PROVIDER_KEY = "telegram";

/**
 * POST /api/connections/telegram
 * Body: { token: string }
 *
 * 1. Validates the bot token via Telegram's getMe.
 * 2. Stores the connection row (token in metadata + a webhook secret).
 * 3. Registers our webhook URL with Telegram so updates POST back to us.
 */
export async function POST(req: NextRequest) {
  try {
    const { token } = (await req.json()) as { token?: string };
    if (!token || !token.includes(":")) {
      return NextResponse.json(
        { error: "Invalid bot token format" },
        { status: 400 },
      );
    }

    const me = await getMe(token);
    if (!me.is_bot) {
      return NextResponse.json(
        { error: "Token did not resolve to a bot" },
        { status: 400 },
      );
    }

    const organizationId = await currentOrganizationId();
    const webhookSecret = crypto.randomBytes(24).toString("hex");

    const conn = await upsertConnection({
      organizationId,
      providerConfigKey: PROVIDER_KEY,
      nangoConnectionId: `tg:${me.id}`,
      displayName: me.username ? `@${me.username}` : me.first_name,
      metadata: {
        bot_id: me.id,
        bot_token: token, // MVP: plaintext. Production: envelope encryption.
        webhook_secret: webhookSecret,
      },
    });

    // Point Telegram at our webhook. Works for any public origin set in
    // NEXT_PUBLIC_APP_URL; falls back to the incoming request's origin.
    const origin =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
      new URL(req.url).origin;
    const webhookUrl = `${origin}/api/webhooks/telegram/${conn.id}`;
    await setWebhook(token, webhookUrl, webhookSecret);

    await supabaseAdmin()
      .from("rgaios_audit_log")
      .insert({
        organization_id: organizationId,
        kind: "connection_connected",
        actor_type: "system",
        actor_id: "telegram",
        detail: { bot: me.username ?? me.first_name, webhookUrl },
      });

    return NextResponse.json({ ok: true, bot: me, connectionId: conn.id });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
