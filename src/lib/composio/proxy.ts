import { supabaseAdmin } from "@/lib/supabase/server";
import { getConnection } from "@/lib/connections/queries";
import { tryDecryptSecret } from "@/lib/crypto";
import { CONNECTOR_CATALOG } from "@/lib/connections/catalog";
import type { Database } from "@/lib/supabase/types";

/**
 * Atlas (and any LLM-driven caller) often passes Composio's canonical
 * toolkit slug ("googlecalendar", "googledrive", "x", "facebook") instead
 * of our catalog key ("google-calendar", "google-drive", "twitter",
 * "meta"). DB rows store the catalog key in `provider_config_key`, so
 * normalize before lookup. Returns the input unchanged if no override
 * matches (already a catalog key, or a custom slug).
 */
function normalizeComposioAppKey(input: string): string {
  if (CONNECTOR_CATALOG.some((c) => c.key === input)) return input;
  const reverse = CONNECTOR_CATALOG.find(
    (c) => c.composioAppName === input,
  );
  return reverse?.key ?? input;
}

/**
 * Composio proxy wrapper. Mirrors src/lib/mcp/proxy.ts (which fronts
 * Nango), but resolves connections via Composio's API instead.
 *
 * Composio swap gap #1: agents that want to call a Composio-backed app
 * (e.g. send a Slack message via the linkedin app) need an outbound
 * proxy that takes (orgId, appKey, action) and forwards to Composio's
 * `executeAction` endpoint with the right user_id + connected_account_id.
 *
 * Resolves the local rgaios_connections row (provider_config_key =
 * "composio:<appKey>"), pulls the stored connected_account_id, then
 * invokes `POST /api/v3/tools/execute/{slug}` against Composio. API key
 * lives in COMPOSIO_API_KEY env.
 *
 * v3 migration (2026-05-10): Composio deprecated the v1 connectedAccounts
 * + actions endpoints. New shape:
 *   - Connect: POST /api/v3/auth_configs (one-time per toolkit) +
 *              POST /api/v3/connected_accounts/link (per user grant).
 *   - Execute: POST /api/v3/tools/execute/{slug}
 *              body { user_id, arguments, connected_account_id? }
 *   - Discovery: GET  /api/v3/tools?toolkit_slug=<slug>
 *   - Revoke: DELETE  /api/v3/connected_accounts/{id}
 * `entityId` in v1 is now `user_id` in v3. `connectedAccountId` is now
 * `connected_account_id`. `input` is now `arguments`. Auth_configs are
 * required - we cache one per (org, toolkit) in a synthetic row
 * keyed `composio-auth-config:<toolkit>` so the link path doesn't
 * recreate one on every connect.
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

/**
 * Cap error-body reads at 64 KB. Composio occasionally returns
 * multi-MB HTML error pages (CDN interstitials, runaway debug
 * payloads); a naive `await res.text()` would buffer the whole
 * thing into memory before we slice it. Stream via getReader() and
 * stop accumulating once we cross the cap.
 */
const MAX_ERROR_BYTES = 65536;

async function readCappedErrorBody(res: Response): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared && declared <= MAX_ERROR_BYTES) {
    try {
      return await res.text();
    } catch {
      return "";
    }
  }
  const body = res.body;
  if (!body) {
    try {
      const t = await res.text();
      return t.length > MAX_ERROR_BYTES ? t.slice(0, MAX_ERROR_BYTES) : t;
    } catch {
      return "";
    }
  }
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let out = "";
  let bytes = 0;
  try {
    while (bytes < MAX_ERROR_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      out += decoder.decode(value, { stream: true });
      if (bytes >= MAX_ERROR_BYTES) break;
    }
    out += decoder.decode();
  } catch {
    // Network blip mid-error - return whatever we got.
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Reader may already be closed; ignore.
    }
  }
  return out.length > MAX_ERROR_BYTES ? out.slice(0, MAX_ERROR_BYTES) : out;
}

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
  // v3 tools/execute. URL slug is the action enum. Body uses snake_case
  // and renames: connectedAccountId->connected_account_id, entityId->
  // user_id, input->arguments. user_id is REQUIRED even when
  // connected_account_id is supplied (Composio errors otherwise).
  const res = await fetch(
    `https://backend.composio.dev/api/v3/tools/execute/${encodeURIComponent(opts.action)}`,
    {
      method: "POST",
      headers: {
        "x-api-key": composioKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        connected_account_id: conn.nango_connection_id,
        // user_id MUST mirror exactly what /api/connections/composio
        // POST wrote on grant, otherwise Composio rejects with
        // ActionExecute_ConnectedAccountEntityIdMismatch. Read it from
        // the row itself (conn.user_id) so post-OAuth tool calls match
        // the entityId the connected_account was created with - even
        // when the caller has no session (MCP HTTP bearer path) and
        // the per-call userId arg is null. Fall back to caller's
        // userId, then organizationId, only when the row was inserted
        // before migration 0063 added user_id (legacy org-wide rows).
        user_id:
          (conn as { user_id?: string | null }).user_id ??
          userId ??
          organizationId,
        arguments: opts.input,
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok) {
    const text = await readCappedErrorBody(res);
    throw new Error(
      `composio ${opts.action} ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  return (await res.json()) as T;
}

/**
 * v3 requires an auth_config_id before any connected_accounts/link
 * call. We cache one per (org, toolkit_slug) in a synthetic row keyed
 * `composio-auth-config:<toolkit>` so the connect handler doesn't
 * recreate one every time a user clicks an integration. The row's
 * `nango_connection_id` column stores the auth_config_id (we reuse
 * that column name for v3 too - rename would churn migrations + tests
 * for no behavioural gain). Composio-managed auth means we don't need
 * client_id/secret per tenant; one auth_config per app shared across
 * users is the documented v3 pattern.
 *
 * Returns null when Composio rejects the create call (e.g. unknown
 * toolkit slug). Caller decides whether to fall back to the "interest
 * recorded" path.
 */
export async function resolveOrCreateAuthConfig(
  organizationId: string,
  toolkitSlug: string,
  composioKey: string,
): Promise<string | null> {
  const cacheKey = `composio-auth-config:${toolkitSlug}`;
  const db = supabaseAdmin();

  // 1. Look up cached auth_config_id for this (org, toolkit).
  try {
    const { data } = await db
      .from("rgaios_connections")
      .select("nango_connection_id")
      .eq("organization_id", organizationId)
      .eq("provider_config_key", cacheKey)
      .eq("status", "connected")
      .maybeSingle();
    const cached = (data as { nango_connection_id?: string } | null)
      ?.nango_connection_id;
    if (cached && cached.startsWith("ac_")) return cached;
  } catch {
    // Table missing / RLS surprise - fall through to create.
  }

  // 2. Ask Composio to create a composio-managed auth_config for this
  //    toolkit. Idempotent enough: if the API returns an existing one
  //    Composio is happy to hand us the same id back.
  let authConfigId: string;
  try {
    const r = await fetch(
      "https://backend.composio.dev/api/v3/auth_configs",
      {
        method: "POST",
        headers: {
          "x-api-key": composioKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          toolkit: { slug: toolkitSlug },
          auth_config: {
            type: "use_composio_managed_auth",
            name: toolkitSlug,
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!r.ok) {
      const errText = await readCappedErrorBody(r);
      console.warn(
        `[composio] auth_config create failed for ${toolkitSlug}: ${r.status} ${errText.slice(0, 200)}`,
      );
      return null;
    }
    const json = (await r.json()) as {
      auth_config?: { id?: string };
      id?: string;
    };
    authConfigId = json.auth_config?.id ?? json.id ?? "";
    if (!authConfigId.startsWith("ac_")) {
      console.warn(
        `[composio] auth_config create returned no id for ${toolkitSlug}`,
      );
      return null;
    }
  } catch (err) {
    console.warn(
      `[composio] auth_config create threw for ${toolkitSlug}: ${(err as Error).message}`,
    );
    return null;
  }

  // 3. Cache it. Failure to insert isn't fatal - we already have the
  //    id and can return it; next call will just re-create. Use upsert
  //    to win against concurrent connect clicks (two users clicking
  //    Slack at the same moment shouldn't error on the unique
  //    constraint).
  try {
    await db
      .from("rgaios_connections")
      .upsert(
        {
          organization_id: organizationId,
          user_id: null,
          provider_config_key: cacheKey,
          nango_connection_id: authConfigId,
          display_name: `Composio auth_config (${toolkitSlug})`,
          status: "connected",
          metadata: {
            composio_toolkit: toolkitSlug,
            cached_at: new Date().toISOString(),
          },
        } as never,
        {
          onConflict:
            "organization_id,coalesce(user_id::text, ''),provider_config_key,coalesce(agent_id::text, '')",
        },
      );
  } catch (err) {
    console.warn(
      `[composio] auth_config cache write failed for ${toolkitSlug}: ${(err as Error).message}`,
    );
  }
  return authConfigId;
}

/**
 * Resolve which Composio API key to use for this org. Priority:
 *   1. Per-org key stored via /api/connections/api-keys (provider="composio")
 *      → encrypted in rgaios_connections.metadata.api_key, decrypted here.
 *   2. VPS-wide COMPOSIO_API_KEY env var (legacy fleet default).
 *
 * Returning the per-org key first lets each tenant pay for their own
 * Composio action quota without rotating an env var across the fleet.
 * Returns null when neither is set so the caller can throw a precise
 * "not configured" error.
 *
 * Exported for the unit test that asserts the precedence rule.
 */
export async function resolveComposioApiKey(
  organizationId: string,
): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin()
      .from("rgaios_connections")
      .select("metadata")
      .eq("organization_id", organizationId)
      .eq("provider_config_key", "composio-key")
      .eq("status", "connected")
      .maybeSingle();
    const enc = (data as { metadata?: { api_key?: string } } | null)?.metadata
      ?.api_key;
    const plain = tryDecryptSecret(enc);
    if (plain && plain.length >= 8) return plain;
  } catch {
    // Table missing / RLS surprise / decrypt fail. Fall through to env.
  }
  return process.env.COMPOSIO_API_KEY ?? null;
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
  const composioKey = await resolveComposioApiKey(organizationId);
  if (!composioKey) {
    throw new Error(
      "Composio API key missing - set per-org key in Connections → Workspace API keys, or set COMPOSIO_API_KEY env on the VPS",
    );
  }
  const pck = `composio:${normalizeComposioAppKey(opts.appKey)}`;
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
  //
  // Pass 1 attempts only rows not currently on cooldown (the "fresh"
  // tokens). Pass 2 is the fallback for the rows pass 1 skipped - the
  // ones that were already cold when the call started. It must NOT
  // re-run rows pass 1 already attempted-and-failed: that just doubles
  // the wasted calls + latency on a fully-broken pool. We track every
  // connId we actually attempted in pass 1 and have pass 2 exclude
  // them, so when pass 1 already covered the whole pool pass 2 is a
  // no-op and we fail fast on the real upstream error below.
  const attempted = new Set<string>();
  const passes: Array<(connId: string) => boolean> = [
    (id) => !isOnCooldown(id),
    (id) => !attempted.has(id),
  ];

  let lastErr: unknown = null;
  for (const filter of passes) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!filter(row.nango_connection_id)) continue;
      attempted.add(row.nango_connection_id);
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
