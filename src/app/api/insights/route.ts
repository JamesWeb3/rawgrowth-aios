import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import {
  filterAgentsByDept,
  getAllowedDepartments,
} from "@/lib/auth/dept-acl";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  generateInsightsForDept,
  sweepAllDepts,
} from "@/lib/insights/generator";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId || !ctx.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = ctx.activeOrgId;
  const dept = req.nextUrl.searchParams.get("department");

  const allowedDepts = await getAllowedDepartments({
    userId: ctx.userId,
    organizationId: orgId,
    isAdmin: ctx.isAdmin,
  });
  if (allowedDepts && dept && !allowedDepts.includes(dept)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let q = supabaseAdmin()
    .from("rgaios_insights")
    .select(
      "id, department, kind, severity, metric, current_value, prior_value, delta_pct, title, reason, suggested_action, status, generated_by_agent_id, loop_count, created_at",
    )
    .eq("organization_id", orgId)
    .neq("status", "dismissed")
    .order("created_at", { ascending: false })
    .limit(50);
  if (dept) q = q.eq("department", dept);
  else if (allowedDepts) q = q.in("department", allowedDepts);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Resolve agent names
  type Row = {
    id: string;
    department: string | null;
    kind: string;
    severity: string;
    metric: string;
    current_value: number | null;
    prior_value: number | null;
    delta_pct: number | null;
    title: string;
    reason: string | null;
    suggested_action: string | null;
    status: string;
    generated_by_agent_id: string | null;
    created_at: string;
  };
  const rows = (data ?? []) as Row[];
  const agentIds = Array.from(
    new Set(
      rows
        .map((r) => r.generated_by_agent_id)
        .filter((id): id is string => typeof id === "string"),
    ),
  );
  const agentNames = new Map<string, string>();
  if (agentIds.length > 0) {
    const { data: agents } = await supabaseAdmin()
      .from("rgaios_agents")
      .select("id, name, department")
      .in("id", agentIds);
    const allAgents = (agents ?? []) as Array<{
      id: string;
      name: string;
      department: string | null;
    }>;
    const scopedAgents = filterAgentsByDept(allAgents, allowedDepts);
    const allowedAgentIds = new Set(scopedAgents.map((a) => a.id));
    for (const a of allAgents) {
      if (allowedAgentIds.has(a.id) || ctx.isAdmin) {
        agentNames.set(a.id, a.name);
      }
    }
  }

  const insights = rows.map((r) => ({
    ...r,
    agent_name: r.generated_by_agent_id
      ? (agentNames.get(r.generated_by_agent_id) ?? null)
      : null,
  }));
  return NextResponse.json({ insights });
}

/**
 * POST /api/insights?department=marketing → generate insights for that
 * dept. POST /api/insights?sweep=true → sweep every dept + atlas
 * cross-dept.
 */
export async function POST(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId || !ctx.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl;
  const dept = url.searchParams.get("department");
  const sweep = url.searchParams.get("sweep") === "true";

  if (sweep) {
    const r = await sweepAllDepts(ctx.activeOrgId);
    return NextResponse.json({ ok: true, ...r });
  }

  const allowedDepts = await getAllowedDepartments({
    userId: ctx.userId,
    organizationId: ctx.activeOrgId,
    isAdmin: ctx.isAdmin,
  });
  if (allowedDepts && dept && !allowedDepts.includes(dept)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const r = await generateInsightsForDept({
    orgId: ctx.activeOrgId,
    department: dept,
  });
  return NextResponse.json({ ok: true, ...r });
}
