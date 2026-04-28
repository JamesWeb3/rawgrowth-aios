import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { getConnection } from "@/lib/connections/queries";

export const runtime = "nodejs";

const PROVIDER_KEY = "slack";

/**
 * GET /api/connections/slack
 * Returns the overall Slack state for this org  -  whether the client
 * has pasted their Slack App credentials yet, and whether a workspace
 * has been installed on top of those credentials.
 */
export async function GET() {
  try {
    const organizationId = await currentOrganizationId();
    const conn = await getConnection(organizationId, PROVIDER_KEY);
    const meta = (conn?.metadata ?? {}) as {
      client_id?: string;
      client_secret?: string;
      signing_secret?: string;
      bot_token?: string;
      bot_user_id?: string;
      team_id?: string;
      team_name?: string;
      scope?: string;
      installed_at?: string;
    };
    const hasAppConfig = Boolean(
      meta.client_id && meta.client_secret && meta.signing_secret,
    );
    const installed = Boolean(meta.bot_token && meta.team_id);
    return NextResponse.json({
      configured: hasAppConfig,
      installed,
      client_id: meta.client_id ?? null,
      team: installed
        ? { id: meta.team_id, name: meta.team_name }
        : null,
      bot_user_id: installed ? meta.bot_user_id : null,
      scope: installed ? meta.scope : null,
      installed_at: meta.installed_at ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/connections/slack
 * Fully disconnects Slack from this org  -  removes the workspace install
 * AND the app credentials. If you only want to uninstall without
 * clearing creds, use /uninstall instead (future endpoint).
 */
export async function DELETE() {
  try {
    const organizationId = await currentOrganizationId();
    const db = supabaseAdmin();

    // Attempt to revoke the bot token with Slack (best-effort).
    const { data: existing } = await db
      .from("rgaios_connections")
      .select("metadata")
      .eq("organization_id", organizationId)
      .eq("provider_config_key", PROVIDER_KEY)
      .maybeSingle();
    const meta = (existing?.metadata ?? {}) as { bot_token?: string };
    if (meta.bot_token) {
      // import lazily to avoid unused import in happy path
      const { tryDecryptSecret } = await import("@/lib/crypto");
      const token = tryDecryptSecret(meta.bot_token);
      if (token) {
        try {
          await fetch("https://slack.com/api/auth.revoke", {
            method: "POST",
            headers: {
              "content-type": "application/x-www-form-urlencoded",
              authorization: `Bearer ${token}`,
            },
            signal: AbortSignal.timeout(5_000),
          });
        } catch {
          /* best-effort  -  proceed with local delete */
        }
      }
    }

    const { error } = await db
      .from("rgaios_connections")
      .delete()
      .eq("organization_id", organizationId)
      .eq("provider_config_key", PROVIDER_KEY);
    if (error) throw new Error(error.message);

    await db
      .from("rgaios_audit_log")
      .insert({
        organization_id: organizationId,
        kind: "connection_disconnected",
        actor_type: "user",
        actor_id: "session",
        detail: { provider: "slack" },
      });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
