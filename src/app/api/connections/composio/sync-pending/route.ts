import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth/admin";
import { resolveComposioApiKey } from "@/lib/composio/proxy";

export const runtime = "nodejs";

/**
 * POST /api/connections/composio/sync-pending
 *
 * Chris's bug 1 (2026-05-12): Composio v3's OAuth flow lands the user
 * on its own "Successfully connected" static page and never redirects
 * back to our `callback_url`. Server-side callback never fires either
 * (it's a browser-redirect flow, not a webhook), so our row stays at
 * `status='pending_token'` even after the upstream OAuth succeeded.
 *
 * Workaround: the client-side connectors-grid auto-polls this endpoint
 * every 5s while at least one pending row exists. We hit Composio's
 * `GET /api/v3/connected_accounts/{id}` for each pending row in the
 * caller's org. If Composio reports the account `ACTIVE`, we flip the
 * row to `status='connected'` so the badge updates without operator
 * intervention.
 *
 * Org-scoped: only walks the caller's active org. service-role bypass
 * lets us write the flip; the read is bounded by organization_id +
 * status='pending_token' so we never touch other tenants.
 */
export async function POST() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = ctx.activeOrgId;
  const db = supabaseAdmin();

  const { data: pending } = await db
    .from("rgaios_connections")
    .select("id, nango_connection_id, provider_config_key, metadata")
    .eq("organization_id", orgId)
    .eq("status", "pending_token");

  type Row = {
    id: string;
    nango_connection_id: string | null;
    provider_config_key: string;
    metadata: Record<string, unknown> | null;
  };
  const rows = (pending ?? []) as Row[];
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, checked: 0, flipped: 0 });
  }

  const composioKey = await resolveComposioApiKey(orgId);
  if (!composioKey) {
    return NextResponse.json({
      ok: true,
      checked: 0,
      flipped: 0,
      reason: "no composio api key",
    });
  }

  let flipped = 0;
  const results: Array<{ id: string; status: string }> = [];

  for (const row of rows) {
    if (!row.nango_connection_id) continue;
    try {
      const res = await fetch(
        `https://backend.composio.dev/api/v3/connected_accounts/${row.nango_connection_id}`,
        {
          method: "GET",
          headers: { "x-api-key": composioKey },
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (!res.ok) {
        results.push({ id: row.id, status: `composio ${res.status}` });
        continue;
      }
      const data = (await res.json()) as { status?: string };
      const upstream = String(data.status ?? "").toUpperCase();
      const isActive =
        upstream === "ACTIVE" ||
        upstream === "CONNECTED" ||
        upstream === "ACTIVE_TOKEN";
      const isFailed = upstream === "FAILED" || upstream === "EXPIRED";
      if (isActive) {
        const prevMeta = (row.metadata ?? {}) as Record<string, unknown>;
        await db
          .from("rgaios_connections")
          .update({
            status: "connected",
            connected_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            metadata: {
              ...prevMeta,
              composio_sync_at: new Date().toISOString(),
            },
          } as never)
          .eq("id", row.id);
        flipped += 1;
        results.push({ id: row.id, status: "connected" });
      } else if (isFailed) {
        await db
          .from("rgaios_connections")
          .update({
            status: "error",
            updated_at: new Date().toISOString(),
          } as never)
          .eq("id", row.id);
        results.push({ id: row.id, status: "error" });
      } else {
        results.push({ id: row.id, status: `pending (${upstream || "unknown"})` });
      }
    } catch (err) {
      results.push({
        id: row.id,
        status: `sync error: ${(err as Error).message}`,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    checked: rows.length,
    flipped,
    rows: results,
  });
}
