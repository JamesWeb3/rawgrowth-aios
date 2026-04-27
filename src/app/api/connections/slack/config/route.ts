import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { getConnection, upsertConnection } from "@/lib/connections/queries";
import { encryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";

const PROVIDER_KEY = "slack";

/**
 * POST /api/connections/slack/config
 * Body: { client_id, client_secret, signing_secret }
 *
 * Save the Slack App credentials the client created at api.slack.com/apps.
 * Secrets encrypted at rest with AES-256-GCM (JWT_SECRET-derived key).
 *
 * After this, the UI presents the "Install to your Slack workspace"
 * button which kicks off the OAuth flow using these creds.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      client_id?: string;
      client_secret?: string;
      signing_secret?: string;
    };
    const clientId = String(body.client_id ?? "").trim();
    const clientSecret = String(body.client_secret ?? "").trim();
    const signingSecret = String(body.signing_secret ?? "").trim();

    if (!clientId || !clientSecret || !signingSecret) {
      return NextResponse.json(
        {
          error:
            "client_id, client_secret and signing_secret are all required",
        },
        { status: 400 },
      );
    }
    // Slack client IDs look like "1234567890.1234567890123".
    if (!/^[\d.]+$/.test(clientId)) {
      return NextResponse.json(
        { error: "client_id doesn't look like a Slack App client id" },
        { status: 400 },
      );
    }

    const organizationId = await currentOrganizationId();

    // Preserve any already-installed workspace info  -  we don't wipe the
    // bot_token just because the client re-saved their app creds.
    const existing = await getConnection(organizationId, PROVIDER_KEY);
    const existingMeta = (existing?.metadata ?? {}) as Record<string, unknown>;

    await upsertConnection({
      organizationId,
      providerConfigKey: PROVIDER_KEY,
      nangoConnectionId: `slack-app:${organizationId}`,
      displayName: null,
      metadata: {
        ...existingMeta,
        client_id: clientId,
        client_secret: encryptSecret(clientSecret),
        signing_secret: encryptSecret(signingSecret),
      },
    });

    await supabaseAdmin()
      .from("rgaios_audit_log")
      .insert({
        organization_id: organizationId,
        kind: "connection_connected",
        actor_type: "user",
        actor_id: "session",
        detail: { provider: "slack", step: "app_config_saved" },
      });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
