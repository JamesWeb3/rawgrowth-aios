import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { tryDecryptSecret, encryptSecret } from "@/lib/crypto";
import { requireCronAuth } from "@/lib/cron/auth";
import { refreshClaudeMaxAccessToken } from "@/lib/agent/oauth";

export const runtime = "nodejs";

/**
 * GET /api/cron/claude-token
 *
 * Returns the org's currently-valid Claude Max access token so the
 * VPS-side tick script can sync it into `/home/rawclaw/.claude/.credentials.json`.
 *
 * Claude Max OAuth access tokens are short-lived and Anthropic rotates
 * them. The previous version of this route returned whatever was stored
 * verbatim, so once the token expired the CLI started exiting 1 with no
 * stderr (silent auth failure). Now: if the stored token is past (or
 * within a 10-minute buffer of) its expiry, we refresh it via the stored
 * refresh_token, write the fresh access_token + refresh_token back to the
 * connection row, and return the new one. Best-effort - if refresh fails
 * we still return the stale token so callers see *something* and the
 * error surfaces downstream.
 *
 * Self-hosted is single-tenant per VPS, so we just operate on whatever
 * connection row exists for `provider_config_key = 'claude-max'`.
 *
 * Auth: same `Bearer ${CRON_SECRET}` convention as `/api/cron/schedule-tick`.
 */

const EXPIRY_BUFFER_MS = 10 * 60_000; // refresh 10 min before expiry

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const { data, error } = await supabaseAdmin()
    .from("rgaios_connections")
    .select("id, metadata, organization_id, connected_at, updated_at")
    .eq("provider_config_key", "claude-max")
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ connected: false, token: null });
  }
  const meta = (data.metadata ?? {}) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    installed_at?: string;
  };
  let token = tryDecryptSecret(meta.access_token);
  if (!token) {
    return NextResponse.json({ connected: false, token: null });
  }

  // Decide whether the stored token is stale. We anchor expiry off the
  // last write time (updated_at) plus the OAuth expires_in. If we can't
  // compute it, refresh anyway when a refresh_token exists - cheaper
  // than handing out a dead token.
  const anchorIso = data.updated_at ?? meta.installed_at ?? data.connected_at;
  const anchorMs = anchorIso ? Date.parse(anchorIso) : NaN;
  const expiresInMs = (meta.expires_in ?? 0) * 1000;
  const expiresAtMs =
    Number.isFinite(anchorMs) && expiresInMs > 0
      ? anchorMs + expiresInMs
      : NaN;
  const isStale =
    !Number.isFinite(expiresAtMs) ||
    Date.now() >= expiresAtMs - EXPIRY_BUFFER_MS;

  let refreshed = false;
  if (isStale) {
    const refreshTok = tryDecryptSecret(meta.refresh_token);
    if (refreshTok) {
      const r = await refreshClaudeMaxAccessToken(refreshTok);
      if (r.ok && r.access_token) {
        token = r.access_token;
        refreshed = true;
        // Persist the rotated token (+ new refresh_token if Anthropic
        // rotated it) so the next tick starts from the fresh value.
        const newMeta = {
          ...meta,
          access_token: encryptSecret(r.access_token),
          refresh_token: r.refresh_token
            ? encryptSecret(r.refresh_token)
            : meta.refresh_token,
          expires_in: r.expires_in ?? meta.expires_in,
          installed_at: new Date().toISOString(),
        };
        const { error: upErr } = await supabaseAdmin()
          .from("rgaios_connections")
          .update({ metadata: newMeta, updated_at: new Date().toISOString() })
          .eq("id", data.id);
        if (upErr) {
          console.error(
            "[claude-token] refresh succeeded but write-back failed:",
            upErr.message,
          );
        }
      } else {
        console.error(
          "[claude-token] refresh failed, returning stale token:",
          r.ok ? "no access_token" : r.error,
        );
      }
    }
  }

  return NextResponse.json({
    connected: true,
    token,
    refreshed,
    installed_at: meta.installed_at ?? data.connected_at,
    organization_id: data.organization_id,
  });
}
