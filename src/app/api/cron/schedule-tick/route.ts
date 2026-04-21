import { NextResponse, type NextRequest } from "next/server";
import { CronExpressionParser } from "cron-parser";

import { supabaseAdmin } from "@/lib/supabase/server";
import { dispatchRun } from "@/lib/runs/dispatch";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET /api/cron/schedule-tick
 *
 * Called by Vercel Cron every minute (see vercel.ts). For each active
 * schedule trigger it computes the most recent cron fire instant, and
 * if that instant is newer than the trigger's last_fired_at it:
 *   1. inserts a pending routine_runs row (source=schedule)
 *   2. updates the trigger's last_fired_at to "now"
 *   3. fires executeRun() in the background
 *
 * Auth: matches Vercel's cron convention — Authorization header is
 * `Bearer ${CRON_SECRET}`. Set CRON_SECRET in Vercel env; the scheduler
 * sends it automatically.
 */
const STALE_PENDING_MS = 10 * 60 * 1000;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  // The self-hosted tick tells us whether its local claude executor is
  // actually alive. If not, we skip firing new schedule runs entirely so
  // the queue doesn't pile up and slam the user when auth returns.
  // (Hosted mode doesn't pass this; the executor is always available.)
  const executorReady = req.nextUrl.searchParams.get("executor_ready") !== "0";

  const db = supabaseAdmin();
  const now = new Date();

  // Always sweep pendings that have been sitting too long — regardless of
  // executor state. This covers telegram-triggered runs that pile up while
  // the executor is down, and leftovers from past outages.
  const staleCutoff = new Date(now.getTime() - STALE_PENDING_MS).toISOString();
  const { data: sweptRows } = await db
    .from("rgaios_routine_runs")
    .update({
      status: "failed",
      error: "executor offline — run aged out before claim",
      completed_at: now.toISOString(),
    })
    .eq("status", "pending")
    .lt("created_at", staleCutoff)
    .select("id");
  const sweptCount = sweptRows?.length ?? 0;

  // If the local executor isn't ready, stop here. Don't materialise new
  // schedule runs — they'd just join the backlog. Sweep still ran above.
  if (!executorReady) {
    const { count: pendingCount } = await db
      .from("rgaios_routine_runs")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    return NextResponse.json({
      ok: true,
      ts: now.toISOString(),
      executor_ready: false,
      swept: sweptCount,
      fired: [],
      skipped: [],
      pending_count: pendingCount ?? 0,
    });
  }

  const { data: triggers, error } = await db
    .from("rgaios_routine_triggers")
    .select("*, rgaios_routines!inner(id, organization_id, status, title)")
    .eq("kind", "schedule")
    .eq("enabled", true);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    id: string;
    organization_id: string;
    routine_id: string;
    config: Record<string, unknown>;
    last_fired_at: string | null;
    created_at: string;
    rgaios_routines: {
      id: string;
      organization_id: string;
      status: string;
      title: string;
    } | null;
  };

  const rows = (triggers ?? []) as unknown as Row[];

  const fired: Array<{ trigger_id: string; run_id: string; title: string }> = [];
  const skipped: Array<{ trigger_id: string; reason: string }> = [];

  for (const row of rows) {
    try {
      if (!row.rgaios_routines || row.rgaios_routines.status !== "active") {
        skipped.push({
          trigger_id: row.id,
          reason: `routine ${row.rgaios_routines?.status ?? "missing"}`,
        });
        continue;
      }

      const cfg = row.config as { cron?: string; timezone?: string };
      const cron = cfg.cron?.trim();
      if (!cron) {
        skipped.push({ trigger_id: row.id, reason: "no cron" });
        continue;
      }
      const tz = cfg.timezone ?? "UTC";

      // currentDate=now gives us prev/next relative to now. We look at the
      // last scheduled instant that should have fired (prev), and compare
      // it against last_fired_at.
      const interval = CronExpressionParser.parse(cron, {
        tz,
        currentDate: now,
      });
      const prevInstant = interval.prev().toDate();

      const baseline = row.last_fired_at
        ? new Date(row.last_fired_at)
        : new Date(row.created_at);

      // Only fire if the most recent cron instant is newer than the last
      // time we fired. This prevents double-firing if the cron tick runs
      // more than once within the same slot.
      if (prevInstant.getTime() <= baseline.getTime()) {
        skipped.push({ trigger_id: row.id, reason: "not yet due" });
        continue;
      }

      const routineId = row.rgaios_routines.id;
      const orgId = row.organization_id;

      // 1. Insert a pending run
      const { data: run, error: runErr } = await db
        .from("rgaios_routine_runs")
        .insert({
          organization_id: orgId,
          routine_id: routineId,
          trigger_id: row.id,
          source: "schedule",
          status: "pending",
          input_payload: {
            schedule: {
              cron,
              timezone: tz,
              scheduled_for: prevInstant.toISOString(),
            },
          },
        })
        .select("id")
        .single();
      if (runErr || !run) {
        skipped.push({
          trigger_id: row.id,
          reason: `insert failed: ${runErr?.message}`,
        });
        continue;
      }

      // 2. Advance the trigger's last_fired_at
      await db
        .from("rgaios_routine_triggers")
        .update({ last_fired_at: now.toISOString() })
        .eq("id", row.id);

      // 3. Bump routine.last_run_at so the UI reflects immediately
      await db
        .from("rgaios_routines")
        .update({ last_run_at: now.toISOString() })
        .eq("id", routineId);

      // 4. Route to the executor (hosted) or leave pending for Claude Code (self-hosted)
      dispatchRun(run.id, orgId);

      fired.push({
        trigger_id: row.id,
        run_id: run.id,
        title: row.rgaios_routines.title,
      });
    } catch (err) {
      skipped.push({
        trigger_id: row.id,
        reason: `error: ${(err as Error).message}`,
      });
    }
  }

  // Audit a single summary row so you can grep cron activity.
  if (fired.length > 0 || skipped.length > 0) {
    await db.from("rgaios_audit_log").insert({
      organization_id: null, // cross-tenant summary; org_id is nullable on this table
      kind: "cron_schedule_tick",
      actor_type: "system",
      actor_id: "cron",
      detail: {
        fired_count: fired.length,
        skipped_count: skipped.length,
        fired,
      },
    });
  }

  // Count any pending runs across the DB — the self-hosted tick uses this
  // to decide whether to poke the drain daemon to wake Claude Code.
  // (Hosted mode doesn't need it; dispatchRun() handles its own executor.)
  const { count: pendingCount } = await db
    .from("rgaios_routine_runs")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  return NextResponse.json({
    ok: true,
    ts: now.toISOString(),
    executor_ready: true,
    swept: sweptCount,
    fired,
    skipped,
    pending_count: pendingCount ?? 0,
  });
}
