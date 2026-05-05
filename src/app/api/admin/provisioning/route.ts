import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/admin/provisioning
 *
 * Polled by the admin provisioning view every 5s to pull the latest
 * queue state.
 */
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx?.isAdmin) {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  const { data } = await supabaseAdmin()
    .from("rgaios_provisioning_queue")
    .select(
      "id, owner_email, owner_name, plan_name, status, vps_url, dashboard_url, error, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(50);

  return NextResponse.json({ queue: data ?? [] });
}
