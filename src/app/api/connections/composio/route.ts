import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { getCatalogEntry, composioAppNameFor } from "@/lib/connections/catalog";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  resolveComposioApiKey,
  resolveOrCreateAuthConfig,
} from "@/lib/composio/proxy";

export const runtime = "nodejs";

/**
 * Composio bridge. Two paths:
 *   1. COMPOSIO_API_KEY env present: real OAuth flow via Composio REST API.
 *      Calls /api/v3/connected_accounts/link to start the auth dance +
 *      returns the redirect URL for the operator.
 *   2. No env: log interest + persist a pending connection row so the queue
 *      can be replayed when keys land.
 *
 * v3 migration (2026-05-10): Composio deprecated v1 connectedAccounts
 * with the message "⚠️ Please migrate to v3 API". v3 splits the flow:
 *   - First, ensure an auth_config exists for the toolkit (cached per
 *     org via resolveOrCreateAuthConfig).
 *   - Then POST /api/v3/connected_accounts/link with auth_config_id +
 *     user_id + callback_url. Response contains redirect_url +
 *     connected_account_id.
 * Composio appends `connected_account_id=` and `status=success|failed`
 * to the callback URL when OAuth completes.
 *
 * PR 1 (per-user OAuth, migration 0063): user_id scopes the Composio
 * grant to the calling member's userId so two members of the same org
 * each get their own Gmail / HubSpot / etc bucket. Pending row also
 * stamps user_id so the callback only flips that member's row.
 */
export async function POST(req: Request) {
  try {
    const ctx = await getOrgContext();
    if (!ctx || !ctx.activeOrgId) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const organizationId = ctx.activeOrgId;
    const userId = ctx.userId;
    const body = (await req.json().catch(() => ({}))) as { key?: string };
    const key = typeof body.key === "string" ? body.key : null;
    if (!key) {
      return NextResponse.json({ error: "missing 'key' in body" }, { status: 400 });
    }
    const entry = getCatalogEntry(key);
    if (!entry) {
      return NextResponse.json({ error: `unknown connector '${key}'` }, { status: 404 });
    }

    // Per-org Composio key first (Connections → Workspace API keys),
    // fall back to env. Mirrors composioCall's resolution so the OAuth
    // start path uses the same credentials the proxy will later call with.
    const composioKey = await resolveComposioApiKey(organizationId);
    if (composioKey) {
      // v3 OAuth flow: resolve auth_config first, then POST to link.
      try {
        const toolkitSlug = composioAppNameFor(entry.key);
        const authConfigId = await resolveOrCreateAuthConfig(
          organizationId,
          toolkitSlug,
          composioKey,
        );
        if (!authConfigId) {
          console.warn(
            `[composio] no auth_config available for ${toolkitSlug} - falling through to interest log`,
          );
        } else {
          const callbackBase = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/connections/composio/callback`;
          const r = await fetch(
            "https://backend.composio.dev/api/v3/connected_accounts/link",
            {
              method: "POST",
              headers: {
                "x-api-key": composioKey,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                auth_config_id: authConfigId,
                // user_id scopes the Composio grant per member so two
                // users in the same org each get their own bucket. Falls
                // back to org-wide if no session (shouldn't happen post
                // getOrgContext gate above, defensive).
                user_id: userId ?? organizationId,
                callback_url: callbackBase,
              }),
              signal: AbortSignal.timeout(15_000),
            },
          );
          if (r.ok) {
            const data = (await r.json()) as {
              redirect_url?: string;
              connected_account_id?: string;
              link_token?: string;
            };
            // Persist pending row so the OAuth callback can find it and
            // upgrade to 'connected'. Lookup-then-update-or-insert,
            // mirroring src/lib/connections/queries.ts: the only unique
            // index that covers user_id is the COALESCE-based partial
            // from migration 0063 which supabase-js .upsert(onConflict)
            // cannot target (Postgres needs a literal column / expression
            // match). Re-clicking Connect on a stale pending / errored
            // row replaces it with the new connected_account_id +
            // auth_config_id from this v3 link attempt. If a 'connected'
            // row exists we still overwrite to pending_token; the user
            // explicitly clicked Connect again, treat as reconnect.
            const providerConfigKey = `composio:${entry.key}`;
            const db = supabaseAdmin();
            const existing = userId
              ? await db
                  .from("rgaios_connections")
                  .select("id")
                  .eq("organization_id", organizationId)
                  .eq("provider_config_key", providerConfigKey)
                  .is("agent_id", null)
                  .eq("user_id" as never, userId)
                  .maybeSingle()
              : await db
                  .from("rgaios_connections")
                  .select("id")
                  .eq("organization_id", organizationId)
                  .eq("provider_config_key", providerConfigKey)
                  .is("agent_id", null)
                  .is("user_id" as string, null)
                  .maybeSingle();
            if (existing.error) {
              console.error(
                `[composio] pending row lookup failed for org ${organizationId} ${entry.key}:`,
                existing.error.message,
              );
              return NextResponse.json(
                { error: "could not stage connection: " + existing.error.message },
                { status: 500 },
              );
            }
            const pendingRow = {
              organization_id: organizationId,
              user_id: userId ?? null,
              agent_id: null,
              provider_config_key: providerConfigKey,
              nango_connection_id:
                data.connected_account_id ?? `pending-${Date.now()}`,
              display_name: entry.name,
              status: "pending_token",
              metadata: {
                composio_app: entry.key,
                composio_auth_config_id: authConfigId,
                started_at: new Date().toISOString(),
              },
            };
            const ins = existing.data
              ? await db
                  .from("rgaios_connections")
                  .update(pendingRow as never)
                  .eq("id", existing.data.id)
              : await db
                  .from("rgaios_connections")
                  .insert(pendingRow as never);
            if (ins.error) {
              console.error(
                `[composio] pending row insert failed for org ${organizationId} ${entry.key}:`,
                ins.error.message,
              );
              return NextResponse.json(
                { error: "could not stage connection: " + ins.error.message },
                { status: 500 },
              );
            }
            return NextResponse.json({
              ok: true,
              redirectUrl: data.redirect_url,
              connectionId: data.connected_account_id,
            });
          }
          const errText = await r.text();
          console.warn(
            `[composio] v3 link failed: ${r.status} ${errText.slice(0, 200)}`,
          );
        }
      } catch (err) {
        console.warn(`[composio] fetch threw: ${(err as Error).message}`);
      }
    }

    // Fallback: log interest + record pending so we can replay later
    console.log(`[composio.interest] org=${organizationId} key=${key} name=${entry.name}`);
    return NextResponse.json({
      ok: true,
      pending: true,
      message: composioKey
        ? "Composio reachable but init failed - interest recorded for retry"
        : "No COMPOSIO_API_KEY env set - interest recorded for when Composio is wired",
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
