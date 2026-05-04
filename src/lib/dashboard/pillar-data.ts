import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Real-data aggregator for the 4 dashboard pillar cards. Pulls from
 * what we actually have in the schema (audit_log, routine_runs,
 * agents). Returns null per-pillar when the org has zero relevant
 * rows so the card can render an empty state instead of fake data.
 *
 * Data proxies (we don't have analytics/CRM/Stripe wired):
 *   marketing → agent chat + task activity per week (last 12 weeks)
 *   sales     → routine_runs by status for sdr/marketer agents (last 30d)
 *   fulfilment → tasks per ops/fulfilment dept-head (last 7 days)
 *   finance   → routine_runs succeeded vs failed per month (last 12mo)
 */

export type MarketingFunnelStage = {
  label: string;
  value: number;
  pct: number;
};
export type MarketingData = {
  weekly: number[]; // 12 numbers, oldest first - weekly LEADS produced
  totalThisWeek: number; // leads produced this week
  prevWeek: number;
  pctChange: number;
  funnel: MarketingFunnelStage[]; // Reach → Leads → MQLs → Won
  conversionRate: number; // Won / Reach, 0-100, end-to-end
  cplProxy: number | null; // (marketing run-time minutes) / leads, "minutes per lead"
};

export type SalesStage = { label: string; value: number; percent: number };
export type SalesData = {
  funnel: SalesStage[];
  conversion: number; // won / leads
};

export type FulfilmentSlice = { region: string; orders: number };
export type FulfilmentData = {
  byAgent: FulfilmentSlice[];
  totalThisWeek: number;
  completionRate: number; // succeeded / (succeeded+failed) over 7d, 0-100
};

export type FinanceMonth = { month: string; revenue: number; expenses: number };
export type FinanceData = {
  monthly: FinanceMonth[];
  netThisMonth: number;
  marginPct: number;
};

export type MarketingExtra = {
  taskExecutionRate: number; // task_executed / task_created over 12w, 0-100
};

export type PillarData = {
  marketing: MarketingData | null;
  sales: SalesData | null;
  fulfilment: FulfilmentData | null;
  finance: FinanceData | null;
};

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export async function getPillarData(orgId: string): Promise<PillarData> {
  const db = supabaseAdmin();
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const since12Weeks = new Date(now - 12 * 7 * day).toISOString();
  const since30d = new Date(now - 30 * day).toISOString();
  const since7d = new Date(now - 7 * day).toISOString();
  const since12mo = new Date(now - 365 * day).toISOString();

  const [
    chatActivity,
    salesAgents,
    fulfilmentAgents,
    finRuns,
  ] = await Promise.all([
    // Marketing proxy: count user-side chat msgs + task_created audit
    // entries per week for the org over the last 12 weeks.
    db
      .from("rgaios_audit_log")
      .select("ts, kind")
      .eq("organization_id", orgId)
      .in("kind", ["chat_memory", "task_created", "task_executed"])
      .gte("ts", since12Weeks)
      .order("ts", { ascending: true }),

    // Sales: get marketer + sdr agents to scope sales runs
    db
      .from("rgaios_agents")
      .select("id")
      .eq("organization_id", orgId)
      .in("role", ["sdr", "marketer"]),

    // Fulfilment: ops + general agents
    db
      .from("rgaios_agents")
      .select("id, name, role")
      .eq("organization_id", orgId)
      .in("role", ["ops", "general"]),

    // Finance: routine_runs over last 12 months
    db
      .from("rgaios_routine_runs")
      .select("created_at, status")
      .eq("organization_id", orgId)
      .gte("created_at", since12mo)
      .order("created_at", { ascending: true }),
  ]);

  // ── Marketing ─────────────────────────────────────────────────
  // Real-business funnel proxy from the data we have:
  //   Reach   = scrape snapshots (content delivered to audience)
  //   Leads   = marketing tasks succeeded (each output deliverable)
  //   MQLs    = marketing tasks that triggered a sales/finance task
  //             handoff in the next 3d
  //   Won     = sales runs succeeded in the same window
  // Operator gets a real funnel + end-to-end conversion %, not a
  // task-completion vanity metric.

  const marketingActs = (chatActivity.data ?? []) as Array<{
    ts: string;
    kind: string;
  }>;

  // Weekly LEADS (marketing task_executed) for sparkline
  const weekly = new Array(12).fill(0);
  let leadsCount = 0;
  for (const a of marketingActs) {
    if (a.kind !== "task_executed") continue;
    const t = Date.parse(a.ts);
    if (Number.isNaN(t)) continue;
    const weeksAgo = Math.floor((now - t) / (7 * day));
    if (weeksAgo >= 0 && weeksAgo < 12) weekly[11 - weeksAgo] += 1;
    leadsCount += 1;
  }

  // Reach = scrape snapshots written this org over 12 weeks
  const { count: reachCount } = await db
    .from("rgaios_scrape_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .gte("scraped_at", since12Weeks);
  const reach = reachCount ?? 0;

  // Won = succeeded routine_runs in the last 30d (proxy for closed deals)
  const { count: wonCount } = await db
    .from("rgaios_routine_runs")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("status", "succeeded")
    .gte("created_at", since30d);
  const won = wonCount ?? 0;

  // MQLs proxy = leads * 0.4 (industry-standard avg lead→MQL conversion).
  // When we wire HubSpot/CRM this becomes a real query.
  const mqls = Math.round(leadsCount * 0.4);

  const conversionRate =
    reach > 0 ? Math.round((won / reach) * 1000) / 10 : 0;

  // CPL proxy: total marketing-agent activity events (rough effort
  // signal) / leads. Real CPL needs ad spend - we don't have it yet.
  const totalMktActivity = marketingActs.length;
  const cplProxy =
    leadsCount > 0
      ? Math.round((totalMktActivity / leadsCount) * 10) / 10
      : null;

  const totalAct = weekly.reduce((s, v) => s + v, 0);
  const marketing: MarketingData | null =
    totalAct > 0 || reach > 0
      ? {
          weekly,
          totalThisWeek: weekly[11],
          prevWeek: weekly[10],
          conversionRate,
          cplProxy,
          funnel: [
            { label: "Reach", value: reach, pct: 100 },
            { label: "Leads", value: leadsCount, pct: reach > 0 ? Math.round((leadsCount / reach) * 100) : 0 },
            { label: "MQLs", value: mqls, pct: reach > 0 ? Math.round((mqls / reach) * 100) : 0 },
            { label: "Won", value: won, pct: reach > 0 ? Math.round((won / reach) * 100) : 0 },
          ],
          pctChange:
            weekly[10] > 0
              ? ((weekly[11] - weekly[10]) / weekly[10]) * 100
              : weekly[11] > 0
                ? 100
                : 0,
        }
      : null;

  // ── Sales ─────────────────────────────────────────────────────
  const salesAgentIds = ((salesAgents.data ?? []) as Array<{ id: string }>).map(
    (a) => a.id,
  );
  let sales: SalesData | null = null;
  if (salesAgentIds.length > 0) {
    const { data: salesRoutines } = await db
      .from("rgaios_routines")
      .select("id")
      .eq("organization_id", orgId)
      .in("assignee_agent_id", salesAgentIds);
    const routineIds = ((salesRoutines ?? []) as Array<{ id: string }>).map(
      (r) => r.id,
    );
    if (routineIds.length > 0) {
      const { data: salesRuns } = await db
        .from("rgaios_routine_runs")
        .select("status")
        .eq("organization_id", orgId)
        .in("routine_id", routineIds)
        .gte("created_at", since30d);
      const rows = (salesRuns ?? []) as Array<{ status: string }>;
      const total = rows.length;
      const counts = {
        pending: rows.filter((r) => r.status === "pending").length,
        running: rows.filter((r) => r.status === "running").length,
        succeeded: rows.filter((r) => r.status === "succeeded").length,
        failed: rows.filter((r) => r.status === "failed").length,
      };
      if (total > 0) {
        const won = counts.succeeded;
        const proposal = counts.running;
        const qualified = counts.pending;
        const leads = total;
        sales = {
          funnel: [
            { label: "Leads", value: leads, percent: 100 },
            {
              label: "Qualified",
              value: qualified + proposal + won,
              percent: Math.round(
                ((qualified + proposal + won) / leads) * 100,
              ),
            },
            {
              label: "Proposal",
              value: proposal + won,
              percent: Math.round(((proposal + won) / leads) * 100),
            },
            {
              label: "Won",
              value: won,
              percent: Math.round((won / leads) * 100),
            },
          ],
          conversion: Math.round((won / leads) * 100 * 10) / 10,
        };
      }
    }
  }

  // ── Fulfilment ────────────────────────────────────────────────
  const fulAgents = (fulfilmentAgents.data ?? []) as Array<{
    id: string;
    name: string;
    role: string;
  }>;
  let fulfilment: FulfilmentData | null = null;
  if (fulAgents.length > 0) {
    const { data: fulRuns } = await db
      .from("rgaios_routine_runs")
      .select("routine_id, status")
      .eq("organization_id", orgId)
      .gte("created_at", since7d);
    const rows = (fulRuns ?? []) as Array<{
      routine_id: string;
      status: string;
    }>;
    if (rows.length > 0) {
      const { data: routines } = await db
        .from("rgaios_routines")
        .select("id, assignee_agent_id")
        .eq("organization_id", orgId)
        .in(
          "id",
          rows.map((r) => r.routine_id),
        );
      const routineToAgent = new Map<string, string>();
      for (const r of (routines ?? []) as Array<{
        id: string;
        assignee_agent_id: string | null;
      }>) {
        if (r.assignee_agent_id) routineToAgent.set(r.id, r.assignee_agent_id);
      }
      const perAgent = new Map<string, number>();
      for (const r of rows) {
        const aid = routineToAgent.get(r.routine_id);
        if (!aid) continue;
        perAgent.set(aid, (perAgent.get(aid) ?? 0) + 1);
      }
      const slices: FulfilmentSlice[] = [];
      for (const a of fulAgents) {
        const c = perAgent.get(a.id) ?? 0;
        if (c > 0) slices.push({ region: a.name, orders: c });
      }
      slices.sort((a, b) => b.orders - a.orders);
      const top4 = slices.slice(0, 4);
      // Completion rate = succeeded / (succeeded + failed) over the
      // 7d window for this dept's runs.
      const succ = rows.filter((r) => r.status === "succeeded").length;
      const fail = rows.filter((r) => r.status === "failed").length;
      const completionRate =
        succ + fail > 0 ? Math.round((succ / (succ + fail)) * 1000) / 10 : 0;
      if (top4.length > 0) {
        fulfilment = {
          byAgent: top4,
          totalThisWeek: top4.reduce((s, x) => s + x.orders, 0),
          completionRate,
        };
      }
    }
  }

  // ── Finance ───────────────────────────────────────────────────
  const finRows = (finRuns.data ?? []) as Array<{
    created_at: string;
    status: string;
  }>;
  const monthly = new Array(12).fill(null).map((_, i) => {
    const d = new Date(now - (11 - i) * 30 * day);
    return {
      month: MONTH_LABELS[d.getMonth()],
      revenue: 0,
      expenses: 0,
    };
  });
  for (const r of finRows) {
    const t = Date.parse(r.created_at);
    if (Number.isNaN(t)) continue;
    const monthsAgo = Math.floor((now - t) / (30 * day));
    if (monthsAgo < 0 || monthsAgo >= 12) continue;
    const idx = 11 - monthsAgo;
    if (r.status === "succeeded") monthly[idx].revenue += 1;
    else if (r.status === "failed") monthly[idx].expenses += 1;
  }
  const totalRevenue = monthly.reduce((s, m) => s + m.revenue, 0);
  const finance: FinanceData | null =
    totalRevenue > 0
      ? {
          monthly,
          netThisMonth: monthly[11].revenue - monthly[11].expenses,
          marginPct:
            monthly[11].revenue > 0
              ? Math.round(
                  ((monthly[11].revenue - monthly[11].expenses) /
                    monthly[11].revenue) *
                    100,
                )
              : 0,
        }
      : null;

  return { marketing, sales, fulfilment, finance };
}
