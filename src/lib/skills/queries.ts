import { supabaseAdmin } from "@/lib/supabase/server";

export type AgentSkillRow = {
  agent_id: string;
  skill_id: string;
  created_at: string;
};

/** All (agent_id, skill_id) pairs for an org. Cheap enough to fetch wholesale. */
export async function listAssignments(
  organizationId: string,
): Promise<AgentSkillRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("rgaios_agent_skills")
    .select("agent_id, skill_id, created_at")
    .eq("organization_id", organizationId);
  if (error) throw new Error(`listAssignments: ${error.message}`);
  return (data ?? []) as AgentSkillRow[];
}

/** Skills assigned to a single agent. Used by the MCP agents_list output. */
export async function listSkillsForAgent(
  organizationId: string,
  agentId: string,
): Promise<string[]> {
  const { data, error } = await supabaseAdmin()
    .from("rgaios_agent_skills")
    .select("skill_id")
    .eq("organization_id", organizationId)
    .eq("agent_id", agentId);
  if (error) throw new Error(`listSkillsForAgent: ${error.message}`);
  return (data ?? []).map((r) => r.skill_id);
}

/**
 * Add one or more skills to an agent. Idempotent — existing rows are
 * preserved; only the missing (agent_id, skill_id) pairs are inserted.
 * Returns the list of skill ids that were newly added.
 */
export async function addSkillsToAgent(
  organizationId: string,
  agentId: string,
  skillIds: string[],
): Promise<string[]> {
  if (skillIds.length === 0) return [];
  const db = supabaseAdmin();

  const { data: existingRows, error: readErr } = await db
    .from("rgaios_agent_skills")
    .select("skill_id")
    .eq("organization_id", organizationId)
    .eq("agent_id", agentId)
    .in("skill_id", skillIds);
  if (readErr) throw new Error(`addSkillsToAgent: ${readErr.message}`);

  const existing = new Set((existingRows ?? []).map((r) => r.skill_id));
  const toAdd = skillIds.filter((id) => !existing.has(id));
  if (toAdd.length === 0) return [];

  const rows = toAdd.map((skill_id) => ({
    agent_id: agentId,
    skill_id,
    organization_id: organizationId,
  }));
  const { error } = await db.from("rgaios_agent_skills").insert(rows);
  if (error) throw new Error(`addSkillsToAgent insert: ${error.message}`);
  return toAdd;
}

/** Remove a single (agent_id, skill_id) pair. No-op if not present. */
export async function removeSkillFromAgent(
  organizationId: string,
  agentId: string,
  skillId: string,
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("rgaios_agent_skills")
    .delete()
    .eq("organization_id", organizationId)
    .eq("agent_id", agentId)
    .eq("skill_id", skillId);
  if (error) throw new Error(`removeSkillFromAgent: ${error.message}`);
}

/**
 * Replace the full set of agents assigned to a given skill. Idempotent —
 * computes diff, deletes what's leaving, inserts what's joining.
 */
export async function replaceSkillAssignments(
  organizationId: string,
  skillId: string,
  agentIds: string[],
): Promise<void> {
  const db = supabaseAdmin();
  const desired = new Set(agentIds);

  const { data: existingRows, error: readErr } = await db
    .from("rgaios_agent_skills")
    .select("agent_id")
    .eq("organization_id", organizationId)
    .eq("skill_id", skillId);
  if (readErr) throw new Error(`replaceSkillAssignments: ${readErr.message}`);

  const existing = new Set((existingRows ?? []).map((r) => r.agent_id));
  const toAdd = [...desired].filter((id) => !existing.has(id));
  const toRemove = [...existing].filter((id) => !desired.has(id));

  if (toRemove.length > 0) {
    const { error } = await db
      .from("rgaios_agent_skills")
      .delete()
      .eq("organization_id", organizationId)
      .eq("skill_id", skillId)
      .in("agent_id", toRemove);
    if (error) throw new Error(`replaceSkillAssignments delete: ${error.message}`);
  }

  if (toAdd.length > 0) {
    const rows = toAdd.map((agent_id) => ({
      agent_id,
      skill_id: skillId,
      organization_id: organizationId,
    }));
    const { error } = await db.from("rgaios_agent_skills").insert(rows);
    if (error) throw new Error(`replaceSkillAssignments insert: ${error.message}`);
  }
}
