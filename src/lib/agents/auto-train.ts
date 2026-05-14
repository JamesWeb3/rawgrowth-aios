import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { supabaseAdmin } from "@/lib/supabase/server";
import { ingestAgentFile } from "@/lib/knowledge/ingest";
import { getRoleTemplate } from "@/lib/agents/role-templates";
import type { Database } from "@/lib/supabase/types";

type AgentUpdate = Database["public"]["Tables"]["rgaios_agents"]["Update"];

/**
 * Plan §3 + §4. Apply the role template (system_prompt + default
 * skills + starter MDs) to a freshly inserted agent row. Best-effort:
 * each step logs + continues so the agent ends up created even when
 * one step fails.
 *
 * Used by:
 *   - /api/agents POST (manual hire)
 *   - seedDefaultAgentsForOrg (org bootstrap, runs once per default
 *     manager + sub-agent + the CEO Atlas)
 */
export async function autoTrainAgent(input: {
  orgId: string;
  agentId: string;
  roleLabel: string;
}): Promise<{ system_prompt: boolean; skills: number; files: number }> {
  const result = { system_prompt: false, skills: 0, files: 0 };
  const template = getRoleTemplate(input.roleLabel);
  if (!template) return result;
  const db = supabaseAdmin();

  try {
    // Always set system_prompt. ALSO backfill description if the agent
    // row currently has an empty/null one - the first sentence of the
    // system_prompt makes a good 1-sentence public-facing summary, and
    // an empty description leaves the Vision tab + org-chart card
    // looking unfinished.
    // Typed as the table Update shape so .update() accepts it without a
    // RejectExcessProperties error - only real columns can be set here.
    const update: AgentUpdate = { system_prompt: template.systemPrompt };
    const { data: row } = await db
      .from("rgaios_agents")
      .select("description")
      .eq("id", input.agentId)
      .eq("organization_id", input.orgId)
      .maybeSingle();
    const currentDesc = (row as { description: string | null } | null)?.description?.trim();
    if (!currentDesc) {
      const firstSentence =
        template.systemPrompt.split(/(?<=[.!?])\s/)[0]?.trim() ?? "";
      if (firstSentence && firstSentence.length <= 280) {
        update.description = firstSentence;
      }
    }
    const { error } = await db
      .from("rgaios_agents")
      .update(update)
      .eq("id", input.agentId)
      .eq("organization_id", input.orgId);
    if (!error) result.system_prompt = true;
    else console.warn(`[auto-train] system_prompt failed for ${input.agentId}: ${error.message}`);
  } catch (err) {
    console.warn(`[auto-train] system_prompt threw: ${(err as Error).message}`);
  }

  if (template.defaultSkillIds.length > 0) {
    try {
      const rows = template.defaultSkillIds.map((skillId) => ({
        organization_id: input.orgId,
        agent_id: input.agentId,
        skill_id: skillId,
      }));
      const { error } = await db
        .from("rgaios_agent_skills")
        .upsert(rows, {
          onConflict: "agent_id,skill_id",
          ignoreDuplicates: true,
        });
      if (!error) result.skills = rows.length;
      else console.warn(`[auto-train] skills failed for ${input.agentId}: ${error.message}`);
    } catch (err) {
      console.warn(`[auto-train] skills threw: ${(err as Error).message}`);
    }
  }

  const starterRoot = join(process.cwd(), "src/lib/agents/starter-content");
  for (const starter of template.starterFiles) {
    try {
      const filePath = join(starterRoot, starter.relativePath);
      const content = await readFile(filePath, "utf8");
      await ingestAgentFile({
        orgId: input.orgId,
        agentId: input.agentId,
        filename: starter.filename,
        content,
        mimeType: "text/markdown",
        uploadedBy: null,
        storage: null,
      });
      result.files += 1;
    } catch (err) {
      console.warn(
        `[auto-train] starter ${starter.relativePath} failed for ${input.agentId}: ${(err as Error).message}`,
      );
    }
  }

  return result;
}
