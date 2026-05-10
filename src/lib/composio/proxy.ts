import { supabaseAdmin } from "@/lib/supabase/server";
import { getConnection } from "@/lib/connections/queries";
import type { Database } from "@/lib/supabase/types";

/**
 * Composio proxy wrapper. Mirrors src/lib/mcp/proxy.ts (which fronts
 * Nango), but resolves connections via Composio's API instead.
 *
 * Composio swap gap #1: agents that want to call a Composio-backed app
 * (e.g. send a Slack message via the linkedin app) need an outbound
 * proxy that takes (orgId, appKey, action) and forwards to Composio's
 * `executeAction` endpoint with the right entityId + connectionId.
 *
 * Resolves the local rgaios_connections row (provider_config_key =
 * "composio:<appKey>"), pulls the stored connectionId, then invokes
 * `POST /api/v1/actions/{action}/execute` against Composio. API key
 * lives in COMPOSIO_API_KEY env.
 *
 * PR 4 additions:
 *   - per-user pool rotation. When a member wires 2+ accounts for the
 *     same provider (work Gmail + personal Gmail), 401 / 429 on row A
 *     transparently rotates to row B with a 60s cold cooldown on the
 *     failing row. Mirrors src/lib/llm/oauth-first.ts.
 *   - listComposioTokensForUser(orgId, providerKey, userId) helper.
 */

type ConnectionRow =
  Database["public"]["Tables"]["rgaios_connections"]["Row"];

type ComposioProxyOpts = {
  /** App key as it appears in src/lib/connections/catalog.ts (e.g. "linkedin", "gmail"). */
  appKey: string;
  /** Composio action slug, e.g. "GMAIL_SEND_EMAIL". Composio's catalog. */
  action: string;
  /** Action input schema  -  passed verbatim to Composio. */
  input: Record<string, unknown>;
};

/**
 * In-process cooldown for connections we just saw 401 / 429 on.
 * Composio mirrors upstream provider buckets, so a freshly-throttled
 * Gmail token typically clears within 30-90s. 60s keeps the rotation
 * from re-hitting a known-cold connection while a sibling connection
 * is fresh. Keyed on nango_connection_id, cleared on process restart.
 */
const CONNECTION_COOLDOWN: Map<string, number> = new Map();
const COOLDOWN_MS = 60_000;

function isOnCooldown(connId: string): boolean {
  const until = CONNECTION_COOLDOWN.get(connId);
  if (!until) return false;
  if (Date.now() >= until) {
    CONNECTION_COOLDOWN.delete(connId);
    return false;
  }
  return true;
}

function markCold(connId: string): void {
  CONNECTION_COOLDOWN.set(connId, Date.now() + COOLDOWN_MS);
}

function isRateLimit(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /\b429\b/.test(msg) ||
    /rate_limit/i.test(msg) ||
    /Too Many Requests/i.test(msg)
  );
}

function isAuthFail(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /\b401\b/.test(msg) ||
    /\b403\b/.test(msg) ||
    /authentication_error/i.test(msg) ||
    /invalid.*credentials/i.test(msg) ||
    /invalid.*token/i.test(msg)
  );
}

/**
 * List every connected Composio row for a given (org, provider, user).
 * Caller's per-user rows first, then org-wide fallback rows. Used by
 * the pool rotation in composioCall when the same user has wired more
 * than one account for the same provider (e.g. work + personal Gmail).
 *
 * Order: caller's rows sorted by id (deterministic), then null-user
 * rows (legacy org-wide fallback). Cold rows are still returned; the
 * caller filters via isOnCooldown on the first pass.
 */
export async function listComposioTokensForUser(
  organizationId: string,
  providerConfigKey: string,
  userId?: string | null,
): Promise<ConnectionRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("rgaios_connections")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("provider_config_key", providerConfigKey)
    .eq("status", "connected");
  if (error || !data) return [];

  const rows = data as ConnectionRow[];
  // Per-user rows first (caller's bucket). Then null-user (org-wide
  // legacy). Stable id-sort inside each group so rotation order is
  // deterministic across requests. Cast to access user_id - Supabase
  // generated types are stale relative to migration 0063 (column
  // exists in DB, types haven't been regenerated yet).
  return [...rows].sort((a, b) => {
    const au = (a as unknown as { user_id: string | null }).user_id;
    const bu = (b as unknown as { user_id: string | null }).user_id;
    const aOwn = userId && au === userId ? 0 : au === null ? 2 : 1;
    const bOwn = userId && bu === userId ? 0 : bu === null ? 2 : 1;
    if (aOwn !== bOwn) return aOwn - bOwn;
    return a.id.localeCompare(b.id);
  });
}

async function executeOnce<T>(
  conn: ConnectionRow,
  opts: ComposioProxyOpts,
  composioKey: string,
  organizationId: string,
  userId: string | null,
): Promise<T> {
  const res = await fetch(
    `https://backend.composio.dev/api/v1/actions/${encodeURIComponent(opts.action)}/execute`,
    {
      method: "POST",
      headers: {
        "x-api-key": composioKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        connectedAccountId: conn.nango_connection_id,
        // entityId mirrors what /api/connections/composio POST wrote
        // on grant - per-user when available, org-wide as fallback.
        // Composio matches the connection by entityId on its side too,
        // so a mismatch here returns "no connected account" even when
        // our local row exists.
        entityId: userId ?? organizationId,
        input: opts.input,
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `composio ${opts.action} ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  return (await res.json()) as T;
}

export async function composioCall<T = unknown>(
  organizationId: string,
  opts: ComposioProxyOpts,
  /**
   * Caller's user_id (migration 0063). When set, the rotation prefers
   * the per-user OAuth row(s) before falling back to the legacy
   * org-wide row. Mirrors chatCompleteOAuthFirst's userId thread so
   * a member's tool calls always hit their own bucket first instead
   * of borrowing whoever connected the org-wide credential. Null
   * (cron, drain, MCP HTTP bearer path with no session) keeps the
   * org-wide row as the only target.
   */
  userId?: string | null,
): Promise<T> {
  const composioKey = process.env.COMPOSIO_API_KEY;
  if (!composioKey) {
    throw new Error(
      "COMPOSIO_API_KEY missing - composio integration not configured",
    );
  }
  const pck = `composio:${opts.appKey}`;
  const callerUserId = userId ?? null;

  const rows = await listComposioTokensForUser(
    organizationId,
    pck,
    callerUserId,
  );

  // Single-row fast path keeps behaviour identical to the pre-PR-4
  // implementation when there's no rotation choice to make. Falls back
  // to getConnection() so error messages stay consistent with the
  // "isn't connected" / "status=..." surface tests rely on.
  if (rows.length <= 1) {
    const conn =
      rows[0] ?? (await getConnection(organizationId, pck, callerUserId));
    if (!conn) {
      throw new Error(
        `${opts.appKey} isn't connected via Composio for this org`,
      );
    }
    if (conn.status !== "connected") {
      throw new Error(
        `${opts.appKey} is in status='${conn.status}' - finish OAuth before calling`,
      );
    }
    return executeOnce<T>(conn, opts, composioKey, organizationId, callerUserId);
  }

  // Multi-row pool. Two-pass: fresh tokens first, then warm-up cold
  // ones if every fresh row failed. Avoids burning cycles on a row we
  // just saw 429 on while a sibling row is idle.
  const passes: Array<(connId: string) => boolean> = [
    (id) => !isOnCooldown(id),
    () => true,
  ];

  let lastErr: unknown = null;
  for (const filter of passes) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!filter(row.nango_connection_id)) continue;
      try {
        return await executeOnce<T>(
          row,
          opts,
          composioKey,
          organizationId,
          callerUserId,
        );
      } catch (err) {
        lastErr = err;
        // Rotate on 429 (rate limit) and 401 / 403 (revoked / expired
        // upstream token). Anything else (network, abort, validation,
        // 400 from a malformed input) bubbles immediately - retrying a
        // sibling row wouldn't change the outcome.
        if (!isRateLimit(err) && !isAuthFail(err)) throw err;
        markCold(row.nango_connection_id);
        console.warn(
          `[composio-pool] ${pck} row ${i + 1}/${rows.length} failed (${
            isRateLimit(err) ? "429" : "401/403"
          }), marked cold ${COOLDOWN_MS / 1000}s, trying next`,
        );
      }
    }
  }

  // Pool exhausted on both passes. Surface the last upstream error so
  // the caller sees a real Composio status code instead of a generic
  // "not connected" string.
  if (lastErr) throw lastErr;
  throw new Error(
    `${opts.appKey} pool exhausted (no rows for org=${organizationId} user=${callerUserId ?? "null"})`,
  );
}
