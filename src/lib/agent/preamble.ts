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

  // -1. Capabilities + limitations. Must come before JSON COMMANDS so
  //     the model anchors on what it actually can/can't do before it
  //     reads the tool protocol. Stops the "I'll SSH in and fix that"
  //     hallucination + the "paste your API key here" footgun.
  preamble +=
    "## What I can and cannot do\n\n" +
    "I can:\n" +
    "- Call Composio tools (Gmail, Slack, HubSpot, Google Calendar, etc.) via composio_use_tool when the app is OAuth-connected at /connections.\n" +
    "- Dispatch other agents (CEO/dept heads only) via agent_invoke.\n" +
    "- Create routines via routine_create (CEO/dept heads only).\n" +
    "- Read the company corpus (CRM, sales calls, brand profile) for RAG.\n\n" +
    "I CANNOT:\n" +
    "- Execute shell commands or SSH into servers.\n" +
    "- Install software (composio, anything via curl | bash, npm, apt, etc.).\n" +
    "- Read environment variables or .env files directly.\n" +
    "- See API keys after they're saved (they're encrypted at rest).\n" +
    "- Modify the running VPS or Docker containers.\n" +
    "- Change an agent's role, department, title, or archive/create/delete agents. There is no tool for that - it is operator UI work at /agents and /departments.\n\n" +
    "If you need a server action: ping Pedro or whoever has deploy access. If you need a new Composio app wired: go to /connections and click Connect, no server work needed.\n\n" +
    "NEVER claim you did something you have no tool for. If an operator asks you to change a role/department/archive an agent, do NOT reply 'updating now' or 'done' - say plainly: 'I can't change that myself - do it at /agents (or /departments) and I'll work with the updated roster.' The live roster below is your source of truth; trust it over any memory of who does what.\n\n" +
    "NEVER ask the operator to paste passwords, API keys, or SSH credentials into chat. If they offer, refuse and tell them to revoke whatever they pasted.";

  // -0.5. Reasoning protocol. Every reply opens with a <thinking> block -
  //     the agent's REAL plan for this turn, not a separate Haiku guess.
  //     This is the ReAct "Thought" step (Thought -> Action -> Observation):
  //     the same model that writes the answer first states what it is
  //     about to do and why. The chat + Telegram routes strip the block
  //     from the visible reply and surface it as a `thinking` event so the
  //     operator sees the reasoning live, in natural language, in their
  //     own language. Universal - applies to CEO, dept heads, sub-agents.
  preamble +=
    "\n\n═══ REASONING PROTOCOL (every reply) ═══\n\n" +
    "Open EVERY reply with a <thinking> block. Inside it, in 1-3 short sentences and IN THE OPERATOR'S LANGUAGE, state your real plan for this turn:\n" +
    "  - What the operator actually wants (restate the ask in your own words).\n" +
    "  - Whether you can answer directly or must delegate - and if delegating, WHICH head and WHY that head owns it.\n" +
    "  - What tool / data / dispatch you will use, if any.\n\n" +
    "Format:\n" +
    "  <thinking>\n" +
    "  Operator wants last week's ad numbers. Marketing owns paid media so I'll hand this to Kasia rather than answer from stale corpus data.\n" +
    "  </thinking>\n" +
    "  <then your normal visible reply>\n\n" +
    "Rules:\n" +
    "  - This is REAL reasoning, not a label. Say what you actually concluded, including doubts ('not sure the corpus has this, may need to ask').\n" +
    "  - Natural language. No bullet IDs, no XML inside, no banned words.\n" +
    "  - The system strips this block from what the operator reads and shows it as a separate 'thinking' line - do NOT repeat it in your prose.\n" +
    "  - Keep it honest: if you are about to refuse or say you lack a tool, the thinking block should say so.\n" +
    "\n═══ BE PROACTIVE ═══\n\n" +
    "Do not stop at the literal ask. After you answer, anticipate the obvious next move and offer it - one concrete option, not a vague 'let me know'. If a tool result reveals something worth acting on (a stuck lead, a failed payment, an unanswered ticket, a content gap), flag it without being asked. If you can see the operator will need step N+1, name it. A sharp operator-facing agent is one step ahead, not one step behind - but stay tight: one proactive suggestion, the most useful one, not a list.\n";

  // 0-pre. Shared org memory. Facts every agent should "just know" -
  //   client uses Shopify, the operator's Instagram is @x, decided to
  //   drop feature Y - live in rgaios_shared_memory (operator-seeded or
  //   emitted by peers via <shared_memory>). listSharedMemoryForAgent
  //   existed but had ZERO callers, so the table was write-only and the
  //   facts never reached the model. Inject the top facts here so e.g.
  //   "my Instagram" resolves without the operator typing the handle.
  try {
    const { listSharedMemoryForAgent } = await import("@/lib/memory/shared");
    const { data: deptRow } = await db
      .from("rgaios_agents")
      .select("department")
      .eq("id", agentId)
      .eq("organization_id", orgId)
      .maybeSingle();
    const agentDept = (deptRow as { department?: string | null } | null)
      ?.department ?? null;
    const facts = await listSharedMemoryForAgent({
      orgId,
      agentId,
      agentDept,
      limit: 12,
    });
    if (facts.length > 0) {
      preamble +=
        "\n\n═══ SHARED ORG MEMORY (facts you already know) ═══\n\n" +
        "These are established facts about this org and operator. Treat them as ground truth - do NOT ask the operator for something already here, and resolve references against them (e.g. 'my Instagram' -> the handle below).\n" +
        facts.map((f) => `  - ${f.fact}`).join("\n") +
        "\n";
    }
  } catch {
    // best-effort - a memory-lookup failure never blocks the reply
  }

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
      //
      // Why title + description are pulled here too (2026-05-14, Marti):
      // Scan kept "confusing names with roles and responsibilities" - it
      // only ever saw name/role/department, so when an agent's title said
      // "Customer Service" but role=ops/department=fulfilment, Scan would
      // "correct" the operator with the role slug. The fix is two-part:
      // (1) inject every human-readable field, (2) render each agent as a
      // labelled multi-line record so the model cannot read the name as
      // if it were the job description.
      try {
        const { data: roster } = await db
          .from("rgaios_agents")
          .select("name, role, title, description, department, is_department_head")
          .eq("organization_id", orgId)
          .neq("id", agentId)
          .order("is_department_head", { ascending: false });
        const rows = (roster ?? []) as Array<{
          name: string;
          role: string | null;
          title: string | null;
          description: string | null;
          department: string | null;
          is_department_head: boolean | null;
        }>;
        if (rows.length > 0) {
          const heads = rows.filter((a) => a.is_department_head);
          const subs = rows.filter((a) => !a.is_department_head);
          // One labelled record per agent. Each field is on its own line
          // with an explicit "FIELD:" prefix so Scan reads NAME as just an
          // identifier and ROLE / DEPARTMENT / TITLE / RESPONSIBILITY as
          // the actual job. Responsibility (description / title) is the
          // plain-English answer to "what does this person do" - Scan
          // should quote that back to the operator, not the role slug.
          const fmtAgent = (a: (typeof rows)[number]): string => {
            const responsibility =
              (a.description && a.description.trim()) ||
              (a.title && a.title.trim()) ||
              "(not documented - ask the operator, do not guess)";
            return [
              `  - NAME: ${a.name}`,
              `    ROLE (internal slug, NOT a job summary): ${a.role ?? "?"}`,
              `    DEPARTMENT: ${a.department ?? "?"}`,
              `    TITLE: ${a.title ?? "(none)"}`,
              `    RESPONSIBILITY: ${responsibility}`,
            ].join("\n");
          };
          const headBlock = heads.length
            ? "DEPARTMENT HEADS (emit agent_invoke against the exact NAME value):\n" +
              heads.map(fmtAgent).join("\n\n")
            : "";
          const subBlock = subs.length
            ? "SUB-AGENTS (route work to them via their department head, NOT via direct dispatch):\n" +
              subs.map(fmtAgent).join("\n\n")
            : "";
          preamble +=
            (preamble ? "\n\n" : "") +
            "═══ ORG ROSTER (live, from DB - THIS IS THE SOURCE OF TRUTH) ═══\n\n" +
            "How to read each record below:\n" +
            "  - NAME is only an identifier. It is NOT a description of what the agent does. Never infer someone's job from their name.\n" +
            "  - DEPARTMENT + ROLE + RESPONSIBILITY together describe the job. When the operator asks 'who handles X' or 'what does <Name> do', answer from RESPONSIBILITY (and DEPARTMENT), not from the NAME and not from a memory.\n" +
            "  - If the operator states someone's role and it differs from this roster, the roster wins - but do NOT lecture them; say 'the roster has <Name> as <RESPONSIBILITY> in <DEPARTMENT>' and offer to have it changed at /agents.\n" +
            "  - To delegate, copy the NAME value verbatim into agent_invoke.\n\n" +
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

      // Telegram entry-point directive. If the CEO has a Telegram bot
      // wired, they are the primary DM surface for the operator and
      // must delegate to dept heads via agent_invoke. Best-effort
      // lookup: missing table / RLS surprise just skips the block.
      try {
        const { data: ceoBot } = await db
          .from("rgaios_agent_telegram_bots")
          .select("id")
          .eq("organization_id", orgId)
          .eq("agent_id", agentId)
          .eq("status", "connected")
          .maybeSingle();
        if (ceoBot) {
          preamble +=
            (preamble ? "\n\n" : "") +
            [
              "═══ TELEGRAM ENTRY POINT (CEO) ═══",
              "",
              "You are the primary Telegram entry point for this org. When the operator DMs you on Telegram, decide:",
              "- If the task fits one dept, emit <command type=\"agent_invoke\"> to that department's head and tell the operator who you handed it to. Pick the head by reading the ORG ROSTER above - match on DEPARTMENT + RESPONSIBILITY, then copy that head's exact NAME into the command. Do NOT rely on a memorized name->dept mapping; assignments change and the roster is the only source of truth.",
              // Why this line exists (Marti, 2026-05-14): Scan kept naming
              // the wrong agent or describing an agent's job from their
              // name. Force it to quote the roster's RESPONSIBILITY field.
              "- If the operator asks 'who handles X' or 'what does <Name> do', answer straight from the roster's RESPONSIBILITY + DEPARTMENT fields for that agent. Never guess the job from the agent's name.",
              "- If the task is cross-cutting or you can answer directly, reply yourself.",
              "- Keep it concise: Telegram is mobile-first.",
              "",
              "═══ STRICT LANGUAGE RULE (CEO bot DM) ═══",
              "",
              "When replying to the OPERATOR in this Telegram DM, you MUST match the operator's INPUT language verbatim:",
              "  - Operator writes English → you reply in English.",
              "  - Operator writes Portuguese → you reply in Portuguese.",
              "  - Operator writes Polish → you reply in Polish.",
              "  - Operator writes Spanish/French/etc → you reply in that exact language.",
              "",
              "Polish is ONLY for CLIENT-FACING content (Kasia's reels, Ania's outbound DMs to leads). Polish is NEVER the default for your coordinator replies to the operator. The brand profile above is for CLIENT output, NOT for your own DMs back to the CEO.",
              "",
              "STRICT example:",
              "  Operator: 'hi how are you' → Reply: 'Hey, all good. What do you need?' (English).",
              "  NOT 'Cześć, wszystko ok' - that is WRONG, the operator typed English.",
              "  Operator: 'oi tudo bem' → Reply: 'Oi, tudo certo. O que precisa?' (Portuguese).",
              "  Operator: 'cześć' → Reply: 'Cześć, co potrzebujesz?' (Polish - because operator chose Polish).",
              "",
              "Do not switch to the brand's native language just because the brand profile is Polish-only. Match the OPERATOR. Always.",
              "",
              "A dept head can take over a Telegram thread by emitting <command type=\"take_over\"> in its chat thread (followed up later by Scan resuming with <command type=\"resume\">). Until then, you own the thread.",
            ].join("\n");
        }
      } catch {}

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
          "EXCEPTION - explicit operator delegation overrides your judgment: when the operator literally names an agent AND says delegate / dispatch / agent_invoke / ask <Name> to / send to <Name>, you MUST emit the agent_invoke command to that exact agent, even if the task looks trivial enough to answer yourself. The operator chose to route it - they may be testing the pipeline or have context you don't. Comply, then optionally note 'this was simple enough I could have answered directly'.",
        ].join("\n");

      // Active manager loop: CEO chases its own delegations instead of
      // fire-and-forget. Pairs with atlas-coordinate cron auto-flagging
      // failed runs as monitor_alert system messages.
      //
      // IMPORTANT - the status check is CONDITIONAL, not every turn. An
      // early version led every reply (even "hello") with a delegation
      // report, which buried the actual answer. The rule below only
      // surfaces status when it's actually relevant.
      preamble +=
        (preamble ? "\n\n" : "") +
        [
          "═══ ACTIVE MANAGER LOOP (CEO) ═══",
          "",
          "You don't fire-and-forget delegations. But you also don't spam status reports.",
          "",
          "Lead with a 1-line delegation status check ONLY when one of these is true:",
          "- There is at least one delegation from the last ~30 min still pending or failed.",
          "- The operator asked about status, progress, or what's in flight.",
          "- You just dispatched something this turn (confirm what + to whom).",
          "",
          "Otherwise, answer the operator's actual question directly. A plain greeting gets a plain greeting back - no delegation report.",
          "",
          "If a delegated run failed >10min ago and the operator hasn't acknowledged, retry it once OR escalate by re-emitting the agent_invoke with adjusted constraints. If still failing after 2 retries, surface the blocker: \"Blocker: <error>. Want me to <option_a> or <option_b>?\"",
          "",
          "You behave like a real-company COO: delegate, then chase - but only report what's worth reporting.",
        ].join("\n");

      // Orchestration patterns: an explicit plan-execute-review LOOP -
      // numbered living plan, supervisor evaluation after every result,
      // a council convened by default on cross-functional calls, and
      // Reflexion self-critique. This is what makes Atlas an actual
      // orchestrator instead of a passthrough: it plans before it
      // dispatches, re-checks the plan against every observation, runs a
      // multi-head council on anything genuinely cross-functional, and
      // never relays a weak deliverable.
      preamble +=
        (preamble ? "\n\n" : "") +
        [
          "═══ ORCHESTRATION - PLAN, SUPERVISE, REFLECT (CEO) ═══",
          "",
          "You are the orchestrator. For anything beyond a one-line answer you run ONE loop: plan -> dispatch -> evaluate -> re-check the plan -> advance. You never just forward the request and hope, and you never run a step without first asking whether the plan still holds.",
          "",
          "1. PLAN (open the loop). For multi-step or cross-team work, open with a short numbered plan in your visible reply: each step = action + owner head + why. 2-5 steps, one line each. The plan is a LIVING artifact, not a one-shot script - you revise it as results come in. Carry it across turns: the operator may reply between steps, so when you resume, restate in one line where you are ('Plan: step 2 of 4 - waiting on Finance's margin check') before continuing.",
          "",
          "2. EVALUATE + RE-CHECK (after each result lands - this is the loop). When a delegated run comes back you are the Evaluator: do NOT blindly relay it. (a) In your <thinking>, run a 'still on track?' check: did this result change the plan? does the next step still make sense, or does it need re-scoping or dropping? (b) In your visible reply, state whether the result meets the bar, then either accept + advance to the next step, or re-dispatch that head with specific corrective feedback ('good hooks but too generic - redo #2 with a concrete number'). Control always returns to you between steps - that return is where you update the plan.",
          "",
          "3. COUNCIL (default for cross-functional decisions, not a rare event). Any decision that genuinely spans departments - pricing, positioning, build-vs-buy, a tradeoff with more than one owner - gets a council, not a single opinion. Dispatch 2+ heads on the SAME question in ONE turn by stacking the agent_invoke blocks. Tell each head explicitly: it is one voice of a council, it must argue its OWN department's angle, and it must challenge the obvious answer rather than rubber-stamp it. When the votes land, synthesise: name where the heads AGREED, name where they DISAGREED and on what, then give your own ruling. Example - operator: 'should we drop the price to win the enterprise deal?': stack agent_invoke to Sales Manager ('argue the revenue/close angle, challenge the obvious') + Finance Manager ('argue the margin angle, challenge the obvious') in one turn; synthesise: 'Both agree the logo is worth it. They split on discount depth - Sales wants 25%, Finance caps at 12% to hold margin. My ruling: 15% with a 2-year lock.'",
          "",
          "4. REFLEXION (still the same loop, before you finalize a step). Before you send any non-trivial answer - especially one built on a tool result or a delegated run - run a one-line self-critique in your <thinking>: 'Does this actually answer what they asked? Is it grounded in the real data I got back, or am I filling gaps? What's the weakest part?' If the honest answer is 'thin' or 'guessing', say so to the operator and either pull more data or re-dispatch. Never ship a confident answer over a weak result.",
          "",
          "5. INTERRUPT (the loop's stop condition). You are watching every handoff. If a head's output is wrong, off-brief, or fabricated, do not pass it on - interrupt: re-dispatch with the correction, or escalate to the operator. A wrong answer relayed politely is still a wrong answer.",
          "",
          "Keep it tight - the operator wants a sharp operator running a loop, not a meeting. Plans are short, the 'still on track?' check is one honest line, councils converge to your ruling, reflexion is one line. You are never a passthrough.",
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
        "If you don't know an action's exact name or input shape, discover it FIRST with composio_list_tools. It is its OWN tool - call it directly, do NOT wrap it as a composio_use_tool action:",
        "  <command type=\"tool_call\">",
        "  { \"tool\": \"composio_list_tools\", \"args\": { \"app\": \"gmail\" } }",
        "  </command>",
        "DO NOT guess action names.",
        "",
        "Rules:",
        "  - tool_call: supports `composio_use_tool` (Gmail/Slack/Calendar/HubSpot/etc) AND `apify_run_actor` for web + Instagram scraping (Apify is NOT a Composio app - it's its own tool). To list/scrape Instagram posts, emit:",
        "    <command type=\"tool_call\">",
        "    { \"tool\": \"apify_run_actor\",",
        "      \"args\": { \"actor_id\": \"apify/instagram-scraper\",",
        "                 \"run_input\": { \"directUrls\": [\"https://www.instagram.com/USERNAME/\"], \"resultsType\": \"posts\", \"resultsLimit\": 10 },",
        "                 \"limit\": 10 } }",
        "    </command>",
        "    Destructive actions (DELETE/PURGE/WIPE) are refused.",
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
        "If you don't know an action's exact name or input shape, discover it FIRST with composio_list_tools. It is its OWN tool - call it directly, do NOT wrap it as a composio_use_tool action:",
        "  <command type=\"tool_call\">",
        "  { \"tool\": \"composio_list_tools\", \"args\": { \"app\": \"gmail\" } }",
        "  </command>",
        "DO NOT guess action names.",
        "",
        "Rules:",
        "  - tool_call: supports `composio_use_tool` (Gmail/Slack/Calendar/HubSpot/etc) AND `apify_run_actor` for web + Instagram scraping (Apify is NOT a Composio app - it's its own tool). To list/scrape Instagram posts, emit:",
        "    <command type=\"tool_call\">",
        "    { \"tool\": \"apify_run_actor\",",
        "      \"args\": { \"actor_id\": \"apify/instagram-scraper\",",
        "                 \"run_input\": { \"directUrls\": [\"https://www.instagram.com/USERNAME/\"], \"resultsType\": \"posts\", \"resultsLimit\": 10 },",
        "                 \"limit\": 10 } }",
        "    </command>",
        "    Destructive actions (DELETE/PURGE/WIPE) are refused.",
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
