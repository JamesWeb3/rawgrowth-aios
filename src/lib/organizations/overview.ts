import { supabaseAdmin } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth/admin";

export type OrgOverview = {
  id: string;
  name: string;
  slug: string;
  mcpToken: string | null;
  createdAt: string;
  // Active pillars derived from the actual department distribution of
  // this org's agents — picks up Development + any custom slug from
  // /departments/new without needing a column-per-dept on
  // rgaios_organizations.
  pillars: Array<{ slug: string; label: string; active: boolean }>;
  owner: { name: string | null; email: string } | null;
  agentCount: number;
  runningAgentCount: number;
  routineCount: number;
  scheduledRoutineCount: number;
};

export async function getOrgOverview(): Promise<OrgOverview | null> {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) return null;
  const orgId = ctx.activeOrgId;
  const db = supabaseAdmin();

  const { data: org } = await db
    .from("rgaios_organizations")
    .select("id, name, slug, mcp_token, created_at")
    .eq("id", orgId)
    .maybeSingle();
  if (!org) return null;

  const [
    { data: owner },
    { count: agentCount },
    { count: runningAgentCount },
    { count: routineCount },
    { data: schedTriggers },
    { data: deptRows },
  ] = await Promise.all([
    db
      .from("rgaios_users")
      .select("name, email")
      .eq("organization_id", orgId)
      .eq("role", "owner")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    db
      .from("rgaios_agents")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId),
    db
      .from("rgaios_agents")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "running"),
    db
      .from("rgaios_routines")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId),
    db
      .from("rgaios_routine_triggers")
      .select("routine_id")
      .eq("organization_id", orgId)
      .eq("kind", "schedule"),
    db
      .from("rgaios_agents")
      .select("department")
      .eq("organization_id", orgId)
      .not("department", "is", null),
  ]);

  const SEEDED = ["marketing", "sales", "fulfilment", "finance", "development"];
  const counts = new Map<string, number>();
  for (const r of (deptRows ?? []) as { department: string | null }[]) {
    if (r.department) counts.set(r.department, (counts.get(r.department) ?? 0) + 1);
  }
  const order = [...new Set([...SEEDED, ...counts.keys()])];
  const pillars = order.map((slug) => ({
    slug,
    label: slug.charAt(0).toUpperCase() + slug.slice(1).replace(/_/g, " "),
    active: (counts.get(slug) ?? 0) > 0,
  }));

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    mcpToken: org.mcp_token ?? null,
    createdAt: org.created_at,
    pillars,
    owner: owner ? { name: owner.name, email: owner.email } : null,
    agentCount: agentCount ?? 0,
    runningAgentCount: runningAgentCount ?? 0,
    routineCount: routineCount ?? 0,
    scheduledRoutineCount: new Set((schedTriggers ?? []).map((t) => t.routine_id)).size,
  };
}
