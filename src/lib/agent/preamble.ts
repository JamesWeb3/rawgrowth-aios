import { supabaseAdmin } from "@/lib/supabase/server";
import { embedOne, toPgVector } from "@/lib/knowledge/embedder";

const RAG_TOP_K = 3;

type ChunkRow = {
  filename: string;
  chunk_index: number;
  content: string;
  similarity: number;
};

/**
 * Build the full agent chat preamble (persona + org place + memories +
 * brand + per-agent RAG + company corpus). Used by both the dashboard
 * agent chat route and the per-agent Telegram webhook so both surfaces
 * see the same grounded context.
 *
 * Every section is best-effort: a single failure (missing column,
 * embedder offline, RPC missing) just skips that block and falls
 * through. Returns an empty string if nothing meaningful was assembled.
 */
export async function buildAgentChatPreamble(input: {
  orgId: string;
  agentId: string;
  orgName: string | null;
  queryText: string;
}): Promise<string> {
  const { orgId, agentId, orgName, queryText } = input;
  const db = supabaseAdmin();
  let preamble = "";

  // 1. Persona (role + title + system_prompt fallback to description)
  try {
    const { data: agentRow } = await db
      .from("rgaios_agents")
      .select("role, title, description, system_prompt, reports_to, department")
      .eq("id", agentId)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (agentRow) {
      const a = agentRow as typeof agentRow & {
        system_prompt?: string | null;
        reports_to?: string | null;
      };
      const personaPrompt =
        (a.system_prompt && a.system_prompt.trim()) ||
        (a.description && a.description.trim()) ||
        "";
      const lines: string[] = [];
      if (a.role) lines.push(`Role: ${a.role}`);
      if (a.title) lines.push(`Title: ${a.title}`);
      if (personaPrompt) lines.push(`Persona: ${personaPrompt}`);
      if (lines.length > 0) preamble += lines.join("\n");

      // 1b. Org place (parent + direct reports)
      try {
        let parentLabel: string | null = null;
        if (a.reports_to) {
          const { data: parent } = await db
            .from("rgaios_agents")
            .select("name, role")
            .eq("id", a.reports_to)
            .maybeSingle();
          const p = parent as { name: string; role: string } | null;
          if (p) parentLabel = `${p.name} (${p.role})`;
        }
        const { data: directs } = await db
          .from("rgaios_agents")
          .select("name, role")
          .eq("organization_id", orgId)
          .eq("reports_to", agentId);
        const directList = (directs ?? []) as Array<{
          name: string;
          role: string;
        }>;
        const orgLines: string[] = [];
        if (parentLabel) orgLines.push(`You report to: ${parentLabel}.`);
        if (directList.length > 0) {
          orgLines.push(
            `You have ${directList.length} direct report${
              directList.length === 1 ? "" : "s"
            }: ${directList
              .map((d) => `${d.name} (${d.role})`)
              .join(", ")}.`,
          );
        }
        if (orgLines.length > 0) {
          preamble +=
            (preamble ? "\n\n" : "") +
            `Your place in the org (use this when coordinating cross-team work):\n${orgLines.join("\n")}`;
        }
      } catch {}
    }
  } catch {}

  // 2. Past memories (last 15 chat_memory audit entries for this agent)
  try {
    const { data: memories } = await db
      .from("rgaios_audit_log")
      .select("ts, detail")
      .eq("organization_id", orgId)
      .eq("kind", "chat_memory")
      .filter("detail->>agent_id", "eq", agentId)
      .order("ts", { ascending: false })
      .limit(15);
    const rows = (memories ?? []) as Array<{
      ts: string;
      detail: { fact?: string; agent_id?: string };
    }>;
    if (rows.length > 0) {
      const block = rows
        .filter((m) => m.detail?.fact)
        .reverse()
        .map((m, i) => `${i + 1}. ${m.detail.fact}`)
        .join("\n");
      if (block) {
        preamble +=
          (preamble ? "\n\n" : "") +
          `Things you remember from past conversations with this user (treat as facts about their business + preferences):\n${block}`;
      }
    }
  } catch {}

  // 3. Brand profile (latest approved markdown)
  try {
    const { data: brand } = await db
      .from("rgaios_brand_profiles")
      .select("content")
      .eq("organization_id", orgId)
      .eq("status", "approved")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const content = (brand as { content?: string } | null)?.content?.trim();
    if (content) {
      preamble +=
        (preamble ? "\n\n" : "") +
        `Brand profile for ${orgName ?? "this organisation"} (THIS IS THE CLIENT YOU WORK FOR - reference their offer, voice, ICP, frameworks, and banned-words list explicitly when relevant. Generic advice is a failure mode):\n\n${content}`;
    }
  } catch {}

  // 4 + 5. RAG retrievals (per-agent files + company corpus). Embedder
  // failures here are non-fatal - skip RAG and reply on persona + brand.
  try {
    const queryVector = await embedOne(queryText);

    const { data: agentChunks } = await db.rpc("rgaios_match_agent_chunks", {
      p_agent_id: agentId,
      p_organization_id: orgId,
      p_query: toPgVector(queryVector),
      p_top_k: RAG_TOP_K,
    });
    const chunks = (agentChunks ?? []) as ChunkRow[];
    if (chunks.length > 0) {
      const block = chunks
        .map(
          (c, i) =>
            `[${i + 1}] ${c.filename} (chunk ${c.chunk_index}):\n${c.content}`,
        )
        .join("\n\n");
      preamble +=
        (preamble ? "\n\n" : "") +
        `Relevant context retrieved from this agent's uploaded files (cite when you use them):\n\n${block}`;
    }

    const { data: companyRows } = await db.rpc("rgaios_match_company_chunks", {
      p_org_id: orgId,
      p_query_embedding: toPgVector(queryVector),
      p_match_count: 5,
      p_min_similarity: 0.0,
    });
    const companyChunks = (companyRows ?? []) as Array<{
      source: string;
      chunk_text: string;
    }>;
    if (companyChunks.length > 0) {
      const block = companyChunks
        .map((c, i) => `[${i + 1}] (${c.source}):\n${c.chunk_text}`)
        .join("\n\n");
      preamble +=
        (preamble ? "\n\n" : "") +
        `Company-wide context (intake / brand / scraped content / sales calls):\n\n${block}`;
    }
  } catch {
    // No embedder, no key, or RPC missing. Continue without RAG.
  }

  return preamble;
}
