import { chatComplete } from "@/lib/llm/provider";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  getKnowledgeFile,
  readKnowledgeFileContent,
} from "@/lib/knowledge/queries";

/**
 * Shared extraction helpers for the SOP-to-routine flow (P1 #11). Both
 * the preview (GET) and create (POST) routes share the same LLM call +
 * agent-match heuristic so the modal's preview and the persisted row
 * never disagree.
 */

export type SopExtraction = {
  cron: string;
  timezone: string;
  agentRole: string;
  actionSummary: string;
};

export type AgentMatch = {
  id: string;
  name: string;
  title: string | null;
  department: string | null;
  isDepartmentHead: boolean | null;
};

const SOP_SYSTEM_PROMPT = [
  "Extract a single recurring action from this SOP.",
  "Reply ONLY a JSON object: {cron: '<5-field cron string>', timezone: '<IANA tz>', agent_role: '<role keyword>', action_summary: '<5-10 word imperative>'}.",
].join(" ");

const FALLBACK: SopExtraction = {
  cron: "0 9 * * *",
  timezone: "UTC",
  agentRole: "general",
  actionSummary: "Run the SOP daily",
};

/**
 * Read the SOP's storage content for a given knowledge_file id, scoped
 * to the active org. Throws on missing rows so the caller can return
 * 404 cleanly. Empty content is preserved (the LLM still gets to
 * answer with the fallback).
 */
export async function loadSopContent(
  organizationId: string,
  knowledgeFileId: string,
): Promise<{ title: string; content: string }> {
  const file = await getKnowledgeFile(organizationId, knowledgeFileId);
  if (!file) {
    throw new Error("knowledge_file_not_found");
  }
  const content = file.storage_path
    ? await readKnowledgeFileContent(file.storage_path)
    : "";
  return { title: file.title, content };
}

/**
 * Call chatComplete with the strict JSON-only system prompt and parse
 * out the four fields. Any parsing failure or schema drift falls back
 * to the daily-9am defaults so the preview surface never blanks out.
 */
export async function extractSopSchedule(
  sopMarkdown: string,
  organizationId?: string,
  userId?: string | null,
): Promise<SopExtraction> {
  if (!sopMarkdown.trim()) {
    return FALLBACK;
  }
  try {
    const { chatCompleteOAuthFirst } = await import("@/lib/llm/oauth-first");
    const res = organizationId
      ? await chatCompleteOAuthFirst(
          organizationId,
          {
            system: SOP_SYSTEM_PROMPT,
            messages: [{ role: "user", content: sopMarkdown }],
            temperature: 0,
          },
          userId,
        )
      : await chatComplete({
          system: SOP_SYSTEM_PROMPT,
          messages: [{ role: "user", content: sopMarkdown }],
          temperature: 0,
        });
    return parseSopExtraction(res.text);
  } catch (err) {
    // No LLM provider configured / transient outage. Return the daily
    // 9am fallback so the modal still pre-fills and the operator can
    // hand-edit the cron + agent. Logged for ops visibility.
    console.warn("[sop-extract] chatComplete failed:", (err as Error).message);
    return FALLBACK;
  }
}

/**
 * Forgiving parse: tolerates code-fenced JSON, surrounding prose, and
 * partial fields. Always returns a usable shape so the modal can be
 * pre-filled and the operator can override anything wrong.
 *
 * Exported for unit testing.
 */
export function parseSopExtraction(raw: string): SopExtraction {
  const text = raw.trim();
  // Strip an optional ```json ... ``` fence.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenceMatch ? fenceMatch[1] : text;
  // Find the first { ... } block in case the model added prose.
  const objMatch = body.match(/\{[\s\S]*\}/);
  if (!objMatch) return FALLBACK;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(objMatch[0]) as Record<string, unknown>;
  } catch {
    return FALLBACK;
  }
  const cron = typeof parsed.cron === "string" ? parsed.cron : FALLBACK.cron;
  const timezone =
    typeof parsed.timezone === "string" ? parsed.timezone : FALLBACK.timezone;
  const agentRole =
    typeof parsed.agent_role === "string"
      ? parsed.agent_role
      : FALLBACK.agentRole;
  const actionSummary =
    typeof parsed.action_summary === "string"
      ? parsed.action_summary
      : FALLBACK.actionSummary;
  return { cron, timezone, agentRole, actionSummary };
}

/**
 * Find the agent in the active org that best matches the role keyword
 * extracted from the SOP. Heuristic order:
 *
 *   1. Active dept-head whose name OR title OR department contains the
 *      keyword (case-insensitive, partial match).
 *   2. Any agent whose name contains the keyword.
 *   3. First active dept-head in the org (stable order by created_at).
 *
 * Returns null only when the org has no agents at all, which the
 * caller treats as a 400.
 */
export async function findBestAgent(
  organizationId: string,
  agentRoleKeyword: string,
): Promise<AgentMatch | null> {
  const db = supabaseAdmin();
  const { data: agents, error } = await db
    .from("rgaios_agents")
    .select("id, name, title, department, is_department_head, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`findBestAgent: ${error.message}`);
  const list = (agents ?? []) as Array<{
    id: string;
    name: string;
    title: string | null;
    department: string | null;
    is_department_head: boolean | null;
    created_at: string;
  }>;
  if (list.length === 0) return null;

  const keyword = agentRoleKeyword.toLowerCase().trim();
  const tokens = keyword
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);

  const scoreAgent = (a: (typeof list)[number]): number => {
    const haystack = [a.name, a.title ?? "", a.department ?? ""]
      .join(" ")
      .toLowerCase();
    let score = 0;
    if (keyword && haystack.includes(keyword)) score += 5;
    for (const t of tokens) {
      if (haystack.includes(t)) score += 2;
    }
    if (a.is_department_head) score += 1;
    return score;
  };

  const scored = list
    .map((a) => ({ a, s: scoreAgent(a) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s);

  const winner =
    scored[0]?.a ??
    list.find((a) => a.is_department_head) ??
    list[0];

  return {
    id: winner.id,
    name: winner.name,
    title: winner.title,
    department: winner.department,
    isDepartmentHead: winner.is_department_head,
  };
}
