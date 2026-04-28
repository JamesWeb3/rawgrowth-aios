import { supabaseAdmin } from "@/lib/supabase/server";
import { ensureDefaultOrganization } from "@/lib/supabase/ensure-org";
import type { Database } from "@/lib/supabase/types";
import {
  agentFromRow,
  type Agent,
  type AgentCreateInput,
  type AgentUpdateInput,
} from "./dto";

type AgentUpdate = Database["public"]["Tables"]["rgaios_agents"]["Update"];

export async function listAgentsForOrg(
  organizationId: string,
): Promise<Agent[]> {
  const { data, error } = await supabaseAdmin()
    .from("rgaios_agents")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listAgents: ${error.message}`);
  return (data ?? []).map(agentFromRow);
}

export async function createAgent(
  organizationId: string,
  input: AgentCreateInput,
): Promise<Agent> {
  await ensureDefaultOrganization();
  const { data, error } = await supabaseAdmin()
    .from("rgaios_agents")
    .insert({
      organization_id: organizationId,
      name: input.name,
      title: input.title || null,
      role: input.role,
      reports_to: input.reportsTo,
      description: input.description || null,
      runtime: input.runtime,
      budget_monthly_usd: input.budgetMonthlyUsd,
      department: input.department ?? null,
      ...(input.isDepartmentHead !== undefined
        ? { is_department_head: input.isDepartmentHead }
        : {}),
      ...(input.writePolicy ? { write_policy: input.writePolicy } : {}),
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`createAgent: ${error?.message}`);
  return agentFromRow(data);
}

export async function updateAgent(
  organizationId: string,
  id: string,
  patch: AgentUpdateInput,
): Promise<Agent> {
  const dbPatch: AgentUpdate = {};
  if (patch.name !== undefined) dbPatch.name = patch.name;
  if (patch.title !== undefined) dbPatch.title = patch.title || null;
  if (patch.role !== undefined) dbPatch.role = patch.role;
  if (patch.reportsTo !== undefined) dbPatch.reports_to = patch.reportsTo;
  if (patch.description !== undefined)
    dbPatch.description = patch.description || null;
  if (patch.runtime !== undefined) dbPatch.runtime = patch.runtime;
  if (patch.budgetMonthlyUsd !== undefined)
    dbPatch.budget_monthly_usd = patch.budgetMonthlyUsd;
  if (patch.spentMonthlyUsd !== undefined)
    dbPatch.spent_monthly_usd = patch.spentMonthlyUsd;
  if (patch.status !== undefined) dbPatch.status = patch.status;
  if (patch.writePolicy !== undefined) dbPatch.write_policy = patch.writePolicy;
  if (patch.department !== undefined) dbPatch.department = patch.department;
  if (patch.isDepartmentHead !== undefined)
    dbPatch.is_department_head = patch.isDepartmentHead;

  const { data, error } = await supabaseAdmin()
    .from("rgaios_agents")
    .update(dbPatch)
    .eq("organization_id", organizationId)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) throw new Error(`updateAgent: ${error?.message}`);
  return agentFromRow(data);
}

export async function deleteAgent(
  organizationId: string,
  id: string,
): Promise<void> {
  // reports_to is ON DELETE SET NULL — direct reports reparent to null automatically.
  const { error } = await supabaseAdmin()
    .from("rgaios_agents")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", id);
  if (error) throw new Error(`deleteAgent: ${error.message}`);
}
