import { supabaseAdmin } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth/admin";

export type OrgOverview = {
  id: string;
  name: string;
  slug: string;
  mcpToken: string | null;
  createdAt: string;
  pillars: {
    marketing: boolean;
    sales: boolean;
    fulfilment: boolean;
    finance: boolean;
  };
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
    .select("id, name, slug, mcp_token, created_at, marketing, sales, fulfilment, finance")
    .eq("id", orgId)
    .maybeSingle();
  if (!org) return null;

  const [
    { data: owner },
    { count: agentCount },
    { count: runningAgentCount },
    { count: routineCount },
    { data: schedTriggers },
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
  ]);

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    mcpToken: org.mcp_token ?? null,
    createdAt: org.created_at,
    pillars: {
      marketing: org.marketing,
      sales: org.sales,
      fulfilment: org.fulfilment,
      finance: org.finance,
    },
    owner: owner ? { name: owner.name, email: owner.email } : null,
    agentCount: agentCount ?? 0,
    runningAgentCount: runningAgentCount ?? 0,
    routineCount: routineCount ?? 0,
    scheduledRoutineCount: new Set((schedTriggers ?? []).map((t) => t.routine_id)).size,
  };
}
