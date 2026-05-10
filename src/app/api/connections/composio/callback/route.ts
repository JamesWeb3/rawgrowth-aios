import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth/admin";

export const runtime = "nodejs";

/**
 * GET /api/connections/composio/callback
 *
 * Composio redirects here after OAuth completes. v3 query params are
 * `connected_account_id` and `status` (success|failed). v1 used
 * `connectionId` + status (ACTIVE|FAILED) - we accept both for
 * back-compat during the migration window. We promote the pending row
 * to status='connected' and redirect the operator back to /connections.
 *
 * Org-scope: the update is constrained to rows belonging to the
 * caller's active org. Without this check, an attacker who learned a
 * sibling tenant's connectionId could forge a callback URL and flip
 * that tenant's pending Composio row to connected.
 *
 * User-scope (migration 0063 parity): also constrained to the
 * caller's user_id. Without this filter, two members of the same org
 * who each kicked off a pending Gmail connect would race - whoever's
 * callback fires first wins the row, and the other member's pending
 * row stays stuck. The POST handler writes user_id on insert; this
 * filter matches it on update so each member's callback flips only
 * their own row.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  // Accept both v3 (snake_case) and v1 (camelCase) param names so a
  // mid-flight upgrade doesn't strand connections that started under
  // the old shape.
  const connectionId =
    url.searchParams.get("connected_account_id") ??
    url.searchParams.get("connectionId");
  const status = url.searchParams.get("status") ?? "connected";

  if (!connectionId) {
    return NextResponse.redirect(new URL("/connections?error=composio_no_id", req.url));
  }

  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.redirect(
      new URL("/auth/signin?callbackUrl=/connections", req.url),
    );
  }

  // Per-user filter: a logged-in caller flips only the row keyed on
  // their user_id. Cast on column name + value because Supabase
  // generated types are stale relative to migration 0063 (column
  // exists in DB, types haven't been regenerated yet).
  const isOk =
    status === "ACTIVE" ||
    status === "connected" ||
    status === "success" ||
    status === "ACTIVE_TOKEN" ||
    status === "active";
  const { error } = await supabaseAdmin()
    .from("rgaios_connections")
    .update({
      status: isOk ? "connected" : "error",
      metadata: { composio_callback_at: new Date().toISOString() },
    } as never)
    .eq("nango_connection_id", connectionId)
    .eq("organization_id", ctx.activeOrgId)
    .eq("user_id" as never, (ctx.userId ?? null) as never);

  if (error) {
    return NextResponse.redirect(
      new URL(`/connections?error=${encodeURIComponent(error.message)}`, req.url),
    );
  }

  return NextResponse.redirect(new URL("/connections?composio=connected", req.url));
}
