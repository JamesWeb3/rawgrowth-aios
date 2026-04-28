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
 * Auth: matches Vercel's cron convention  -  Authorization header is
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

  // Always sweep pendings that have been sitting too long  -  regardless of
  // executor state. This covers telegram-triggered runs that pile up while
  // the executor is down, and leftovers from past outages.
  const staleCutoff = new Date(now.getTime() - STALE_PENDING_MS).toISOString();
  const { data: sweptRows } = await db
    .from("rgaios_routine_runs")
    .update({
      status: "failed",
      error: "executor offline  -  run aged out before claim",
      completed_at: now.toISOString(),
    })
    .eq("status", "pending")
    .lt("created_at", staleCutoff)
    .select("id");
  const sweptCount = sweptRows?.length ?? 0;

  // If the local executor isn't ready, stop here. Don't materialise new
  // schedule runs  -  they'd just join the backlog. Sweep still ran above.
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

  // NOTE: We intentionally do NOT nest `assignee:rgaios_agents!...(reports_to)`
  // inside this select. PostgREST hint resolution can fail silently if the FK
  // constraint isn't introspected as expected (stale schema cache, ambiguous
  // hint, etc.)  -  the embed comes back as `null` instead of erroring, and
  // the sub-agent filter below would treat every sub-agent routine as a
  // manager, firing them all on heartbeat and silently breaking brief §9.6.
  // Two explicit queries are slower by one round-trip but cannot silently
  // misbehave.
  const { data: triggers, error } = await db
    .from("rgaios_routine_triggers")
    .select(
      "*, rgaios_routines!inner(id, organization_id, status, title, assignee_agent_id)",
    )
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
      assignee_agent_id: string | null;
    } | null;
  };

  const rows = (triggers ?? []) as unknown as Row[];

  // Resolve reports_to for every assignee in a single follow-up query.
  // Map<agent_id, reports_to>. Missing key => agent not found (treat as
  // manager-equivalent: don't block, surface via normal routine lookup).
  const assigneeIds = Array.from(
    new Set(
      rows
        .map((r) => r.rgaios_routines?.assignee_agent_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const reportsToById = new Map<string, string | null>();
  if (assigneeIds.length > 0) {
    const { data: agents, error: agentsErr } = await db
      .from("rgaios_agents")
      .select("id, reports_to")
      .in("id", assigneeIds);
    if (agentsErr) {
      return NextResponse.json({ error: agentsErr.message }, { status: 500 });
    }
    for (const a of agents ?? []) {
      reportsToById.set(a.id as string, (a.reports_to as string | null) ?? null);
    }
  }

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

      // Brief §9.6: sub-agents do NOT run on heartbeat; only when pinged.
      // A routine assigned to an agent fires only if that agent is a manager
      // (reports_to IS NULL). Routines with no assignee fire as before.
      // We look reports_to up via a separate query above, not via PostgREST
      // embed, to avoid silent hint resolution failures.
      const assigneeId = row.rgaios_routines.assignee_agent_id;
      if (assigneeId && reportsToById.get(assigneeId)) {
        skipped.push({ trigger_id: row.id, reason: "sub-agent (heartbeat blocked)" });
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

      // Atomic claim: bump last_fired_at conditional on it still matching
      // the baseline we read above. Two concurrent ticks both pass the
      // "not yet due" check, but only one's UPDATE returns a row — the
      // other gets an empty result and skips. Stands in for Pedro's
      // day1 §1 pg_try_advisory_lock commitment without needing a
      // separate lock table or the advisory_lock RPC surface.
      const baselineIso = row.last_fired_at
        ? new Date(row.last_fired_at).toISOString()
        : null;
      const claim = baselineIso
        ? db
            .from("rgaios_routine_triggers")
            .update({ last_fired_at: now.toISOString() })
            .eq("id", row.id)
            .eq("last_fired_at", baselineIso)
            .select("id")
        : db
            .from("rgaios_routine_triggers")
            .update({ last_fired_at: now.toISOString() })
            .eq("id", row.id)
            .is("last_fired_at", null)
            .select("id");
      const { data: claimed, error: claimErr } = await claim;
      if (claimErr) {
        skipped.push({ trigger_id: row.id, reason: `claim failed: ${claimErr.message}` });
        continue;
      }
      if (!claimed || claimed.length === 0) {
        skipped.push({ trigger_id: row.id, reason: "raced (another tick claimed)" });
        continue;
      }

      // 1. Insert a pending run (now safe — we own the slot)
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

  // Audit a single summary row so you can grep cron activity. Pinned to
  // the platform-admin tenant (DEFAULT_ORGANIZATION_ID) instead of null
  // so any future RLS-bound admin reader can actually see it — RLS
  // policies of the form `organization_id = rgaios_current_org_id()`
  // exclude null rows (null = uuid → null, not true), so a null-tenanted
  // row would be invisible to every legitimate consumer.
  if (fired.length > 0 || skipped.length > 0) {
    const { DEFAULT_ORGANIZATION_ID } = await import(
      "@/lib/supabase/constants"
    );
    await db.from("rgaios_audit_log").insert({
      organization_id: DEFAULT_ORGANIZATION_ID,
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

  // Count any pending runs across the DB  -  the self-hosted tick uses this
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
