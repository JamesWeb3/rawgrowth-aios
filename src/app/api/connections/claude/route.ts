import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { getOrgContext } from "@/lib/auth/admin";
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
    // Per-user OAuth (migration 0063). Pass session userId so Sara sees
    // her own row, not the org-wide fallback that another member wired.
    const ctx = await getOrgContext();
    const conn = await getConnection(
      organizationId,
      PROVIDER_KEY,
      ctx?.userId ?? null,
    );
    if (!conn) {
      return NextResponse.json({ connected: false });
    }
    const meta = (conn.metadata ?? {}) as {
      access_token?: string;
      installed_at?: string;
    };
    const plaintext = tryDecryptSecret(meta.access_token);
    const wantReveal = req.nextUrl.searchParams.get("reveal") === "1";

    // Health probe: look at the most recent chat_reply_failed row for
    // this org. Only counts failures that landed AFTER the current
    // installed_at (so a reconnect immediately clears the stale flag
    // - the old fail is "before this token was even issued").
    let stale = false;
    let staleSince: string | null = null;
    try {
      const installedAtMs = (() => {
        const raw = meta.installed_at ?? conn.connected_at;
        const t = typeof raw === "number" ? raw : Date.parse(String(raw));
        return Number.isFinite(t) ? t : 0;
      })();
      const since = new Date(
        Math.max(installedAtMs, Date.now() - 24 * 60 * 60 * 1000),
      ).toISOString();
      const { data: lastFail } = await supabaseAdmin()
        .from("rgaios_audit_log")
        .select("ts, detail")
        .eq("organization_id", organizationId)
        .eq("kind", "chat_reply_failed")
        .gte("ts", since)
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();
      const detail = (lastFail as { ts: string; detail: { error?: string } } | null)
        ?.detail;
      if (detail?.error?.toLowerCase().includes("claude max token")) {
        stale = true;
        staleSince = (lastFail as { ts: string }).ts;
      }
    } catch {}

    return NextResponse.json({
      connected: true,
      stale,
      stale_since: staleSince,
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
    const ctx = await getOrgContext();
    const sessionUserId = ctx?.userId ?? null;
    const installedAt = new Date().toISOString();
    const encrypted = encryptSecret(trimmed);

    const conn = await upsertConnection({
      organizationId,
      providerConfigKey: PROVIDER_KEY,
      userId: sessionUserId,
      nangoConnectionId: sessionUserId
        ? `claude-max:${organizationId}:${sessionUserId}`
        : `claude-max:${organizationId}`,
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
    const ctx = await getOrgContext();
    const sessionUserId = ctx?.userId ?? null;
    const baseDelete = supabaseAdmin()
      .from("rgaios_connections")
      .delete()
      .eq("organization_id", organizationId)
      .eq("provider_config_key", PROVIDER_KEY);
    const { error } = await (sessionUserId
      ? baseDelete.eq("user_id", sessionUserId)
      : baseDelete.is("user_id", null));
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
