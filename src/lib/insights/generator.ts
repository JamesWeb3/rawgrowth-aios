import { supabaseAdmin } from "@/lib/supabase/server";
import { chatReply } from "@/lib/agent/chat";

/**
 * Per-department metric anomaly detector + agent drill-down.
 *
 * Pipeline:
 *   1. Pull current 7d window vs prior 7d window for the dept's
 *      key metrics (runs succeeded/failed, agent activity, approvals).
 *   2. For each metric whose delta crosses the threshold, ask the
 *      dept-head agent (or Atlas for cross-dept) via chatReply to
 *      drill down on the reason + propose a concrete next action.
 *   3. Insert one rgaios_insights row per finding so the dashboard
 *      Insights panel surfaces it.
 *
 * Idempotent over the 24h window: the writer skips a (dept, metric)
 * pair that already has an open or recently dismissed row, so
 * re-running the cron doesn't spam duplicate cards.
 */

const ANOMALY_THRESHOLD = 0.20; // 20%+ change

type MetricSnapshot = {
  metric: string;
  current: number;
  prior: number;
  deltaPct: number;
  worse: boolean;
};

const METRIC_LABELS: Record<string, string> = {
  runs_succeeded: "successful agent runs",
  runs_failed: "failed agent runs",
  agent_activity: "agent activity events",
  approvals_pending: "pending approvals",
  conversion_rate: "task conversion rate (succeeded / total)",
  completion_rate: "task completion rate (executed / created)",
};

async function snapshotForDept(
  orgId: string,
  dept: string | null,
): Promise<MetricSnapshot[]> {
  const db = supabaseAdmin();
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const since7 = new Date(now - 7 * day).toISOString();
  const since14 = new Date(now - 14 * day).toISOString();

  // Get agent ids for this dept (or all agents for cross-dept Atlas)
  let agentIds: string[] = [];
  let q = db.from("rgaios_agents").select("id").eq("organization_id", orgId);
  if (dept) q = q.eq("department", dept);
  const { data: agents } = await q;
  agentIds = ((agents ?? []) as Array<{ id: string }>).map((a) => a.id);
  if (agentIds.length === 0) return [];

  // Routine ids assigned to those agents
  const { data: routines } = await db
    .from("rgaios_routines")
    .select("id")
    .eq("organization_id", orgId)
    .in("assignee_agent_id", agentIds);
  const routineIds = ((routines ?? []) as Array<{ id: string }>).map((r) => r.id);

  // Runs current vs prior
  const counts = async (
    status: string,
    fromIso: string,
    toIso: string,
  ): Promise<number> => {
    if (routineIds.length === 0) return 0;
    const { count } = await db
      .from("rgaios_routine_runs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", status)
      .in("routine_id", routineIds)
      .gte("created_at", fromIso)
      .lt("created_at", toIso);
    return count ?? 0;
  };
  const nowIso = new Date(now).toISOString();
  const succCurrent = await counts("succeeded", since7, nowIso);
  const succPrior = await counts("succeeded", since14, since7);
  const failCurrent = await counts("failed", since7, nowIso);
  const failPrior = await counts("failed", since14, since7);

  // Activity (audit log task_executed + chat_memory)
  const activityCount = async (fromIso: string, toIso: string) => {
    const { count } = await db
      .from("rgaios_audit_log")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .in("kind", ["task_executed", "task_created", "chat_memory"])
      .filter("detail->>agent_id", "in", `(${agentIds.map((id) => `"${id}"`).join(",")})`)
      .gte("ts", fromIso)
      .lt("ts", toIso);
    return count ?? 0;
  };
  const actCurrent = await activityCount(since7, nowIso);
  const actPrior = await activityCount(since14, since7);

  function pack(
    metric: string,
    current: number,
    prior: number,
    higherIsBetter: boolean,
  ): MetricSnapshot | null {
    if (prior === 0 && current === 0) return null;
    const base = prior === 0 ? 1 : prior;
    const deltaPct = (current - prior) / base;
    const worse = higherIsBetter ? deltaPct < 0 : deltaPct > 0;
    if (Math.abs(deltaPct) < ANOMALY_THRESHOLD) return null;
    return { metric, current, prior, deltaPct, worse };
  }

  // Conversion rate = succeeded / (succeeded + failed). Skip when
  // total is < 3 (small-sample noise drowns the signal).
  function ratePct(suc: number, fail: number): number | null {
    const total = suc + fail;
    if (total < 3) return null;
    return suc / total;
  }
  const convCurrent = ratePct(succCurrent, failCurrent);
  const convPrior = ratePct(succPrior, failPrior);

  function packRate(
    metric: string,
    current: number | null,
    prior: number | null,
  ): MetricSnapshot | null {
    if (current === null || prior === null) return null;
    if (prior === 0 && current === 0) return null;
    const deltaPct = current - prior; // absolute pp change
    if (Math.abs(deltaPct) < 0.1) return null; // require ≥10pp move
    return {
      metric,
      current: Math.round(current * 1000) / 10,
      prior: Math.round(prior * 1000) / 10,
      deltaPct,
      worse: deltaPct < 0,
    };
  }

  return [
    pack("runs_succeeded", succCurrent, succPrior, true),
    pack("runs_failed", failCurrent, failPrior, false),
    pack("agent_activity", actCurrent, actPrior, true),
    packRate("conversion_rate", convCurrent, convPrior),
  ].filter((s): s is MetricSnapshot => s !== null);
}

async function findAgentForDept(
  orgId: string,
  dept: string | null,
): Promise<{ id: string; name: string; orgName: string | null } | null> {
  const db = supabaseAdmin();
  const { data: org } = await db
    .from("rgaios_organizations")
    .select("name")
    .eq("id", orgId)
    .maybeSingle();
  const orgName = (org as { name: string } | null)?.name ?? null;

  let q = db
    .from("rgaios_agents")
    .select("id, name")
    .eq("organization_id", orgId);
  if (dept) {
    q = q.eq("department", dept).eq("is_department_head", true);
  } else {
    q = q.eq("role", "ceo");
  }
  const { data } = await q.limit(1).maybeSingle();
  if (!data) return null;
  return {
    id: (data as { id: string }).id,
    name: (data as { name: string }).name,
    orgName,
  };
}

export async function generateInsightsForDept(input: {
  orgId: string;
  department: string | null;
}): Promise<{ created: number; skipped: number; errors: string[] }> {
  const db = supabaseAdmin();
  const snapshots = await snapshotForDept(input.orgId, input.department);
  if (snapshots.length === 0) return { created: 0, skipped: 0, errors: [] };

  const agent = await findAgentForDept(input.orgId, input.department);
  if (!agent) {
    return {
      created: 0,
      skipped: snapshots.length,
      errors: [`no agent for dept=${input.department ?? "atlas"}`],
    };
  }

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  for (const s of snapshots) {
    // Dedup: skip if this (dept, metric) already has an open insight
    // OR was dismissed in the last 24h
    const { data: existing } = await db
      .from("rgaios_insights")
      .select("id, status")
      .eq("organization_id", input.orgId)
      .eq("department", input.department ?? "")
      .eq("metric", s.metric)
      .or(`status.eq.open,dismissed_at.gte.${since24h}`)
      .limit(1)
      .maybeSingle();
    if (existing) {
      skipped += 1;
      continue;
    }

    const direction = s.deltaPct > 0 ? "up" : "down";
    const pctRound = Math.round(Math.abs(s.deltaPct) * 100);
    const label = METRIC_LABELS[s.metric] ?? s.metric;
    const userMessage = `Quick analysis. Last 7 days, ${label} for ${input.department ?? "the org"} are ${direction} ${pctRound}% versus the prior 7 days (${s.prior} → ${s.current}). Two paragraphs only:

1. **Reason** — best guess at the root cause based on what's happening in this org's recent activity, brand profile, and your own track record. Be concrete, no SaaS clichés.
2. **Suggested action** — one specific next step the operator should take this week. Concrete deliverable, not "explore" or "investigate".`;

    let reason = "";
    let suggested = "";
    try {
      const r = await chatReply({
        organizationId: input.orgId,
        organizationName: agent.orgName,
        chatId: 0,
        userMessage,
        publicAppUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
        agentId: agent.id,
        historyOverride: [],
        extraPreamble: "",
        noHandoff: true,
        maxTokens: 1500,
      });
      if (!r.ok) {
        errors.push(`agent ${agent.name}: ${r.error.slice(0, 120)}`);
        continue;
      }
      // Best-effort split: look for "Suggested action" header, otherwise
      // first paragraph = reason, rest = suggested.
      const text = r.reply.trim();
      const splitMatch = text.match(/(.+?)\n\n.*?suggested action[\s\S]+?\n\n?([\s\S]+)/i);
      if (splitMatch) {
        reason = splitMatch[1].trim();
        suggested = splitMatch[2].trim();
      } else {
        const paragraphs = text.split(/\n\n+/);
        reason = paragraphs[0] ?? text.slice(0, 600);
        suggested = paragraphs.slice(1).join("\n\n").trim() || "(see reason)";
      }
    } catch (err) {
      errors.push((err as Error).message.slice(0, 120));
      continue;
    }

    const severity = s.worse
      ? Math.abs(s.deltaPct) > 0.5
        ? "critical"
        : "warning"
      : "positive";
    const title = `${label.charAt(0).toUpperCase() + label.slice(1)} ${direction} ${pctRound}% week-over-week`;

    await db.from("rgaios_insights").insert({
      organization_id: input.orgId,
      department: input.department,
      kind: s.worse ? "anomaly" : "opportunity",
      severity,
      metric: s.metric,
      current_value: s.current,
      prior_value: s.prior,
      delta_pct: s.deltaPct,
      title,
      reason,
      suggested_action: suggested,
      generated_by_agent_id: agent.id,
    } as never);
    created += 1;
  }

  return { created, skipped, errors };
}

/**
 * Sweep every department + atlas-level (cross-dept). Used by the cron
 * route + by the admin "Generate insights now" button.
 */
export async function sweepAllDepts(orgId: string): Promise<{
  created: number;
  skipped: number;
  errors: string[];
}> {
  const depts = ["marketing", "sales", "fulfilment", "finance", "development"];
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const d of depts) {
    const r = await generateInsightsForDept({ orgId, department: d });
    created += r.created;
    skipped += r.skipped;
    errors.push(...r.errors);
  }
  // Atlas (cross-dept)
  const r = await generateInsightsForDept({ orgId, department: null });
  created += r.created;
  skipped += r.skipped;
  errors.push(...r.errors);
  return { created, skipped, errors };
}
