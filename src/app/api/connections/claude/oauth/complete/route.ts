import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { upsertConnection } from "@/lib/connections/queries";
import { encryptSecret } from "@/lib/crypto";
import { exchangeCodeForToken, unpackState } from "@/lib/agent/oauth";

export const runtime = "nodejs";

const PROVIDER_KEY = "claude-max";

/**
 * POST /api/connections/claude/oauth/complete
 * Body: { code: string, state: string }
 *
 * The code came from Anthropic's hosted callback page (user copy-pasted).
 * The state holds the encrypted PKCE verifier we issued in /start.
 *
 * Critical: this is the call that has to happen from the VPS for the
 * resulting access_token to be usable from the VPS. Anthropic binds the
 * token to the IP that does the exchange.
 */
export async function POST(req: NextRequest) {
  try {
    const { code, state } = (await req.json()) as {
      code?: string;
      state?: string;
    };
    if (!code || typeof code !== "string") {
      return NextResponse.json(
        { error: "code is required" },
        { status: 400 },
      );
    }
    if (!state || typeof state !== "string") {
      return NextResponse.json(
        { error: "state is required" },
        { status: 400 },
      );
    }

    const unpacked = unpackState(state);
    if (!unpacked) {
      return NextResponse.json(
        {
          error:
            "invalid or expired state — start the connection flow over.",
        },
        { status: 400 },
      );
    }

    // Tenant safety: the org we issued the state for must match the
    // session user's org. Catches tab confusion / replay across orgs.
    const sessionOrgId = await currentOrganizationId();
    if (sessionOrgId !== unpacked.organizationId) {
      return NextResponse.json(
        { error: "state belongs to a different organization" },
        { status: 403 },
      );
    }

    const exchange = await exchangeCodeForToken({
      code,
      verifier: unpacked.verifier,
      state, // Anthropic's token endpoint requires the same state we sent on /authorize
    });
    if (!exchange.ok) {
      return NextResponse.json(
        {
          error:
            `Anthropic rejected the code (status ${exchange.status ?? "unknown"}): ${exchange.error}`,
        },
        { status: 400 },
      );
    }

    const installedAt = new Date().toISOString();
    const conn = await upsertConnection({
      organizationId: sessionOrgId,
      providerConfigKey: PROVIDER_KEY,
      nangoConnectionId: `claude-max:${sessionOrgId}`,
      displayName: "Claude Max",
      metadata: {
        access_token: encryptSecret(exchange.access_token),
        refresh_token: exchange.refresh_token
          ? encryptSecret(exchange.refresh_token)
          : "",
        expires_in: exchange.expires_in ?? null,
        installed_at: installedAt,
        // Marker so we can tell server-OAuth tokens apart from
        // hand-pasted setup-token rows in the future.
        source: "server_oauth",
      },
    });

    await supabaseAdmin()
      .from("rgaios_audit_log")
      .insert({
        organization_id: sessionOrgId,
        kind: "connection_connected",
        actor_type: "user",
        actor_id: "session",
        detail: { provider: "claude-max", source: "server_oauth" },
      });

    return NextResponse.json({
      ok: true,
      installed_at: installedAt,
      connection_id: conn.id,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
