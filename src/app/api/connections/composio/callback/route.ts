import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth/admin";

export const runtime = "nodejs";

/**
 * GET /api/connections/composio/callback
 *
 * Composio redirects here after OAuth completes. Query params include
 * `connectionId` and `status`. We promote the pending row to status='connected'
 * and redirect the operator back to /connections.
 *
 * Org-scope: the update is constrained to rows belonging to the
 * caller's active org. Without this check, an attacker who learned a
 * sibling tenant's connectionId could forge a callback URL and flip
 * that tenant's pending Composio row to connected.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const connectionId = url.searchParams.get("connectionId");
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

  const { error } = await supabaseAdmin()
    .from("rgaios_connections")
    .update({
      status: status === "ACTIVE" || status === "connected" ? "connected" : "error",
      metadata: { composio_callback_at: new Date().toISOString() },
    } as never)
    .eq("nango_connection_id", connectionId)
    .eq("organization_id", ctx.activeOrgId);

  if (error) {
    return NextResponse.redirect(
      new URL(`/connections?error=${encodeURIComponent(error.message)}`, req.url),
    );
  }

  return NextResponse.redirect(new URL("/connections?composio=connected", req.url));
}
