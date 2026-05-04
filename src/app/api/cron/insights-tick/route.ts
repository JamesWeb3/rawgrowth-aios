import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { sweepAllDepts } from "@/lib/insights/generator";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET /api/cron/insights-tick
 *
 * Sweeps every active org, runs the metric-anomaly detector + agent
 * drill-down for each department + Atlas cross-dept layer. Generates
 * insights cards + spawns coordinated <task> routines whenever an
 * agent proposes them.
 *
 * Auth: Bearer ${CRON_SECRET}, same convention as schedule-tick.
 *
 * Cadence per org configurable via env INSIGHTS_CHECK_INTERVAL_HOURS
 * (default 6h). The cron itself runs as often as Vercel allows
 * (Hobby = daily; Pro = any cron). On each run we skip orgs that
 * generated insights more recently than the configured interval, so
 * the same physical cron schedule respects the per-org throttle.
 */

const DEFAULT_INTERVAL_H = 6;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const intervalH =
    Number(process.env.INSIGHTS_CHECK_INTERVAL_HOURS) || DEFAULT_INTERVAL_H;
  const cutoff = new Date(Date.now() - intervalH * 60 * 60 * 1000).toISOString();

  // Pick orgs that haven't generated insights in `intervalH` hours
  // (or have never generated any). Skip orgs without any agents to
  // avoid empty sweeps.
  const { data: orgs } = await supabaseAdmin()
    .from("rgaios_organizations")
    .select("id, name")
    .order("updated_at", { ascending: false })
    .limit(50);

  const results: Array<{
    org: string;
    name: string;
    skipped?: string;
    created?: number;
  }> = [];

  for (const o of (orgs ?? []) as Array<{ id: string; name: string }>) {
    // Skip if recent insights already exist for this org
    const { data: recent } = await supabaseAdmin()
      .from("rgaios_insights")
      .select("id")
      .eq("organization_id", o.id)
      .gte("created_at", cutoff)
      .limit(1)
      .maybeSingle();
    if (recent) {
      results.push({ org: o.id, name: o.name, skipped: "recent" });
      continue;
    }
    try {
      const r = await sweepAllDepts(o.id);
      results.push({ org: o.id, name: o.name, created: r.created });
    } catch (err) {
      results.push({
        org: o.id,
        name: o.name,
        skipped: (err as Error).message.slice(0, 100),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    intervalHours: intervalH,
    processed: results.length,
    results,
  });
}
