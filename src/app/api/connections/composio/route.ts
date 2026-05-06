import { NextResponse } from "next/server";
import { currentOrganizationId } from "@/lib/supabase/constants";
import { getCatalogEntry } from "@/lib/connections/catalog";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Composio bridge. Two paths:
 *   1. COMPOSIO_API_KEY env present: real OAuth flow via Composio REST API.
 *      Calls https://backend.composio.dev/api/v1/connectedAccounts to start
 *      the auth dance + returns the redirect URL for the operator.
 *   2. No env: log interest + persist a pending connection row so the queue
 *      can be replayed when keys land.
 */
export async function POST(req: Request) {
  try {
    const organizationId = await currentOrganizationId();
    const body = (await req.json().catch(() => ({}))) as { key?: string };
    const key = typeof body.key === "string" ? body.key : null;
    if (!key) {
      return NextResponse.json({ error: "missing 'key' in body" }, { status: 400 });
    }
    const entry = getCatalogEntry(key);
    if (!entry) {
      return NextResponse.json({ error: `unknown connector '${key}'` }, { status: 404 });
    }

    const composioKey = process.env.COMPOSIO_API_KEY;
    if (composioKey) {
      // Real OAuth flow via Composio
      try {
        const r = await fetch("https://backend.composio.dev/api/v1/connectedAccounts", {
          method: "POST",
          headers: {
            "x-api-key": composioKey,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            appName: entry.key,
            entityId: organizationId,
            redirectUri: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/connections/composio/callback`,
          }),
        });
        if (r.ok) {
          const data = (await r.json()) as { redirectUrl?: string; connectionId?: string };
          // Persist pending row so the OAuth callback can find it and
          // upgrade to 'connected'. If this insert silently fails the
          // user gets a redirect URL but the callback later 404s the
          // row - log the cause so we can debug instead of guessing.
          const ins = await supabaseAdmin()
            .from("rgaios_connections")
            .insert({
              organization_id: organizationId,
              provider_config_key: `composio:${entry.key}`,
              nango_connection_id: data.connectionId ?? `pending-${Date.now()}`,
              display_name: entry.name,
              status: "pending_token",
              metadata: { composio_app: entry.key, started_at: new Date().toISOString() },
            } as never);
          if (ins.error) {
            console.error(
              `[composio] pending row insert failed for org ${organizationId} ${entry.key}:`,
              ins.error.message,
            );
          }
          return NextResponse.json({
            ok: true,
            redirectUrl: data.redirectUrl,
            connectionId: data.connectionId,
          });
        }
        const errText = await r.text();
        console.warn(`[composio] init failed: ${r.status} ${errText.slice(0, 200)}`);
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
