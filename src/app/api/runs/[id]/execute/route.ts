import { NextResponse, type NextRequest } from "next/server";
import { dispatchRun } from "@/lib/runs/dispatch";
import { getRun } from "@/lib/runs/queries";
import { getOrgContext } from "@/lib/auth/admin";
import { badUuidResponse } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/runs/[id]/execute
 *
 * Kicks off execution for a pending run. Returns 202 immediately and does
 * the actual work in Vercel's `after()` hook so the HTTP response isn't
 * blocked by model latency.
 *
 * Auth: caller's session must own the same org as the run, OR the call
 * carries the cron secret header (used by the drain server and any
 * external scheduler that fans out by run id). Without either, even a
 * UUID-guess attack would be a fanout vector for arbitrary expensive
 * model calls.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const bad = badUuidResponse(id);
  if (bad) return bad;
  const run = await getRun(id);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Match the cron auth convention from /api/cron/schedule-tick:
  // Authorization: Bearer ${CRON_SECRET}. The drain server + Vercel
  // cron set this. If CRON_SECRET isn't set in the env, this gate
  // never matches and we fall back to session-based ownership check.
  //
  // Cross-org gate: a leaked CRON_SECRET (Vercel logs, env snapshot)
  // would otherwise let anyone POST /api/runs/<any uuid>/execute and
  // dispatch a run for ANY org. Require an `x-org-id` header binding
  // the call to a specific tenant and verify it matches the run's org
  // before dispatch. Drain server + cron callers set this header; both
  // already have org context when they fan out per-tenant.
  const cronSecret = process.env.CRON_SECRET;
  const cronAuthorized =
    !!cronSecret && req.headers.get("authorization") === `Bearer ${cronSecret}`;

  if (cronAuthorized) {
    const headerOrg = req.headers.get("x-org-id");
    if (!headerOrg || headerOrg !== run.organization_id) {
      return NextResponse.json(
        { error: "x-org-id header missing or does not match run org" },
        { status: 403 },
      );
    }
  } else {
    const ctx = await getOrgContext();
    if (!ctx?.activeOrgId || ctx.activeOrgId !== run.organization_id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (run.status !== "pending") {
    return NextResponse.json({
      ok: true,
      skipped: `run status is ${run.status}`,
    });
  }

  dispatchRun(id, run.organization_id);

  return NextResponse.json({ ok: true, accepted: true }, { status: 202 });
}
