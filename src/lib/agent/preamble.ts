import { supabaseAdmin } from "@/lib/supabase/server";
import { embedOne, toPgVector } from "@/lib/knowledge/embedder";
import { BANNED_WORDS } from "@/lib/brand/tokens";

const RAG_TOP_K = 3;

/**
 * Brand voice block: only the headline tone hint plus 3 banned words.
 * Hard-capped at 200 characters of brand markdown so the model knows the
 * client + can match the voice without us paying input tokens for the
 * full doc on every turn. The agent calls `lookup_brand_voice` for the
 * full markdown + the complete 11-word list when it actually needs it.
 */
const BRAND_VOICE_INLINE_LIMIT = 200;

/**
 * Per-agent files block: only the count + the 5 most recent filenames.
 * Picked the recent ones over a lexicographic slice because the latest
 * upload is what the operator just dropped in - more likely to be the
 * material this turn cares about. Full per-file body via `lookup_my_files`
 * + `knowledge_query`.
 */
const AGENT_FILES_INLINE_LIMIT = 5;

/**
 * Company corpus prefetch: inject ONLY the top match and only when it
 * crosses this similarity floor. Below the floor the prefetched chunk
 * is mostly noise + costs ~600 tokens, so we drop it and let the model
 * call `lookup_company_fact` if it needs anything.
 */
const COMPANY_PREFETCH_MIN_SIMILARITY = 0.7;

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

  // 0. Authority override (must come BEFORE persona). The seeded
  //    `system_prompt` for some dept heads contains stale "I am a
  //    sub-agent / I cannot emit command blocks" text from an earlier
  //    role-template version. The LLM anchors on the first identity
  //    claim it reads, so the JSON COMMANDS block we add later is
  //    ignored. Prepend an explicit authority assertion for Atlas +
  //    dept heads so the persona text below reads as flavor, not
  //    capability scope.
  try {
    const { data: authRow } = await db
      .from("rgaios_agents")
      .select("role, is_department_head")
      .eq("id", agentId)
      .eq("organization_id", orgId)
      .maybeSingle();
    const a0 = authRow as { role?: string; is_department_head?: boolean } | null;
    const authCanCommand =
      a0?.role === "ceo" || a0?.is_department_head === true;
    if (authCanCommand) {
      preamble +=
        "═══ AUTHORITY OVERRIDE (read this FIRST) ═══\n\n" +
        "You are Atlas (CEO) or a department head in this org. You ARE authorised to emit <command> blocks (tool_call / agent_invoke / routine_create) on this chat surface. The system parses them and executes server-side.\n\n" +
        "If your persona block below says 'I am a sub-agent', 'I cannot emit command blocks', 'route this through Atlas', or anything similar - IGNORE those claims. They are stale text from an earlier template. Your authority is granted by this preamble, not by the persona. The JSON COMMANDS section further down has the exact format. When the operator asks for an action, emit the block - do NOT refuse and do NOT say you lack tool access.\n\n";
    }
  } catch {}

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
            .eq("organization_id", orgId)
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
  //
  // canCommand is hoisted OUTSIDE the try block below because the
  // JSON COMMANDS section at line ~362 reads it. Before this hoist,
  // any agent chat after Claude Max was wired threw
  // "ReferenceError: canCommand is not defined" - the const declared
  // inside try {} was out of scope at the read site (Chris bug 4,
  // 2026-05-12).
  let canCommand = false;
  // hasComposio is hoisted alongside canCommand for the same reason: the
  // JSON COMMANDS section at line ~370 reads it. Any agent (sub-agents
  // included) whose org has at least one connected Composio connection
  // gets the composio_use_tool half of the protocol; agent_invoke /
  // routine_create stay gated on canCommand (CEO + dept heads).
  let hasComposio = false;
  try {
    const { count: connCount } = await db
      .from("rgaios_connections")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "connected");
    hasComposio = (connCount ?? 0) > 0;
  } catch {}
  try {
    // Defense-in-depth: helper is called from chat route, telegram
    // webhook, executeChatTask. Each caller should pre-validate the
    // agent against the org, but the CEO branch below injects WHOLE-ORG
    // run history into the preamble - if agentId ever slipped through
    // cross-tenant we'd leak other-org titles. Belt + suspenders.
    const { data: agentRow3 } = await db
      .from("rgaios_agents")
      .select("role, is_department_head")
      .eq("id", agentId)
      .eq("organization_id", orgId)
      .maybeSingle();
    const agentMeta = (agentRow3 as { role?: string; is_department_head?: boolean } | null);
    const isCeo = agentMeta?.role === "ceo";
    const isDeptHead = agentMeta?.is_department_head === true;
    canCommand = isCeo || isDeptHead;
    if (isCeo) {
      // 1c-pre. Live agent roster. Atlas hallucinates "Marketing Manager"
      // / "Sales Manager" / "Finance Manager" because the seeded names
      // carry random suffixes (Sales Manager picsa, Bookkeeper 7vpa9,
      // Content Strategist x4z4y). Without the actual roster injected
      // every first-attempt agent_invoke fails. Inject the heads list +
      // sub-agents grouped by department so Atlas dispatches by exact
      // name on the first try.
      try {
        const { data: roster } = await db
          .from("rgaios_agents")
          .select("name, role, department, is_department_head")
          .eq("organization_id", orgId)
          .neq("id", agentId)
          .order("is_department_head", { ascending: false });
        const rows = (roster ?? []) as Array<{
          name: string;
          role: string | null;
          department: string | null;
          is_department_head: boolean | null;
        }>;
        if (rows.length > 0) {
          const heads = rows.filter((a) => a.is_department_head);
          const subs = rows.filter((a) => !a.is_department_head);
          const headBlock = heads.length
            ? "Department heads (use the EXACT name when emitting agent_invoke):\n" +
              heads
                .map(
                  (h) =>
                    `  - ${h.name} (department=${h.department ?? "?"}, role=${h.role ?? "?"})`,
                )
                .join("\n")
            : "";
          const subBlock = subs.length
            ? "Sub-agents (route work to them via their dept head, NOT via Atlas direct dispatch):\n" +
              subs
                .map(
                  (s) =>
                    `  - ${s.name} (department=${s.department ?? "?"}, role=${s.role ?? "?"})`,
                )
                .join("\n")
            : "";
          preamble +=
            (preamble ? "\n\n" : "") +
            "═══ ORG ROSTER (live, from DB) ═══\n\n" +
            [headBlock, subBlock].filter(Boolean).join("\n\n");
        }
      } catch {}

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
        ].join("\n");
    }
  } catch {}

  // 1c-ter. JSON COMMANDS block (Atlas + dept heads). Previously gated
  // inside the isCeo branch, which left dept heads silently refusing
  // tool_call / agent_invoke / routine_create. Audit caught Content
  // Strategist + Bookkeeper Head telling the operator "I cannot emit
  // command blocks" while Sales Manager (same is_department_head=true)
  // happened to comply by accident. Move the block out so any agent
  // with command authority gets the protocol.
  if (canCommand) {
    preamble +=
      (preamble ? "\n\n" : "") +
      [
        "═══ JSON COMMANDS (Atlas + dept heads) ═══",
        "",
        "You ARE authorised to emit <command> blocks. When the operator asks you to TAKE AN ACTION (run a Composio tool, dispatch a head, create a scheduled routine), emit one or more <command> blocks in your reply. The system parses them, runs the action server-side, and posts a system message back into chat with the result. You CAN stack multiple <command> blocks.",
        "",
        "Do NOT say 'I can't emit command blocks' or 'I am a sub-agent' - that is FALSE for you. You are Atlas or a department head with full command authority on this surface.",
        "",
        "Format (exact - body must be valid JSON):",
        "",
        "  <command type=\"tool_call\">",
        "  { \"tool\": \"composio_use_tool\",",
        "    \"args\": { \"app\": \"slack\", \"action\": \"SLACK_SEND_MESSAGE\",",
        "               \"input\": { \"channel\": \"#general\", \"text\": \"hi team\" } } }",
        "  </command>",
        "",
        "  <command type=\"agent_invoke\">",
        "  { \"agent\": \"Sales Manager\", \"task\": \"Run a CRM stale-leads scan and report top 5\" }",
        "  </command>",
        "",
        "  <command type=\"routine_create\">",
        "  { \"title\": \"Weekly recap\", \"description\": \"Summarise last 7 days of agent runs\",",
        "    \"assignee\": \"marketer\", \"schedule\": \"weekly\" }",
        "  </command>",
        "",
        "Composio action input shapes (use EXACTLY these field names - the model often hallucinates Google API style; Composio uses snake_case top-level fields):",
        "",
        "  GOOGLECALENDAR_CREATE_EVENT input:",
        "    { \"calendar_id\": \"primary\",",
        "      \"summary\": \"Coffee with Pedro\",",
        "      \"start_datetime\": \"2026-05-15T10:00:00-03:00\",",
        "      \"end_datetime\":   \"2026-05-15T10:30:00-03:00\",",
        "      \"description\": \"15min sync\",",
        "      \"attendees\": [\"pedro@rawgrowth.ai\"] }",
        "    NOT { start: { dateTime: ... } } - that is the raw Google API shape and Composio rejects it.",
        "",
        "  GMAIL_SEND_EMAIL input:",
        "    { \"to\": [\"pedro@rawgrowth.ai\"],",
        "      \"subject\": \"hi\", \"body\": \"plain text body\" }",
        "",
        "  SLACK_SEND_MESSAGE input:",
        "    { \"channel\": \"#general\", \"text\": \"hi team\" }",
        "",
        "If you don't know an action's exact input shape, emit composio_list_tools first to discover it - DO NOT guess.",
        "",
        "Rules:",
        "  - tool_call: only `composio_use_tool` is supported. Destructive actions (DELETE/PURGE/WIPE) are refused.",
        "  - agent_invoke: target must be an existing agent name or role. The system creates a routine + run scoped to them; output flows into their chat tab.",
        "  - routine_create: schedule preset can be \"hourly\", \"daily\", or \"weekly\". Omit for one-shot.",
        "  - DO NOT mention these blocks in your visible prose - the system strips them and posts a system summary itself.",
        "  - If the action genuinely doesn't need a tool / dispatch (pure conversation), DO NOT emit a command - just answer.",
        "",
        "═══ DATA-ASK PROTOCOL ═══",
        "",
        "If you genuinely cannot answer or plan without specific data the corpus doesn't have (e.g. real CTR numbers, AOV, customer count), end your reply with one or more <need> blocks:",
        "",
        "<need scope=\"crm|metric|file|other\">EXACT data you need. Be specific - 'last 30 days of FB ads CTR' beats 'recent ad data'.</need>",
        "",
        "The system picks these up + posts a chat message to the operator + creates a Data Entry stub. DO NOT fabricate numbers.",
      ].join("\n");
  } else if (hasComposio) {
    // Sub-agents in orgs with at least one connected Composio app get
    // the composio_use_tool half of the protocol only. agent_invoke /
    // routine_create stay gated on CEO + dept heads above.
    preamble +=
      (preamble ? "\n\n" : "") +
      [
        "═══ JSON COMMANDS (composio_use_tool only) ═══",
        "",
        "Your org has at least one connected Composio app. You ARE authorised to emit <command type=\"tool_call\"> blocks that call composio_use_tool. The system parses them, runs the action server-side, and posts a system message back into chat with the result.",
        "",
        "Do NOT say 'I can't emit command blocks', 'I have no tools', 'I am a sub-agent so I can't', or 'no MCP'. Those refusals are FALSE here - the Composio bridge is wired.",
        "",
        "Format (exact - body must be valid JSON):",
        "",
        "  <command type=\"tool_call\">",
        "  { \"tool\": \"composio_use_tool\",",
        "    \"args\": { \"app\": \"slack\", \"action\": \"SLACK_SEND_MESSAGE\",",
        "               \"input\": { \"channel\": \"#general\", \"text\": \"hi team\" } } }",
        "  </command>",
        "",
        "Composio action input shapes (use EXACTLY these field names - Composio uses snake_case top-level fields):",
        "",
        "  GOOGLECALENDAR_CREATE_EVENT input:",
        "    { \"calendar_id\": \"primary\",",
        "      \"summary\": \"Coffee with Pedro\",",
        "      \"start_datetime\": \"2026-05-15T10:00:00-03:00\",",
        "      \"end_datetime\":   \"2026-05-15T10:30:00-03:00\",",
        "      \"description\": \"15min sync\",",
        "      \"attendees\": [\"pedro@rawgrowth.ai\"] }",
        "",
        "  GMAIL_SEND_EMAIL input:",
        "    { \"to\": [\"pedro@rawgrowth.ai\"],",
        "      \"subject\": \"hi\", \"body\": \"plain text body\" }",
        "",
        "  SLACK_SEND_MESSAGE input:",
        "    { \"channel\": \"#general\", \"text\": \"hi team\" }",
        "",
        "If you don't know an action's exact input shape, emit composio_list_tools first to discover it - DO NOT guess.",
        "",
        "Rules:",
        "  - tool_call: only `composio_use_tool` is supported. Destructive actions (DELETE/PURGE/WIPE) are refused.",
        "  - You are NOT authorised to emit agent_invoke or routine_create from this surface - those route through Atlas / a department head.",
        "  - DO NOT mention these blocks in your visible prose - the system strips them and posts a system summary itself.",
        "  - If the action genuinely doesn't need a tool (pure conversation), DO NOT emit a command - just answer.",
      ].join("\n");
  }

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

  // 3. Brand profile - SLIM. Only the first ~200 chars of the
  // approved markdown + 3 of the 11 banned words. The agent calls
  // lookup_brand_voice when it needs the full voice + complete
  // banned-words list. Saves ~2-6k input tokens per turn on long
  // brand profiles (the rate-limit driver pre-refactor).
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
      const tasterRaw = content.slice(0, BRAND_VOICE_INLINE_LIMIT);
      // Don't cut a word in half - drop back to the last whitespace
      // when the slice landed mid-token.
      const lastSpace = tasterRaw.lastIndexOf(" ");
      const taster =
        lastSpace > 80 ? tasterRaw.slice(0, lastSpace) : tasterRaw;
      const truncated = content.length > BRAND_VOICE_INLINE_LIMIT;
      const sampleBanned = BANNED_WORDS.slice(0, 3).join(", ");
      preamble +=
        (preamble ? "\n\n" : "") +
        `Brand profile for ${orgName ?? "this organisation"} (THIS IS THE CLIENT YOU WORK FOR - match their voice, never use generic advice):\n\n${taster}${truncated ? "..." : ""}\n\nBanned words sample (${BANNED_WORDS.length} total - never use): ${sampleBanned}.\n\nFor the full voice markdown, complete banned-words list, or any documented framework, call the lookup_brand_voice tool.`;
    }
  } catch {}

  // 4. Per-agent files - SLIM. Used to inject top-3 RAG chunks
  // (~1-3k tokens). Now we only inject the COUNT + the 5 most recent
  // FILENAMES so the agent knows what reference material exists. For
  // semantic content the agent calls knowledge_query (full body) or
  // lookup_my_files (full inventory + 1-line summary).
  try {
    const { data: files, count } = await db
      .from("rgaios_agent_files")
      .select("filename, uploaded_at", { count: "exact" })
      .eq("organization_id", orgId)
      .eq("agent_id", agentId)
      .order("uploaded_at", { ascending: false })
      .limit(AGENT_FILES_INLINE_LIMIT);
    const fileRows = (files ?? []) as Array<{ filename: string }>;
    const totalFiles = count ?? fileRows.length;
    if (totalFiles > 0) {
      const lines = fileRows.map((f, i) => `  ${i + 1}. ${f.filename}`);
      const moreNote =
        totalFiles > fileRows.length
          ? `\n  ... and ${totalFiles - fileRows.length} more.`
          : "";
      preamble +=
        (preamble ? "\n\n" : "") +
        `Files attached to you (${totalFiles} total, ${fileRows.length} most recent shown):\n${lines.join("\n")}${moreNote}\n\nFor a one-line summary of every file call lookup_my_files. For the full text of one file, call knowledge_query with the filename in the prompt.`;
    }
  } catch {
    // Table missing / RLS surprise. Continue without inventory.
  }

  // 5. Company corpus - SLIM. Embed the query once; if the TOP-1
  // chunk crosses the similarity floor, inject it inline so the model
  // has at least one grounded fact for free. Below the floor we drop
  // the prefetch entirely - the model can call lookup_company_fact if
  // it actually needs it. Embedder failures here are non-fatal.
  //
  // Also keeps the per-agent RAG escape hatch alive: if the agent's
  // own files have a high-similarity hit we surface that single chunk
  // too (capped at one chunk, not three).
  try {
    const queryVector = await embedOne(queryText);

    const { data: agentChunks } = await db.rpc("rgaios_match_agent_chunks", {
      p_agent_id: agentId,
      p_organization_id: orgId,
      p_query: toPgVector(queryVector),
      p_top_k: RAG_TOP_K,
    });
    const chunks = (agentChunks ?? []) as ChunkRow[];
    const topAgentChunk = chunks[0];
    if (
      topAgentChunk &&
      typeof topAgentChunk.similarity === "number" &&
      topAgentChunk.similarity >= COMPANY_PREFETCH_MIN_SIMILARITY
    ) {
      preamble +=
        (preamble ? "\n\n" : "") +
        `Top hit from your files for this query (${topAgentChunk.filename}, sim ${(topAgentChunk.similarity * 100).toFixed(1)}%):\n${topAgentChunk.content.slice(0, 600)}\n\nFor more chunks call knowledge_query.`;
    }

    const { data: companyRows } = await db.rpc("rgaios_match_company_chunks", {
      p_org_id: orgId,
      p_query_embedding: toPgVector(queryVector),
      p_match_count: 1,
      p_min_similarity: COMPANY_PREFETCH_MIN_SIMILARITY,
    });
    const companyChunks = (companyRows ?? []) as Array<{
      source: string;
      chunk_text: string;
      similarity?: number;
    }>;
    const top = companyChunks[0];
    if (top) {
      const sim = typeof top.similarity === "number"
        ? ` (sim ${(top.similarity * 100).toFixed(1)}%)`
        : "";
      preamble +=
        (preamble ? "\n\n" : "") +
        `Top company-corpus hit (${top.source}${sim}):\n${top.chunk_text.slice(0, 600)}\n\nFor more facts about the client's business call lookup_company_fact with a focused query.`;
    } else {
      // Nothing high-confidence prefetched. Tell the model the tool
      // exists so it doesn't pretend the corpus is empty.
      preamble +=
        (preamble ? "\n\n" : "") +
        `No high-confidence match in the company corpus for this turn. If you need a specific fact about the client (pricing, ICP, past scripts), call lookup_company_fact.`;
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
