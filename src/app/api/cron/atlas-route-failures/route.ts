import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { routeFailures } from "@/lib/atlas/router";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET /api/cron/atlas-route-failures
 *
 * Daily cron. For every active org, asks Atlas to triage failed tasks
 * from the last 24h - retry with refinement, reassign to different
 * role, or escalate to human. Spawns the new tasks via <task> blocks.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const { data: orgs } = await supabaseAdmin()
    .from("rgaios_organizations")
    .select("id, name")
    .order("updated_at", { ascending: false })
    .limit(50);

  const results: Array<{
    org: string;
    name: string;
    failed: number;
    rerouted: number;
    errors: string[];
  }> = [];

  for (const o of (orgs ?? []) as Array<{ id: string; name: string }>) {
    try {
      const r = await routeFailures(o.id);
      results.push({ org: o.id, name: o.name, ...r });
    } catch (err) {
      results.push({
        org: o.id,
        name: o.name,
        failed: 0,
        rerouted: 0,
        errors: [(err as Error).message.slice(0, 200)],
      });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
