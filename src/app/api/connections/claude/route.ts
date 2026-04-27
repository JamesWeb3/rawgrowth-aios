import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { upsertConnection, getConnection } from "@/lib/connections/queries";
import { encryptSecret, tryDecryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";

const PROVIDER_KEY = "claude-max";
const TOKEN_PREFIX = "sk-ant-oat01-";

/**
 * Client-facing endpoints for the Claude Max long-lived token.
 *
 * Storage: token is AES-256-GCM encrypted at rest in
 *   `rgaios_connections.metadata.access_token`
 * The dashboard never reads the plaintext except via an explicit
 * `?reveal=1` query (session-authed). The VPS-side tick reads it via
 * `/api/cron/claude-token` (CRON_SECRET-authed) once a minute and writes
 * to `/home/rawclaw/.claude/.credentials.json` if the value differs.
 */

export async function GET(req: NextRequest) {
  try {
    const organizationId = await currentOrganizationId();
    const conn = await getConnection(organizationId, PROVIDER_KEY);
    if (!conn) {
      return NextResponse.json({ connected: false });
    }
    const meta = (conn.metadata ?? {}) as {
      access_token?: string;
      installed_at?: string;
    };
    const plaintext = tryDecryptSecret(meta.access_token);
    const wantReveal = req.nextUrl.searchParams.get("reveal") === "1";

    return NextResponse.json({
      connected: true,
      installed_at: meta.installed_at ?? conn.connected_at,
      token_preview: plaintext
        ? `${plaintext.slice(0, TOKEN_PREFIX.length + 6)}…${plaintext.slice(-6)}`
        : null,
      token: wantReveal ? plaintext : undefined,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { token } = (await req.json()) as { token?: string };
    if (!token || typeof token !== "string") {
      return NextResponse.json(
        { error: "token is required" },
        { status: 400 },
      );
    }
    const trimmed = token.trim();
    if (!trimmed.startsWith(TOKEN_PREFIX)) {
      return NextResponse.json(
        {
          error: `Token must start with "${TOKEN_PREFIX}". Run \`claude setup-token\` on your laptop to generate one.`,
        },
        { status: 400 },
      );
    }
    if (trimmed.length < 60) {
      return NextResponse.json(
        { error: "Token looks too short  -  did the paste cut off?" },
        { status: 400 },
      );
    }

    const organizationId = await currentOrganizationId();
    const installedAt = new Date().toISOString();
    const encrypted = encryptSecret(trimmed);

    const conn = await upsertConnection({
      organizationId,
      providerConfigKey: PROVIDER_KEY,
      nangoConnectionId: `claude-max:${organizationId}`,
      displayName: "Claude Max",
      metadata: {
        access_token: encrypted,
        installed_at: installedAt,
      },
    });

    await supabaseAdmin()
      .from("rgaios_audit_log")
      .insert({
        organization_id: organizationId,
        kind: "connection_connected",
        actor_type: "user",
        actor_id: "session",
        detail: { provider: "claude-max" },
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

export async function DELETE() {
  try {
    const organizationId = await currentOrganizationId();
    const { error } = await supabaseAdmin()
      .from("rgaios_connections")
      .delete()
      .eq("organization_id", organizationId)
      .eq("provider_config_key", PROVIDER_KEY);
    if (error) throw new Error(error.message);

    await supabaseAdmin()
      .from("rgaios_audit_log")
      .insert({
        organization_id: organizationId,
        kind: "connection_disconnected",
        actor_type: "user",
        actor_id: "session",
        detail: { provider: "claude-max" },
      });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
