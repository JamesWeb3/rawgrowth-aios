import { supabaseAdmin } from "@/lib/supabase/server";
import { chatReply } from "@/lib/agent/chat";
import { extractAndCreateTasks } from "@/lib/agent/tasks";
import { buildAgentChatPreamble } from "@/lib/agent/preamble";
import { searchWeb, formatSearchBlock } from "@/lib/web-search/duckduckgo";
import { reviewSpawnedTasks } from "@/lib/insights/review";

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
    // Cold-start guard. With prior=0 the old code set base=1, so a
    // 0 -> 14 jump rendered as "+1400% week-over-week" - pure noise
    // from an org that just came online. A percentage delta needs a
    // real baseline; require prior >= MIN_BASELINE before treating
    // any move as an anomaly. Mirrors the total<3 guard in ratePct.
    const MIN_BASELINE = 3;
    if (prior < MIN_BASELINE) return null;
    const deltaPct = (current - prior) / prior;
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
    q = q
      .eq("department", dept as never)
      .eq("is_department_head", true);
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

/**
 * Council phase: pick 3 dept-head agents whose perspectives matter for
 * this anomaly + ask each one a tight one-paragraph "what's the most
 * likely cause from your angle" question. Used to enrich the main
 * synthesizer's preamble before it drafts the final ROOT CAUSE / PLAN
 * / CONFIRM block.
 *
 * Selection rules:
 *   - Atlas-level (department=null): Marketing + Sales + Operations heads.
 *   - Dept-level: the dept's own head + 2 adjacent heads (e.g.
 *     marketing → sales + operations; sales → marketing + operations).
 *
 * Returns ordered list of {agentId, agentName, deptLabel, perspective}.
 * Failures (missing head, model error) drop that voice quietly so the
 * synthesizer still gets the available perspectives instead of stalling.
 */
type CouncilVoice = {
  agentId: string;
  agentName: string;
  deptLabel: string;
  perspective: string;
};

const COUNCIL_ADJACENCY: Record<string, string[]> = {
  marketing: ["sales", "fulfilment"],
  sales: ["marketing", "fulfilment"],
  fulfilment: ["sales", "marketing"],
  finance: ["sales", "marketing"],
  development: ["fulfilment", "marketing"],
};

const DEPT_LABELS: Record<string, string> = {
  marketing: "Marketing Manager",
  sales: "Sales Manager",
  fulfilment: "Operations Manager",
  finance: "Finance Manager",
  development: "Engineering Manager",
};

async function consultCouncil(input: {
  orgId: string;
  orgName: string | null;
  department: string | null;
  title: string;
  metricLabel: string;
  direction: string;
  pctRound: number;
  prior: number;
  current: number;
}): Promise<CouncilVoice[]> {
  const { orgId, orgName, department } = input;

  let pickDepts: string[];
  if (department === null) {
    pickDepts = ["marketing", "sales", "fulfilment"];
  } else {
    const adj = COUNCIL_ADJACENCY[department] ?? ["marketing", "sales"];
    pickDepts = [department, ...adj].slice(0, 3);
  }

  const db = supabaseAdmin();
  const { data: heads } = await db
    .from("rgaios_agents")
    .select("id, name, department")
    .eq("organization_id", orgId)
    .eq("is_department_head", true)
    .in("department", pickDepts as never[]);
  const headRows = (heads ?? []) as Array<{
    id: string;
    name: string;
    department: string;
  }>;
  // Order to match pickDepts, keep first match per dept
  const byDept = new Map<string, { id: string; name: string }>();
  for (const h of headRows) {
    if (!byDept.has(h.department)) {
      byDept.set(h.department, { id: h.id, name: h.name });
    }
  }
  const ordered = pickDepts
    .map((d) => {
      const h = byDept.get(d);
      if (!h) return null;
      return {
        deptKey: d,
        deptLabel: DEPT_LABELS[d] ?? `${d} head`,
        agentId: h.id,
        agentName: h.name,
      };
    })
    .filter(
      (x): x is {
        deptKey: string;
        deptLabel: string;
        agentId: string;
        agentName: string;
      } => x !== null,
    );
  if (ordered.length === 0) return [];

  const promptFor = (deptLabel: string) =>
    `Quick read from your dept POV. Anomaly: ${input.title} (${input.metricLabel} moved ${input.direction} ${input.pctRound}% week-over-week, ${input.prior} -> ${input.current}). What's the most likely root cause from YOUR angle as ${deptLabel}? One paragraph max. No preamble, no plan, no tasks.`;

  const settled = await Promise.all(
    ordered.map(async (head) => {
      try {
        const preamble = await buildAgentChatPreamble({
          orgId,
          agentId: head.agentId,
          orgName,
          queryText: input.title,
        });
        const r = await chatReply({
          organizationId: orgId,
          organizationName: orgName,
          chatId: 0,
          userMessage: promptFor(head.deptLabel),
          publicAppUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
          agentId: head.agentId,
          historyOverride: [],
          extraPreamble: preamble,
          noHandoff: true,
          maxTokens: 350,
        });
        if (!r.ok) return null;
        const cleaned = r.reply
          .replace(/<task[\s\S]*?<\/task>/gi, "")
          .replace(/<need[\s\S]*?<\/need>/gi, "")
          .trim();
        if (!cleaned) return null;
        return {
          agentId: head.agentId,
          agentName: head.agentName,
          deptLabel: head.deptLabel,
          perspective: cleaned,
        } as CouncilVoice;
      } catch {
        return null;
      }
    }),
  );

  return settled.filter((x): x is CouncilVoice => x !== null);
}

async function persistCouncilAuditRows(
  orgId: string,
  voices: CouncilVoice[],
  insightIdHint: string | null,
): Promise<void> {
  if (voices.length === 0) return;
  const db = supabaseAdmin();
  try {
    await db.from("rgaios_audit_log").insert(
      voices.map((v) => ({
        organization_id: orgId,
        kind: "council_input",
        actor_type: "agent",
        actor_id: v.agentId,
        detail: {
          dept_head_agent_id: v.agentId,
          dept_label: v.deptLabel,
          content_excerpt: v.perspective.slice(0, 350),
          insight_id: insightIdHint,
        },
      })) as never,
    );
  } catch {
    // best-effort - audit failure should not block the insight pipeline
  }
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
    const titleEarly = `${label.charAt(0).toUpperCase() + label.slice(1)} ${direction} ${pctRound}% week-over-week`;

    // Council phase. Skip for positive (non-worse) anomalies to avoid
    // 4x chatReply cost on every minor improvement. The synthesizer
    // still runs - it just doesn't get a council preamble block.
    let councilVoices: CouncilVoice[] = [];
    if (s.worse) {
      try {
        councilVoices = await consultCouncil({
          orgId: input.orgId,
          orgName: agent.orgName,
          department: input.department,
          title: titleEarly,
          metricLabel: label,
          direction,
          pctRound,
          prior: s.prior,
          current: s.current,
        });
        // Persist council inputs immediately - insight id is unknown at
        // this point, so we leave it null and let the trace endpoint
        // stitch via timestamp window + actor_id.
        await persistCouncilAuditRows(input.orgId, councilVoices, null);
      } catch (err) {
        console.warn(
          `[insights] council phase failed: ${(err as Error).message}`,
        );
      }
    }

    const userMessage = `URGENT METRIC ALERT. ${label} for ${input.department ?? "the org"} moved ${direction} ${pctRound}% in the last 7 days vs the prior 7 (${s.prior} → ${s.current}).

Your job, as ${input.department ? "department head" : "CEO coordinator"}:

1. **Root cause** (1 short paragraph) - what specifically caused this shift? Look at the company corpus, your past memories, recent task outputs, and brand context above. Don't guess generically; cite something concrete.

2. **Coordinated action plan** - propose a SHORT plan that uses your sub-agents and peers. Use <task> blocks to assign concrete deliverables. Each sub-task must:
   - go to a real agent (use assignee="<role>" - check your Org Place above for who reports to you and who else exists in the org)
   - have a deliverable the operator can SEE (a doc, a number, a draft, a checklist), not "explore X"
   - have enough context that the assignee can start without asking back

3. **Confirmation question to the human** (1 line) - the human is in the loop for accountability. Ask them ONE specific yes/no or short-answer question that gates the plan (e.g. "Spending up to $5k on creative this week - approve?"). Phrase it so a busy founder can answer in 5 seconds.

Format your answer like:

ROOT CAUSE: ...

PLAN:
<task assignee="role-or-self">
Title: ...
Description: ...
</task>
<task assignee="...">
Title: ...
Description: ...
</task>

CONFIRM: ...?

No SaaS clichés. Concrete numbers. Brand voice on.`;

    let reason = "";
    let suggested = "";
    let agentReply = "";
    try {
      // Build full preamble so agent has brand + memory + RAG + org place
      // when reasoning about the anomaly. That's what makes the answer
      // grounded instead of generic.
      let preamble = await buildAgentChatPreamble({
        orgId: input.orgId,
        agentId: agent.id,
        orgName: agent.orgName,
        queryText: userMessage,
      });

      // Web context: pull DDG top results for the metric + dept so
      // the agent reasons against current market signal, not just
      // internal data. Best-effort - skipped on network failure.
      const searchQuery = `${input.department ?? "service business"} ${label} drop ${pctRound}% root cause 2026`;
      try {
        const webResults = await searchWeb(searchQuery, 4);
        const block = formatSearchBlock(searchQuery, webResults);
        if (block) preamble += `\n\n${block}`;
      } catch {}

      // Council perspectives - inject before the synthesizer call so
      // it can reconcile angles instead of guessing in isolation. Cap
      // each voice at 350 chars to keep the preamble bounded.
      if (councilVoices.length > 0) {
        const council = councilVoices
          .map(
            (v) =>
              `<${v.deptLabel}>: ${v.perspective.replace(/\s+/g, " ").slice(0, 350)}`,
          )
          .join("\n");
        preamble +=
          `\n\nCouncil perspectives (each dept head's quick read on this anomaly - synthesize across them, do NOT just pick one):\n${council}`;
      }
      const r = await chatReply({
        organizationId: input.orgId,
        organizationName: agent.orgName,
        chatId: 0,
        userMessage,
        publicAppUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
        agentId: agent.id,
        historyOverride: [],
        extraPreamble: preamble,
        noHandoff: true,
        maxTokens: 3000,
      });
      if (!r.ok) {
        errors.push(`agent ${agent.name}: ${r.error.slice(0, 120)}`);
        continue;
      }

      // Stash the raw reply for task extraction AFTER the insight row
      // is inserted (we need the insight id to tag every task_created
      // audit row so the review loop can find them later).
      agentReply = r.reply;

      // Strip <task> blocks from the visible reason/action so the UI
      // card doesn't render raw XML.
      const stripped = r.reply.replace(/<task[\s\S]*?<\/task>/gi, "").trim();
      const root = stripped.match(/ROOT CAUSE:\s*([\s\S]+?)(?=\n\n?(?:PLAN|CONFIRM):|\n\n?$|$)/i);
      const confirm = stripped.match(/CONFIRM:\s*([\s\S]+?)$/i);
      const planText = stripped
        .replace(/ROOT CAUSE:[\s\S]+?(?=PLAN:|CONFIRM:|$)/i, "")
        .replace(/CONFIRM:[\s\S]+$/i, "")
        .replace(/^PLAN:\s*/i, "")
        .trim();

      reason = root ? root[1].trim() : stripped.split(/\n\n/)[0] ?? "";
      suggested = [planText, confirm ? `\n\n**Question for you:** ${confirm[1].trim()}` : ""]
        .filter(Boolean)
        .join("")
        .trim();
      if (!suggested) suggested = stripped.slice(0, 600);
    } catch (err) {
      errors.push((err as Error).message.slice(0, 120));
      continue;
    }

    const severity = s.worse
      ? Math.abs(s.deltaPct) > 0.5
        ? "critical"
        : "warning"
      : "positive";
    const title = titleEarly;

    const { data: insertedRow } = await db
      .from("rgaios_insights")
      .insert({
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
      } as never)
      .select("id")
      .single();
    const insightId = (insertedRow as { id?: string } | null)?.id;

    // Extract <task> blocks -> real routines + runs -> executor fires.
    // Multi-agent coordination happens here: each <task> in the agent's
    // reply spawns a routine assigned to whichever sub-agent the agent
    // named. The executeChatTask path will run them async via after().
    if (agentReply) {
      try {
        await extractAndCreateTasks({
          orgId: input.orgId,
          speakerAgentId: agent.id,
          reply: agentReply,
          insightId,
        });
      } catch (err) {
        console.warn(
          `[insights] task extraction failed: ${(err as Error).message}`,
        );
      }
    }

    // PROACTIVE chat: every insight - regardless of which agent
    // surfaced it - drops a system message into the agent's chat
    // thread so the bell + /files Agent messages widget light up.
    // Pedro's rule (2026-05-05): "tem que aparecer em notificação".
    // Plain prose, no emoji, links to /updates.
    try {
      if (insightId) {
        const proactiveMsg =
          `Heads up - I just flagged a ${severity} anomaly: ${title}.\n\n` +
          `Reason: ${reason.slice(0, 300)}${reason.length > 300 ? "..." : ""}\n\n` +
          `Drafted plan + ${s.worse ? "approval needed" : "FYI"} in Updates. Open it via the sidebar or hit me here if you want to debate the angle.`;
        await db.from("rgaios_agent_chat_messages").insert({
          organization_id: input.orgId,
          agent_id: agent.id,
          user_id: null,
          role: "assistant",
          content: proactiveMsg,
          metadata: {
            kind: "proactive_anomaly",
            insight_id: insightId,
            department: input.department ?? null,
          },
        } as never);
      }
    } catch {
      // best-effort - the insight is the source of truth, chat is bonus
    }

    created += 1;
  }

  return { created, skipped, errors };
}

/**
 * Sweep every department + atlas-level (cross-dept). Used by the cron
 * route + by the admin "Generate insights now" button.
 *
 * Also walks every still-open critical/warning insight: auto-resolves
 * if the metric recovered, retries the agent action otherwise. That's
 * the "keep working until fixed" loop.
 */
const RETRY_INTERVAL_H =
  Number(process.env.INSIGHTS_RETRY_INTERVAL_HOURS) || 24;

export async function sweepAllDepts(orgId: string): Promise<{
  created: number;
  skipped: number;
  resolved: number;
  retried: number;
  reviewed: number;
  rerouted: number;
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
  const atl = await generateInsightsForDept({ orgId, department: null });
  created += atl.created;
  skipped += atl.skipped;
  errors.push(...atl.errors);

  const loop = await checkAndRetryOpen(orgId);

  // Atlas error router: triage failed tasks last 24h + reassign / retry
  let routed = { failed: 0, rerouted: 0, errors: [] as string[] };
  try {
    const { routeFailures } = await import("@/lib/atlas/router");
    routed = await routeFailures(orgId, 24);
  } catch (err) {
    routed.errors.push((err as Error).message.slice(0, 200));
  }

  return {
    created,
    skipped,
    resolved: loop.resolved,
    retried: loop.retried,
    reviewed: loop.reviewed,
    rerouted: routed.rerouted,
    errors: [...errors, ...loop.errors, ...routed.errors],
  };
}

/**
 * For an 'executing' insight, decide whether every spawned task is in
 * a terminal state (succeeded | failed). Only when all are done does
 * the review fire - we don't want to grade a half-finished batch.
 */
async function allSpawnedTasksDone(
  orgId: string,
  insightId: string,
): Promise<boolean> {
  const db = supabaseAdmin();
  const { data: auditRows } = await db
    .from("rgaios_audit_log")
    .select("detail")
    .eq("organization_id", orgId)
    .eq("kind", "task_created")
    .filter("detail->>insight_id", "eq", insightId);
  const routineIds = new Set<string>();
  for (const row of (auditRows ?? []) as Array<{
    detail: Record<string, unknown> | null;
  }>) {
    const rid = row.detail?.routine_id;
    if (typeof rid === "string") routineIds.add(rid);
  }
  if (routineIds.size === 0) return false;
  const { data: runs } = await db
    .from("rgaios_routine_runs")
    .select("routine_id, status, created_at")
    .eq("organization_id", orgId)
    .in("routine_id", [...routineIds])
    .order("created_at", { ascending: false });
  type RunRow = { routine_id: string; status: string };
  const latest = new Map<string, string>();
  for (const r of (runs ?? []) as RunRow[]) {
    if (!latest.has(r.routine_id)) latest.set(r.routine_id, r.status);
  }
  if (latest.size < routineIds.size) return false;
  for (const status of latest.values()) {
    if (status !== "succeeded" && status !== "failed") return false;
  }
  return true;
}

async function checkAndRetryOpen(orgId: string): Promise<{
  resolved: number;
  retried: number;
  reviewed: number;
  errors: string[];
}> {
  const db = supabaseAdmin();
  // Walk both 'open' (never approved) and 'executing' (approved + tasks
  // running) anomalies. Review only fires on 'executing' once tasks
  // have all settled; retry only fires on 'open' (or REFINE verdict).
  const { data: openRows } = await db
    .from("rgaios_insights")
    .select(
      "id, department, metric, severity, status, loop_count, last_attempt_at, generated_by_agent_id",
    )
    .eq("organization_id", orgId)
    .in("status", ["open", "executing"])
    .in("severity", ["critical", "warning"]);

  type R = {
    id: string;
    department: string | null;
    metric: string;
    severity: string;
    status: string;
    loop_count: number;
    last_attempt_at: string | null;
    generated_by_agent_id: string | null;
  };
  const open = (openRows ?? []) as R[];
  let resolved = 0;
  let retried = 0;
  let reviewed = 0;
  const errors: string[] = [];

  for (const ins of open) {
    const snaps = await snapshotForDept(orgId, ins.department);
    const same = snaps.find((s) => s.metric === ins.metric);

    // For executing insights, REVIEW first so the verdict feeds the
    // resolve/retry decision below. Skip when crashed - the loop
    // continues with whatever signal we have.
    let reviewVerdict: "PASS" | "REFINE" | null = null;
    let reviewFeedback = "";
    if (ins.status === "executing") {
      const allDone = await allSpawnedTasksDone(orgId, ins.id);
      if (!allDone) continue;
      try {
        const review = await reviewSpawnedTasks(orgId, ins.id);
        if (review) {
          reviewVerdict = review.verdict;
          reviewFeedback = review.scores
            .filter((s) => s.score < 3)
            .map((s) => s.feedback)
            .filter(Boolean)
            .join(" | ");
          reviewed += 1;
        }
      } catch {
        // Skip if review crashes - insight stays in current state.
      }
    }

    if (!same && (reviewVerdict === "PASS" || ins.status === "open")) {
      // Metric recovered (and review passed if applicable) - close
      // the alarm. For 'open' insights without review, recovery alone
      // is enough to resolve.
      await db
        .from("rgaios_insights")
        .update({
          status: "resolved",
          resolved_at: new Date().toISOString(),
        } as never)
        .eq("id", ins.id);
      await db.from("rgaios_audit_log").insert({
        organization_id: orgId,
        kind: "insight_resolved",
        actor_type: "system",
        actor_id: "insights-loop",
        detail: {
          insight_id: ins.id,
          metric: ins.metric,
          loop_count: ins.loop_count,
          review_verdict: reviewVerdict,
        },
      } as never);
      resolved += 1;
      continue;
    }

    // REFINE verdict from review trumps the throttle: spin a fresh
    // retry with the review feedback so the next iteration is
    // gap-aware.
    if (reviewVerdict === "REFINE") {
      try {
        await retryInsight(
          orgId,
          ins.id,
          ins.department,
          ins.metric,
          ins.loop_count,
          reviewFeedback
            ? `Review found these gaps: ${reviewFeedback}`
            : undefined,
        );
        retried += 1;
      } catch (err) {
        errors.push((err as Error).message.slice(0, 120));
      }
      continue;
    }

    const lastTry = ins.last_attempt_at ? Date.parse(ins.last_attempt_at) : 0;
    if (Date.now() - lastTry < RETRY_INTERVAL_H * 60 * 60 * 1000) continue;

    // Plain time-throttled retry (no review or review unavailable).
    if (ins.status === "open") {
      try {
        await retryInsight(orgId, ins.id, ins.department, ins.metric, ins.loop_count);
        retried += 1;
      } catch (err) {
        errors.push((err as Error).message.slice(0, 120));
      }
    }
  }
  return { resolved, retried, reviewed, errors };
}

// Karpathy autoresearch cap. After N retries without resolving, escalate
// to the human owner instead of looping forever and burning tokens.
const MAX_AUTORESEARCH_LOOPS = 30;

export async function retryInsight(
  orgId: string,
  insightId: string,
  dept: string | null,
  metric: string,
  loopCount: number,
  extraContext?: string,
): Promise<void> {
  const db = supabaseAdmin();

  // Hard cap: escalate to human after MAX_AUTORESEARCH_LOOPS attempts.
  if (loopCount >= MAX_AUTORESEARCH_LOOPS) {
    await db
      .from("rgaios_insights")
      .update({
        status: "escalated",
        escalated_at: new Date().toISOString(),
      } as never)
      .eq("id", insightId);
    await db.from("rgaios_audit_log").insert({
      organization_id: orgId,
      kind: "insight_escalated_loop_cap",
      actor_type: "system",
      actor_id: "insights-loop",
      detail: { insight_id: insightId, loop_count: loopCount, metric },
    } as never);
    // Surface to bell so Pedro sees the escalation immediately.
    const { data: ceo } = await db
      .from("rgaios_agents")
      .select("id")
      .eq("organization_id", orgId)
      .eq("role", "ceo")
      .maybeSingle();
    const ceoId = (ceo as unknown as { id: string } | null)?.id;
    if (ceoId) {
      await db.from("rgaios_agent_chat_messages").insert({
        organization_id: orgId,
        agent_id: ceoId,
        user_id: null,
        role: "assistant",
        content: `**Escalation - autoresearch cap hit**\n\nMetric "${metric}" for ${dept ?? "the org"} ran ${MAX_AUTORESEARCH_LOOPS} retry cycles without resolving. I'm escalating to you - this is outside what I can fix on my own. Want me to draft a different angle, or should we shelve it?`,
        metadata: {
          kind: "proactive_anomaly",
          insight_id: insightId,
          escalation: "loop_cap",
        },
      } as never);
    }
    return;
  }

  const agent = await findAgentForDept(orgId, dept);
  if (!agent) return;

  const label = METRIC_LABELS[metric] ?? metric;
  const contextLine = extraContext?.trim()
    ? `\n\n${extraContext.trim()}`
    : "";
  const userMessage = `RETRY ${loopCount + 1}. The metric "${label}" for ${dept ?? "the org"} is STILL outside the safe range after your previous attempt didn't fix it.${contextLine}

Look at what tasks you spawned last time (in your pending tasks list above). What didn't work? Why? Propose a NEW coordinated plan with <task> blocks - different deliverables, different sub-agents if needed. Don't repeat what already failed.

Format same as before: ROOT CAUSE / PLAN with <task> blocks / CONFIRM. Concrete, brand voice on.`;

  const preamble = await buildAgentChatPreamble({
    orgId,
    agentId: agent.id,
    orgName: agent.orgName,
    queryText: userMessage,
  });
  const r = await chatReply({
    organizationId: orgId,
    organizationName: agent.orgName,
    chatId: 0,
    userMessage,
    publicAppUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
    agentId: agent.id,
    historyOverride: [],
    extraPreamble: preamble,
    noHandoff: true,
    maxTokens: 3000,
  });
  if (!r.ok) throw new Error(r.error);

  try {
    await extractAndCreateTasks({
      orgId,
      speakerAgentId: agent.id,
      reply: r.reply,
      insightId,
    });
  } catch {}

  const stripped = r.reply.replace(/<task[\s\S]*?<\/task>/gi, "").trim();
  await db
    .from("rgaios_insights")
    .update({
      loop_count: loopCount + 1,
      last_attempt_at: new Date().toISOString(),
      reason: stripped.slice(0, 800),
    } as never)
    .eq("id", insightId);
}
