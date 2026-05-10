import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { tryDecryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";

/**
 * GET /api/connections/telegram/token
 *
 * Returns the raw bot token + webhook secret for the current org's telegram
 * connection. Only callable by authed session members. Each reveal is
 * audit-logged so we can trace who pulled the secret.
 */
export async function GET() {
  const organizationId = await currentOrganizationId();
  const db = supabaseAdmin();

  const { data: conn, error } = await db
    .from("rgaios_connections")
    .select("id, metadata")
    .eq("organization_id", organizationId)
    .eq("provider_config_key", "telegram")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!conn) {
    return NextResponse.json({ error: "not connected" }, { status: 404 });
  }

  const meta = (conn.metadata ?? {}) as {
    bot_token?: string;
    webhook_secret?: string;
  };

  await db.from("rgaios_audit_log").insert({
    organization_id: organizationId,
    kind: "connection_secret_revealed",
    actor_type: "user",
    actor_id: "session",
    detail: { provider: "telegram", connection_id: conn.id },
  });

  return NextResponse.json({
    token: tryDecryptSecret(meta.bot_token) ?? null,
    webhook_secret: tryDecryptSecret(meta.webhook_secret) ?? null,
  });
}
