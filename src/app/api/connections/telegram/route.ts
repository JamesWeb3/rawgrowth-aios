import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { upsertConnection } from "@/lib/connections/queries";
import { getMe, setWebhook } from "@/lib/telegram/client";
import { encryptSecret } from "@/lib/crypto";

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
        // Encrypted at rest with AES-256-GCM (key derived from JWT_SECRET).
        // Decrypt with `tryDecryptSecret` from @/lib/crypto when reading.
        bot_token: encryptSecret(token),
        webhook_secret: webhookSecret,
      },
    });

    // Point Telegram at our webhook. Prefer NEXTAUTH_URL (runtime env) since
    // NEXT_PUBLIC_* vars get baked at build time and may be stale. Fall back
    // to the incoming request's origin only as a last resort — behind Caddy
    // that ends up as http://app:3000 which Telegram rejects (port must be
    // 80/88/443/8443).
    const origin = (
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.NEXTAUTH_URL ??
      new URL(req.url).origin
    ).replace(/\/$/, "");
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
