import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { drainScrapeQueue, isScrapeComplete } from "@/lib/scrape/worker";

/**
 * POST /api/scrape  -  kick off (or re-run) the onboarding scrape for the
 * caller's organization. Called from the onboarding chat after brand
 * profile approval; idempotent so repeat calls just drain whatever's
 * still pending.
 *
 * GET /api/scrape  -  returns { ready, counts } so the dashboard can show
 * progress while the worker drains.
 */

export async function POST(_req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stats = await drainScrapeQueue(ctx.activeOrgId);
  return NextResponse.json({ ok: true, ...stats });
}

export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: rows } = await supabaseAdmin()
    .from("rgaios_scrape_snapshots")
    .select("status")
    .eq("organization_id", ctx.activeOrgId);

  const counts = {
    pending: 0,
    running: 0,
    succeeded: 0,
    blocked: 0,
    failed: 0,
  };
  for (const r of rows ?? []) {
    if (r.status in counts) counts[r.status as keyof typeof counts] += 1;
  }

  return NextResponse.json({
    ready: await isScrapeComplete(ctx.activeOrgId),
    counts,
  });
}
