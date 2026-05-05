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

  // 1c. Pending tasks - tell the agent which routines they own that
  // haven't completed yet. Lets them say "I have 2 things in flight,
  // both LinkedIn-related" instead of pretending to start fresh.
  try {
    const { data: routines } = await db
      .from("rgaios_routines")
      .select("id, title, description, created_at")
      .eq("organization_id", orgId)
      .eq("assignee_agent_id", agentId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(20);
    const routineIds = ((routines ?? []) as Array<{ id: string }>).map(
      (r) => r.id,
    );
    if (routineIds.length > 0) {
      const { data: latestRuns } = await db
        .from("rgaios_routine_runs")
        .select("routine_id, status, completed_at")
        .eq("organization_id", orgId)
        .in("routine_id", routineIds)
        .order("created_at", { ascending: false });
      const latestByRoutine = new Map<string, string>();
      for (const r of (latestRuns ?? []) as Array<{
        routine_id: string;
        status: string;
      }>) {
        if (!latestByRoutine.has(r.routine_id)) {
          latestByRoutine.set(r.routine_id, r.status);
        }
      }
      const taskRows = (routines ?? []) as Array<{
        id: string;
        title: string | null;
        description: string | null;
      }>;
      const open = taskRows.filter((r) => {
        const s = latestByRoutine.get(r.id);
        return !s || s === "pending" || s === "running" || s === "failed";
      });
      if (open.length > 0) {
        const block = open
          .slice(0, 10)
          .map((r, i) => {
            const s = latestByRoutine.get(r.id) ?? "queued";
            return `${i + 1}. [${s}] ${r.title ?? "(untitled)"}`;
          })
          .join("\n");
        preamble +=
          (preamble ? "\n\n" : "") +
          `Your pending tasks (you own these - mention them when relevant, finish them when the user asks for the next thing):\n${block}`;
      }
    }
  } catch {}

  // 1c-bis. Cross-dept activity snapshot for Atlas (CEO role only).
  // Atlas needs to ANSWER questions like "what's marketing working on"
  // or "audit 12 completed runs" - so we inject the last 20 runs +
  // last 30 task spawns across the WHOLE org. Without this, Atlas
  // truthfully says "I don't have access to the run log" - which
  // looks like a broken bot to the user.
  try {
    const { data: agentRow3 } = await db
      .from("rgaios_agents")
      .select("role")
      .eq("id", agentId)
      .maybeSingle();
    const isCeo =
      (agentRow3 as { role?: string } | null)?.role === "ceo";
    if (isCeo) {
      // Last 20 routine runs (succeeded or running) across org
      const { data: runs } = await db
        .from("rgaios_routine_runs")
        .select(
          "id, status, completed_at, created_at, output, routines:routine_id(title, assignee_agent_id)",
        )
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(20);
      const runRows = (runs ?? []) as Array<{
        id: string;
        status: string;
        completed_at: string | null;
        created_at: string;
        output: { reply?: string } | null;
        routines: { title: string | null; assignee_agent_id: string | null } | null;
      }>;
      // Resolve assignee names
      const aIds = Array.from(
        new Set(
          runRows
            .map((r) => r.routines?.assignee_agent_id)
            .filter((x): x is string => typeof x === "string"),
        ),
      );
      const nameById = new Map<string, string>();
      if (aIds.length > 0) {
        const { data: as } = await db
          .from("rgaios_agents")
          .select("id, name")
          .in("id", aIds);
        for (const a of (as ?? []) as Array<{ id: string; name: string }>) {
          nameById.set(a.id, a.name);
        }
      }
      if (runRows.length > 0) {
        const block = runRows
          .map((r, i) => {
            const who = r.routines?.assignee_agent_id
              ? nameById.get(r.routines.assignee_agent_id) ?? "agent"
              : "unassigned";
            const title = r.routines?.title ?? "(untitled)";
            const out = (r.output?.reply ?? "")
              .replace(/\n+/g, " ")
              .slice(0, 100);
            return `${i + 1}. [${r.status}] ${title} - ${who}${out ? ` :: ${out}` : ""}`;
          })
          .join("\n");
        preamble +=
          (preamble ? "\n\n" : "") +
          `Recent agent activity across the WHOLE org (last 20 runs - you have full read access here, do NOT say "I don't have access"):\n${block}`;
      }

      // Atlas command directive - commanding the dept heads
      preamble +=
        (preamble ? "\n\n" : "") +
        [
          "═══ YOU ARE ATLAS - THE COMMANDER ═══",
          "",
          "You are the operator's ONE point of contact. The dept heads (Marketing Manager, Sales Manager, Operations Manager, Finance Manager, Engineering Manager) report to you. Your job:",
          "",
          "1. ROUTE - When the operator asks for cross-team work, identify which head OWNS the outcome and dispatch via <task assignee=\"<role>\">. Don't try to do their job yourself.",
          "2. SYNTHESIZE - When pulling status, summarize across heads in 3 bullets max. The operator wants the whole picture, not five raw reports.",
          "3. ESCALATE - If a head has been retrying without recovery, surface it. Tell the operator: 'Marketing has tried 3 angles on conversion - we need a human call on creative spend.'",
          "4. KEEP HEADS ALIGNED - When a decision affects multiple depts, tell each head what to expect. Use <shared_memory scope=\"all\"> for facts everyone needs.",
          "",
          "Example dispatch (operator: 'we need to fix the conversion drop'):",
          "  Reply: 'Marketing Manager owns this. I'm dispatching the audit + 3 hooks now.'",
          "  <task assignee=\"marketer\">",
          "  Title: Audit conversion drop, ship 3 founder-story hooks",
          "  Description: Conversion fell 53% w/w. Pause underperforming creatives, ship 3 new hooks built around founder story (beat testimonial 2.4x last A/B). Approve $1.2k creative budget with the operator first.",
          "  </task>",
          "",
          "Do NOT dispatch tasks for things YOU can answer (questions, summaries, opinions). Do NOT delegate cross-team coordination back to a single head when it spans depts - that's YOUR job.",
          "",
          "═══ DATA-ASK PROTOCOL ═══",
          "",
          "If you genuinely cannot answer or plan without specific data the corpus doesn't have (e.g. real CTR numbers, AOV, customer count), end your reply with one or more <need> blocks:",
          "",
          "<need scope=\"crm|metric|file|other\">EXACT data you need. Be specific - 'last 30 days of FB ads CTR' beats 'recent ad data'.</need>",
          "",
          "The system picks these up + posts a chat message to the operator + creates a Data Entry stub. DO NOT fabricate numbers.",
        ].join("\n");
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

  // Task-creation directive. The chat route extracts <task> blocks
  // post-reply and creates rgaios_routines + rgaios_routine_runs rows.
  // This is the only way the agent can persist work-to-do from a
  // conversation today (no MCP tools on the dashboard chat surface).
  preamble +=
    (preamble ? "\n\n" : "") +
    [
      "═══ TASK CREATION ═══",
      "",
      "When the user assigns you (or someone you can delegate to) work that needs to land in the Tasks tab, end your reply with one or more <task> blocks. The system parses them, creates the routine + a pending run, and they show up immediately in the assignee's Tasks tab.",
      "",
      "Format (exact):",
      "",
      `<task assignee="self">`,
      "Title: short imperative line (max 80 chars)",
      "Description: one or two sentences with the goal + concrete deliverable",
      "</task>",
      "",
      "assignee values:",
      `  • "self"       → assigns to you (most common)`,
      `  • "<role>"     → assigns to the agent with that role in your org (e.g. "marketer", "sdr", "ceo", "ops")`,
      `  • "<name>"     → assigns by exact agent name`,
      "",
      "If you are a department head (CEO Atlas, Marketing Manager, etc) and the user asks for cross-team work, prefer assignee=\"<role>\" so the right person picks it up. The Org Place block above tells you who reports to you.",
      "",
      "DO NOT emit a <task> block for purely conversational replies (questions, brainstorming, opinions). Only when there's a concrete piece of work to track.",
      "",
      "You may emit MULTIPLE <task> blocks in one reply (one per discrete task). Keep the visible part of your reply short - the user reads it as a confirmation, not as a re-statement of what's in the task.",
      "",
      "═══ AGENT MANAGEMENT (Atlas + dept heads only) ═══",
      "",
      "If you are Atlas (CEO) or a dept head, you can re-org SUB-AGENTS in conversation. CANNOT touch other dept heads (Pedro's rule - heads protected).",
      "",
      `<agent action="create" name="Senior SDR" reports_to="Sales Manager" role="sdr" description="Owns inbound lead qualification."></agent>`,
      `<agent action="archive" name="Junior Copywriter"></agent>`,
      `<agent action="update" name="Senior SDR" description="Now also handles LinkedIn DMs."></agent>`,
      "",
      "Use when conversation makes clear a missing role would unblock work. Don't use for trivial title tweaks.",
      "",
      "═══ SHARED MEMORY ═══",
      "",
      "When you learn a fact ALL peer agents need (client uses Shopify, owner prefers PT-BR slack, decided to drop X feature), emit a <shared_memory> block:",
      "",
      `<shared_memory importance="4" scope="all">FACT IN ONE LINE</shared_memory>`,
      "",
      "scope: \"all\" = every agent sees it. Or list dept slugs: \"marketing,sales\".",
      "importance: 1-5 (4-5 = pinned in everyone's preamble forever).",
      "Skip for one-conversation context bits - those auto-save as individual memory.",
      "",
      "═══ DATA-ASK PROTOCOL ═══",
      "",
      "If you genuinely cannot plan without specific data the corpus doesn't have (real CTR numbers, AOV, customer count), end your reply with one or more <need> blocks:",
      "",
      `<need scope="crm|metric|file|other">EXACT data needed. Be specific - 'last 30 days FB ads CTR' beats 'recent ad data'.</need>`,
      "",
      "Server intercepts these + posts chat message asking operator. DO NOT fabricate numbers.",
    ].join("\n");

  return preamble;
}
