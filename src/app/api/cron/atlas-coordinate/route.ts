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
 *   2. If anything qualifies as actionable (failures, queue depth >0,
 *      stale-pending insights), Atlas drops ONE consolidated chat
 *      message into its own thread - "tickets snapshot" style.
 *   3. Dedupes via metadata.kind='atlas_coordinate' + a recency check
 *      (skips if a coordinate msg was written in the last 14 minutes
 *      so 15-min cron can't double-emit on overlap).
 *
 * Auth: Bearer ${CRON_SECRET}.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

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
          .in("status", ["queued", "running"]),
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
          .select("id, title, severity, created_at")
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
      }>;
      const queuedInsights = queuedInsightsRes.count ?? 0;

      const actionable =
        failedRuns.length > 0 ||
        pendingApprovals > 0 ||
        queuedInsights > 0 ||
        pendingInsights.some(
          (i) =>
            i.severity === "critical" &&
            new Date(i.created_at).getTime() < Date.now() - 30 * 60 * 1000,
        );

      // Pedro's rule (2026-05-05): Atlas must be PROACTIVE - send a
      // message even when nothing is actionable. Pick from a rotation
      // of canned nudges based on what's in the system.
      if (!actionable) {
        const idleMsg = composeIdleNudge({
          openRuns,
          pendingInsights,
          orgName: o.name,
        });
        const idleInsert = await db.from("rgaios_agent_chat_messages").insert({
          organization_id: orgId,
          agent_id: ceoId,
          user_id: null,
          role: "assistant",
          content: idleMsg,
          metadata: {
            kind: "atlas_coordinate",
            mode: "idle_nudge",
            counts: {
              openRuns,
              failedRuns: failedRuns.length,
              pendingApprovals,
              pendingInsights: pendingInsights.length,
              queuedInsights,
            },
          },
        } as never);
        if (idleInsert.error?.code === "23505") {
          results.push({
            org: orgId,
            name: o.name,
            skipped: "race_dedup",
          });
        } else if (idleInsert.error) {
          // Non-dedup failure - log so we don't silently miss a beat in
          // the proactive cadence. Atlas going quiet is the kind of
          // regression nobody notices for hours.
          console.error(
            `[atlas-coordinate] idle insert failed for org ${orgId}:`,
            idleInsert.error.message,
          );
          results.push({
            org: orgId,
            name: o.name,
            error: idleInsert.error.message,
            mode: "idle_nudge",
          });
        } else {
          results.push({
            org: orgId,
            name: o.name,
            emitted: true,
            mode: "idle_nudge",
          });
        }
        continue;
      }

      // Compose ticket-style snapshot.
      const lines: string[] = [
        `**Coordination check - ${new Date().toLocaleString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}**`,
        "",
      ];
      if (failedRuns.length > 0) {
        lines.push(`Failed tasks (last 1h): ${failedRuns.length}`);
        for (const f of failedRuns.slice(0, 3)) {
          const err = (f.error ?? "no error msg").slice(0, 120);
          lines.push(`  - run ${f.id.slice(0, 8)}: ${err}`);
        }
        if (failedRuns.length > 3) lines.push(`  - +${failedRuns.length - 3} more`);
      }
      if (pendingApprovals > 0) {
        lines.push(`Pending approvals: ${pendingApprovals}`);
      }
      if (queuedInsights > 0) {
        lines.push(`Insight questions queued for chat: ${queuedInsights}`);
      }
      const stalePending = pendingInsights.filter(
        (i) =>
          i.severity === "critical" &&
          new Date(i.created_at).getTime() < Date.now() - 30 * 60 * 1000,
      );
      if (stalePending.length > 0) {
        lines.push(`Stale critical insights (>30m unactioned): ${stalePending.length}`);
        for (const i of stalePending.slice(0, 2)) {
          lines.push(`  - ${i.title.slice(0, 100)}`);
        }
      }
      lines.push("");
      lines.push(
        openRuns > 0
          ? `${openRuns} task${openRuns === 1 ? "" : "s"} still running. I'll re-check in 15.`
          : "Nothing in flight. I'll re-check in 15.",
      );

      const content = lines.join("\n");
      const ticketInsert = await db.from("rgaios_agent_chat_messages").insert({
        organization_id: orgId,
        agent_id: ceoId,
        user_id: null,
        role: "assistant",
        content,
        metadata: {
          kind: "atlas_coordinate",
          counts: {
            openRuns,
            failedRuns: failedRuns.length,
            pendingApprovals,
            pendingInsights: pendingInsights.length,
            queuedInsights,
          },
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
 * Idle-state nudge content. Atlas is proactive even when there are no
 * tickets to surface - rotates between angles so the operator gets a
 * variety of starting points instead of the same string repeated.
 */
function composeIdleNudge(args: {
  openRuns: number;
  pendingInsights: Array<{ title: string; severity: string }>;
  orgName: string;
}): string {
  const { openRuns, pendingInsights } = args;
  const ts = new Date().toLocaleString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const angles: string[] = [];

  if (openRuns > 0) {
    angles.push(
      `**Status check - ${ts}**\n\n` +
        `${openRuns} task${openRuns === 1 ? "" : "s"} still running, no failures yet. I'll keep watching. ` +
        `Want me to drill into a specific dept's KPI while we wait?`,
    );
  }

  if (pendingInsights.length > 0) {
    const i = pendingInsights[0];
    angles.push(
      `**Quick nudge - ${ts}**\n\n` +
        `Still sitting on "${i.title.slice(0, 100)}" - it hasn't been acknowledged or actioned. ` +
        `Want me to draft a hypothesis-test plan for it, or should we let it ride another cycle?`,
    );
  }

  angles.push(
    `**Heartbeat - ${ts}**\n\n` +
      `Nothing on fire. I'm scanning every 15 min. Couple of things I could do while it's quiet: ` +
      `(1) pull a weekly summary of what each dept-head shipped, ` +
      `(2) audit which agents haven't been invoked in 7+ days, ` +
      `(3) check if any KPI baselines drifted. Pick one or send me a different angle.`,
  );
  angles.push(
    `**Dispatch - ${ts}**\n\n` +
      `Quiet window. Want me to spin up a research routine on a competitor or a product angle? ` +
      `Drop a name or topic and I'll route it to the right dept-head with a brief.`,
  );
  angles.push(
    `**Standup - ${ts}**\n\n` +
      `Caught up. If I were running this org, the next 30 minutes I'd spend reviewing ` +
      `last week's CRM activity vs this week's pipeline movement. Want me to surface that as a chart?`,
  );

  // Rotate by minute-of-day so consecutive cycles pick different angles.
  const idx = Math.floor(Date.now() / (15 * 60 * 1000)) % angles.length;
  return angles[idx];
}
