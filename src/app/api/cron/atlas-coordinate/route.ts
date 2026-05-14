import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { requireCronAuth } from "@/lib/cron/auth";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * GET /api/cron/atlas-coordinate
 *
 * Continuous coordination loop. Runs every 15 minutes (Pedro's
 * 2026-05-05 ask: "rode cron de 15 em 15... nn para porra, no tasks e
 * no outro"). For every active org:
 *
 *   1. Counts open tasks, failed tasks (last 1h), pending insights,
 *      pending approvals, queued insight chats.
 *   2. If - and ONLY if - something is genuinely new and actionable
 *      (a failure / approval / queued chat / stale critical that
 *      wasn't in the last posted state), Atlas drops ONE concise,
 *      decision-focused chat message into its own thread.
 *   3. When nothing is actionable, Atlas posts NOTHING. Silence beats
 *      a "nothing in flight, re-check in 15" filler line every cycle
 *      (Dilan, 2026-05-14: the routine was clogging Marti's scan
 *      chat). The idle-nudge rotation was removed for the same reason.
 *   4. Dedupes via metadata.kind='atlas_coordinate' + a recency check
 *      (skips if a coordinate msg was written in the last 14 minutes)
 *      AND a COARSE state signature: the signature keys on the SET of
 *      insight root causes (department + metric), not the exact title
 *      / percentage. So "Failed agent runs up 1400%" and "...1500%"
 *      are the same root cause => same signature => no re-post.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  // Kill switch (Dilan, 2026-05-14: "kill this routine, it clogs
  // Marti's scan chat"). Emergency off-valve for the 15-min loop -
  // ON by default now that the dedup is fixed (a stable signature
  // gates re-posts on both the ticket and the idle-nudge path, and
  // unchanged state re-surfaces at most every 3h). Set
  // ATLAS_COORDINATE_ENABLED=0 to hard-disable without a code deploy
  // if it ever misbehaves again.
  // Read process.env directly, NOT the strict `env` validator object.
  // Importing `env` here ran its DEPLOY_MODE=hosted validation during
  // `next build` page-data collection and failed the Docker image build
  // ("Missing required variables..."). Runtime process.env read is safe.
  if (process.env.ATLAS_COORDINATE_ENABLED === "0") {
    return NextResponse.json({
      ok: true,
      processed: 0,
      results: [],
      disabled: "ATLAS_COORDINATE_ENABLED",
    });
  }

  const db = supabaseAdmin();
  const { data: orgs } = await db
    .from("rgaios_organizations")
    .select("id, name")
    .limit(100);

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const fourteenMinAgo = new Date(Date.now() - 14 * 60 * 1000).toISOString();

  const results: Array<Record<string, unknown>> = [];

  for (const o of (orgs ?? []) as Array<{ id: string; name: string }>) {
    try {
      const orgId = o.id;

      // Skip if a coordinate msg was written in the last 14 minutes.
      // Race protection (cron + lazy SWR trigger): the unique index
      // rgaios_atlas_coord_dedup_idx (migration 0060) catches the
      // last-millisecond races; this read still gates 99% of dupes
      // before we burn cycles building a payload.
      const { data: lastMsg } = await db
        .from("rgaios_agent_chat_messages")
        .select("id, created_at")
        .eq("organization_id", orgId)
        .filter("metadata->>kind", "eq", "atlas_coordinate")
        .gte("created_at", fourteenMinAgo)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastMsg) {
        results.push({ org: orgId, name: o.name, skipped: "recent" });
        continue;
      }

      // Dedup: even past the 14-min window, don't re-post an unchanged
      // coordination state. We read the last atlas_coordinate message's
      // stored `sig` (a stable signature of the state - see nextSig
      // below) and its timestamp. The actual skip decision happens once
      // the counters are in, and applies to BOTH the ticket and the
      // idle-nudge path.
      const { data: lastCoordRaw } = await db
        .from("rgaios_agent_chat_messages")
        .select("created_at, metadata")
        .eq("organization_id", orgId)
        .filter("metadata->>kind", "eq", "atlas_coordinate")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      // Supabase generated types collapse this row to `never`; cast to the
      // shape we actually selected.
      const lastCoord = lastCoordRaw as unknown as {
        created_at: string | null;
        metadata: { sig?: string } | null;
      } | null;
      const lastSig = lastCoord?.metadata?.sig ?? null;
      const lastCoordAtMs = lastCoord?.created_at
        ? Date.parse(lastCoord.created_at)
        : 0;

      // Atlas (CEO).
      const { data: ceo } = await db
        .from("rgaios_agents")
        .select("id")
        .eq("organization_id", orgId)
        .eq("role", "ceo")
        .maybeSingle();
      if (!ceo) {
        results.push({ org: orgId, name: o.name, skipped: "no_atlas" });
        continue;
      }
      const ceoId = (ceo as unknown as { id: string }).id;

      // Counters.
      const [
        openRunsRes,
        failedRunsRes,
        pendingApprovalsRes,
        pendingInsightsRes,
        queuedInsightsRes,
      ] = await Promise.all([
        db
          .from("rgaios_routine_runs")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .in("status", ["queued", "running"] as never),
        db
          .from("rgaios_routine_runs")
          .select("id, error, routine_id, created_at")
          .eq("organization_id", orgId)
          .eq("status", "failed")
          .gte("created_at", oneHourAgo)
          .limit(20),
        db
          .from("rgaios_approvals")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("status", "pending"),
        db
          .from("rgaios_insights")
          // `department` + `metric` are the STABLE root-cause identity
          // of an insight. The `title` carries the volatile percentage
          // ("up 1400%" vs "up 1500%") that caused the signature churn,
          // so we sign on (department, metric) instead - see nextSig.
          .select("id, title, severity, created_at, department, metric")
          .eq("organization_id", orgId)
          .in("status", ["open", "pending", "executing", "needs_approval"])
          .order("created_at", { ascending: false })
          .limit(10),
        db
          .from("rgaios_insights")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("chat_state", "queued"),
      ]);

      const openRuns = openRunsRes.count ?? 0;
      const failedRuns = (failedRunsRes.data ?? []) as Array<{
        id: string;
        error: string | null;
        routine_id: string | null;
        created_at: string;
      }>;
      const pendingApprovals = pendingApprovalsRes.count ?? 0;
      const pendingInsights = (pendingInsightsRes.data ?? []) as Array<{
        id: string;
        title: string;
        severity: string;
        created_at: string;
        department: string | null;
        metric: string | null;
      }>;
      const queuedInsights = queuedInsightsRes.count ?? 0;

      // Critical insights left unactioned for >30 min. Computed once
      // here so the actionable check, the dedup signature and the
      // ticket body all share the exact same set.
      const stalePending = pendingInsights.filter(
        (i) =>
          i.severity === "critical" &&
          new Date(i.created_at).getTime() < Date.now() - 30 * 60 * 1000,
      );

      const actionable =
        failedRuns.length > 0 ||
        pendingApprovals > 0 ||
        queuedInsights > 0 ||
        stalePending.length > 0;

      const nextCounts = {
        openRuns,
        failedRuns: failedRuns.length,
        pendingApprovals,
        pendingInsights: pendingInsights.length,
        queuedInsights,
      };

      // Dedup signature - now COARSE, keyed on root causes only.
      //
      // First attempt compared raw counts: `failedRuns` is a sliding 1h
      // window and `openRuns` ticks constantly, so counts almost never
      // matched twice and "skip unchanged" never fired.
      //
      // Second attempt signed exact insight IDs. But the insights
      // themselves churn: a (fulfilment, runs_failed) anomaly resolves
      // and a fresh row is created for the same root cause with a new
      // percentage in the title ("up 1400%" -> "up 1500%"). New ID =>
      // new signature => Atlas re-posted a near-identical "Coordination
      // check" every cycle anyway (Dilan, 2026-05-14: clogging chat).
      //
      // Fix: sign the SET of insight root causes - (department, metric)
      // pairs - not their IDs or titles. "Failed agent runs up 1400%"
      // and "...1500%" are both (fulfilment, runs_failed): same root
      // cause, same signature, no re-post. Failed runs are bucketed by
      // routine_id (the recurring thing that's broken) rather than the
      // per-run id for the same reason. A genuinely new root cause - a
      // different metric, a different routine failing - changes the
      // signature and posts.
      const staleRootCauses = Array.from(
        new Set(
          stalePending.map(
            (i) => `${i.department ?? "atlas"}:${i.metric ?? "?"}`,
          ),
        ),
      ).sort();
      const failedRoutines = Array.from(
        new Set(failedRuns.map((f) => f.routine_id ?? "unknown")),
      ).sort();
      const nextSig = JSON.stringify({
        failedRoutines,
        staleRootCauses,
        // Approval / queue depth bucketed (0 / 1 / "few" / "many") so a
        // single item arriving or clearing flips state, but routine
        // count jitter inside a bucket does not.
        approvals: bucketCount(pendingApprovals),
        queued: bucketCount(queuedInsights),
        actionable,
      });

      // Nothing actionable => post NOTHING. The old code dropped a
      // canned idle nudge here every cycle ("Nothing on fire...",
      // "Heartbeat...") which was pure noise. Silence is the better
      // signal - the operator only hears from Atlas when there's a
      // decision to make (Dilan, 2026-05-14). We still `continue`
      // without writing, so no atlas_coordinate row, no bell badge.
      if (!actionable) {
        results.push({ org: orgId, name: o.name, skipped: "quiet" });
        continue;
      }

      // Unchanged state re-surfaces at most every REFRESH_WINDOW. Below
      // that window an identical COARSE signature (same set of failing
      // routines + same set of insight root causes + same approval /
      // queue buckets) is skipped. Because the signature ignores the
      // volatile percentage in insight titles and the per-run failed
      // ids, churn alone no longer counts as "changed" - only a new
      // root cause posts. A genuine state change posts immediately.
      const REFRESH_WINDOW_MS = 3 * 60 * 60 * 1000;
      const skipUnchanged =
        lastSig !== null &&
        lastSig === nextSig &&
        lastCoordAtMs > 0 &&
        Date.now() - lastCoordAtMs < REFRESH_WINDOW_MS;
      if (skipUnchanged) {
        results.push({ org: orgId, name: o.name, skipped: "unchanged" });
        continue;
      }

      // Compose a tight, decision-first snapshot. Structure: ONE lead
      // line naming the single thing that needs the operator's call,
      // then a short evidence block per open queue. Every line is
      // something the operator can act on - no running-task count, no
      // "re-check in 15" filler. All numbers below are real counts
      // pulled above; nothing is invented.
      const clock = new Date().toLocaleString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });

      // The lead: whichever queue is the bottleneck states the decision
      // up front, before any detail. Priority: approvals block work
      // outright > stale criticals are aging > queued questions wait on
      // the operator > failed runs need a retry/escalate call.
      const lead =
        pendingApprovals > 0
          ? `${pendingApprovals} approval${pendingApprovals === 1 ? "" : "s"} blocking work - clear ${pendingApprovals === 1 ? "it" : "them"} or work stays stuck.`
          : stalePending.length > 0
            ? `${stalePending.length} critical insight${stalePending.length === 1 ? "" : "s"} sat >30m unactioned - act or dismiss.`
            : queuedInsights > 0
              ? `${queuedInsights} insight question${queuedInsights === 1 ? "" : "s"} waiting on your answer.`
              : `${failedRuns.length} task${failedRuns.length === 1 ? "" : "s"} failed in the last hour - retry or escalate?`;

      const lines: string[] = [
        `**Coordination check - ${clock}**`,
        "",
        lead,
      ];

      // Evidence block. Only queues with something in them show, each
      // as one count line plus the few concrete items behind it.
      if (pendingApprovals > 0) {
        lines.push("", `Approvals pending: ${pendingApprovals}`);
      }
      if (stalePending.length > 0) {
        lines.push("", `Stale critical insights (>30m): ${stalePending.length}`);
        for (const i of stalePending.slice(0, 2)) {
          lines.push(`  - ${i.title.slice(0, 100)}`);
        }
      }
      if (queuedInsights > 0) {
        lines.push("", `Insight questions queued for chat: ${queuedInsights}`);
      }
      if (failedRuns.length > 0) {
        lines.push("", `Failed tasks (last 1h): ${failedRuns.length}`);
        for (const f of failedRuns.slice(0, 3)) {
          const err = (f.error ?? "no error msg").slice(0, 120);
          lines.push(`  - run ${f.id.slice(0, 8)}: ${err}`);
        }
        if (failedRuns.length > 3) {
          lines.push(`  - +${failedRuns.length - 3} more`);
        }
      }

      const content = lines.join("\n");
      const ticketInsert = await db.from("rgaios_agent_chat_messages").insert({
        organization_id: orgId,
        agent_id: ceoId,
        user_id: null,
        role: "assistant",
        content,
        metadata: {
          kind: "atlas_coordinate",
          counts: nextCounts,
          sig: nextSig,
        },
      } as never);

      if (ticketInsert.error?.code === "23505") {
        results.push({ org: orgId, name: o.name, skipped: "race_dedup" });
        continue;
      }
      if (ticketInsert.error) {
        console.error(
          `[atlas-coordinate] ticket insert failed for org ${orgId}:`,
          ticketInsert.error.message,
        );
        results.push({
          org: orgId,
          name: o.name,
          error: ticketInsert.error.message,
        });
        continue;
      }
      results.push({
        org: orgId,
        name: o.name,
        emitted: true,
        counts: {
          openRuns,
          failedRuns: failedRuns.length,
          pendingApprovals,
          pendingInsights: pendingInsights.length,
          queuedInsights,
        },
      });

      // Auto-flag failed delegated runs so Scan surfaces them on next operator turn.
      const { data: failedDelegated } = await db
        .from("rgaios_routine_runs")
        .select("id, error, input_payload, created_at")
        .eq("organization_id", orgId)
        .eq("source", "chat_command")
        .eq("status", "failed")
        .gte("created_at", oneHourAgo)
        .order("created_at", { ascending: false })
        .limit(5);

      for (const fr of (failedDelegated ?? []) as Array<{
        id: string;
        error: string | null;
        input_payload: { title?: string } | null;
        created_at: string;
      }>) {
        // Idempotency: skip if we already flagged this run via metadata
        const { count } = await db
          .from("rgaios_agent_chat_messages")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .filter("metadata->>monitor_alert_run_id", "eq", fr.id);
        if ((count ?? 0) > 0) continue;

        // Find the CEO agent for this org (reports_to=null)
        const { data: ceoAgent } = await db
          .from("rgaios_agents")
          .select("id")
          .eq("organization_id", orgId)
          .is("reports_to", null)
          .limit(1)
          .maybeSingle();
        if (!ceoAgent) continue;

        const errPreview = (fr.error ?? "unknown error").slice(0, 200);
        const taskPreview =
          fr.input_payload?.title?.slice(0, 100) ?? "unknown task";

        await db.from("rgaios_agent_chat_messages").insert({
          organization_id: orgId,
          agent_id: (ceoAgent as { id: string }).id,
          user_id: null,
          role: "system",
          content: `Monitor alert: Delegated run failed.\nTask: ${taskPreview}\nError: ${errPreview}\nWant me to retry or escalate?`,
          metadata: { kind: "monitor_alert", monitor_alert_run_id: fr.id },
        } as never);
      }
    } catch (err) {
      results.push({
        org: o.id,
        name: o.name,
        error: (err as Error).message.slice(0, 200),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    processed: results.length,
    results,
  });
}

/**
 * Bucket a queue depth into a coarse band for the dedup signature.
 * Why: the exact count of pending approvals / queued chats jitters as
 * background work drains the queue, and signing the raw number made
 * every cycle look "changed". Bands change only on a meaningful move
 * (empty -> non-empty, a handful -> a backlog), so unchanged state
 * stays unchanged.
 */
function bucketCount(n: number): string {
  if (n <= 0) return "0";
  if (n === 1) return "1";
  if (n <= 5) return "few";
  return "many";
}
