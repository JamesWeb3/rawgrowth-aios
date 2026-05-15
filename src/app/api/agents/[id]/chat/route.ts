import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

import { getOrgContext } from "@/lib/auth/admin";
import { isDepartmentAllowed } from "@/lib/auth/dept-acl";
import { supabaseAdmin } from "@/lib/supabase/server";
import { chatReply } from "@/lib/agent/chat";
import { applyBrandFilter } from "@/lib/brand/apply-filter";
import { buildAgentChatPreamble } from "@/lib/agent/preamble";
import { extractAndCreateTasks } from "@/lib/agent/tasks";
import { extractAndExecuteCommands } from "@/lib/agent/agent-commands";
import { extractThinking } from "@/lib/agent/thinking";
import { persistSharedMemoryFromReply } from "@/lib/memory/shared";
import { badUuidResponse } from "@/lib/utils";

/**
 * Generate a chain-of-thought "thinking" brief for the operator. Two-tier:
 *
 *   - Haiku-based (preferred, when ANTHROPIC_API_KEY is set): one short
 *     sentence summarising the agent's plan. Tiny, sub-second, doesn't
 *     touch the OAuth pool that powers the main reply.
 *   - Heuristic fallback (when no API key): classify the user message by
 *     verb + intent and emit a templated brief. Less smart, but always
 *     fires so the operator sees SOMETHING above each reply.
 *
 * Best-effort: any failure returns null and the chat reply proceeds.
 */
async function generateThinkingBrief(userMessage: string): Promise<string | null> {
  if (!userMessage || userMessage.length < 3) return null;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const result = await generateText({
        model: anthropic("claude-haiku-4-5"),
        system:
          "You are summarising what an AI agent is about to do, before it answers. Reply with one short sentence under 100 characters starting with 'I will'. No quotes, no preamble. Be concrete.",
        prompt: `User message: ${userMessage.slice(0, 400)}`,
        abortSignal: ctrl.signal,
      });
      clearTimeout(timer);
      const brief = result.text.trim().replace(/^["']|["']$/g, "").slice(0, 140);
      if (brief) return brief;
    } catch {
      // fall through to heuristic
    }
  }
  // Heuristic fallback - works on every VPS regardless of API key
  // configuration (Marti runs RUNTIME_PATH=cli with no ANTHROPIC_API_KEY,
  // so this path is its ONLY brief). Strip a leading greeting/filler
  // FIRST so "hey, can you pull my best post" classifies on the real
  // ask, not on the word "hey" - the old regex matched the greeting and
  // emitted "stand by for the real ask" even when the real ask was
  // right there in the same sentence.
  const stripped = userMessage
    .trim()
    .replace(/^(hi+|hello|hey+|yo|oi+|ol[aá]|cze[sś][cć]|hej|e a[ií])[\s,!.…-]+/i, "")
    .trim();
  const t = stripped.toLowerCase();
  // Only a BARE greeting (nothing substantive left after the strip) is a
  // greeting turn.
  if (t.length < 4) {
    return "I will greet the operator and ask what they actually need.";
  }
  if (/^(agent_invoke|dispatch|delegate|ask)\s+/i.test(stripped)) {
    const m = stripped.match(/(?:agent_invoke|dispatch|delegate|ask)\s+(\w+)/i);
    const tgt = m?.[1] ?? "the right dept head";
    return `I will dispatch ${tgt} via agent_invoke and surface the result inline.`;
  }
  if (/\b(instagram|\big\b|posts?|reels?|apify|scrape|engagement|best post|martifox)\b/i.test(t)) {
    return "I will pull the Instagram data via Apify and work from the real numbers.";
  }
  if (/composio|gmail|slack|calendar|google|hubspot|\btool\b/i.test(t)) {
    return "I will check what's wired in Composio and fire the right tool call.";
  }
  if (/council|debate|both .* and|marketing and|cross-functional/i.test(t)) {
    return "I will convene a council - dispatch the relevant heads, then synthesise their angles into a decision.";
  }
  if (/(?:^bye|tchau|see you|^thanks|^obrigad)/i.test(t)) {
    return "I will close the turn briefly without spinning up new work.";
  }
  if (/(?:status|progress|stuck|monitor|what.*pending)/i.test(t)) {
    return "I will status-check open delegations and surface anything stuck.";
  }
  if (/^(write|draft|plan|create|make|build|outline|review|audit)\b/i.test(t)) {
    return "I will produce this directly, grounded in org context and brand voice.";
  }
  if (/^(list|show|what|how|why|when|where|who|can you|could you|qual|quem|onde|porque|como)/i.test(t)) {
    return "I will answer directly from org context (RAG / memory + tools), no delegation unless it needs a dept.";
  }
  return "I will work the ask in the operator's language, delegating only if it genuinely fits one department.";
}

export const runtime = "nodejs";

const HISTORY_LIMIT = 50;
const SURFACE = "agent_chat";

const HARD_FAIL_MESSAGE =
  "[brand voice guard] Reply withheld - copy still contained banned words after one regeneration. An operator needs to review.";

type IncomingMessage = { role: string; content: string };

type SecretHit = { kind: string; fragment: string };

/**
 * Scrub secrets pasted into chat (API keys, bearer tokens, SSH
 * creds, PEM blocks, AWS keys). Applied to BOTH inbound user text
 * and outbound agent reply so secrets never persist to
 * rgaios_agent_chat_messages or get embedded into
 * rgaios_company_chunks. Caller logs hit kinds (not fragments) and
 * surfaces an SSE warning to the operator.
 */
function redactSecrets(text: string): {
  redacted: string;
  hits: SecretHit[];
} {
  const hits: SecretHit[] = [];
  const patterns: Array<{
    kind: string;
    re: RegExp;
    replacement: string;
  }> = [
    {
      kind: "pem_private_key",
      re: /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g,
      replacement: "[REDACTED PRIVATE KEY]",
    },
    {
      kind: "anthropic_api_key",
      re: /sk-ant-[A-Za-z0-9_-]{20,}/g,
      replacement: "[REDACTED]",
    },
    {
      kind: "aws_access_key",
      re: /AKIA[0-9A-Z]{16}/g,
      replacement: "[REDACTED AWS KEY]",
    },
    {
      kind: "root_at_ip_password",
      re: /root@\d{1,3}(?:\.\d{1,3}){3}.{0,40}password\s*[:=]\s*\S+/gi,
      replacement: "root@x.x.x.x password: [REDACTED]",
    },
    {
      kind: "bearer_token",
      re: /[Bb]earer\s+[A-Za-z0-9_.\-]{20,}/g,
      replacement: "Bearer [REDACTED]",
    },
    {
      kind: "api_key_prefix",
      re: /(sk|ak|pk|ck|sk_live|pk_live|sk_test|sk-proj|ghp|gho|gha|glpat|xoxb|xoxp|xoxa)[-_][A-Za-z0-9_-]{16,}/g,
      replacement: "[REDACTED API KEY]",
    },
    {
      // Supabase's 2026 key format: sb_secret_... (service role) and
      // sb_publishable_... (anon). The prefix family above does not
      // cover the `sb_` prefix, so a pasted Supabase service key would
      // have leaked into chat history + the company corpus.
      kind: "supabase_key",
      re: /sb_(?:secret|publishable)_[A-Za-z0-9_-]{12,}/g,
      replacement: "[REDACTED SUPABASE KEY]",
    },
    {
      // Catch the truncated/ellipsis form agents tend to echo back in
      // warnings: `ak_gHrg9Sor...`. Lower length floor (4+ chars after
      // prefix) and trailing ellipsis or dots. Runs after the full-key
      // pattern so the longer-match-first ordering still holds.
      kind: "api_key_prefix_truncated",
      re: /(sk|ak|pk|ck|sk_live|pk_live|sk_test|sk-proj|ghp|gho|gha|glpat|xoxb|xoxp|xoxa)[-_][A-Za-z0-9_-]{4,}\.{2,}/g,
      replacement: "[REDACTED API KEY]",
    },
    {
      kind: "password_phrase",
      re: /(?:password|passwd|pwd)\s*[:=]\s*\S+/gi,
      replacement: "password: [REDACTED]",
    },
  ];
  let redacted = text;
  for (const p of patterns) {
    redacted = redacted.replace(p.re, (match) => {
      const frag =
        match.length > 12
          ? `${match.slice(0, 4)}...${match.slice(-4)}`
          : "***";
      hits.push({ kind: p.kind, fragment: frag });
      return p.replacement;
    });
  }
  return { redacted, hits };
}

/**
 * Insight chat queue (paired with /api/insights/[id]/open-chat).
 *
 * Called immediately after a user message lands in Atlas chat. If the
 * agent receiving the message is Atlas (CEO) and an insight is in
 * chat_state='sent', mark it answered and promote the oldest queued
 * insight - seed its question as a fresh assistant turn so the
 * conversation continues without operator action.
 */
async function maybePromoteInsightQueue(orgId: string, agentId: string) {
  const db = supabaseAdmin();
  // Defense-in-depth: caller already org-scoped the agent at POST entry,
  // but this helper is internal-callable, so add the explicit filter
  // here too. Cheap and avoids an orphaned insight promotion if the
  // call site ever drifts.
  const { data: agent, error: agentErr } = await db
    .from("rgaios_agents")
    .select("role")
    .eq("id", agentId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (agentErr) {
    console.error("[chat] insight-queue agent lookup failed:", agentErr.message);
    throw new Error(agentErr.message);
  }
  if ((agent as unknown as { role?: string } | null)?.role !== "ceo") return;

  const now = new Date().toISOString();

  // Mark all currently-sent insights as answered. There should only be
  // one but be tolerant of pre-existing dupes.
  const sentUpdate = await db
    .from("rgaios_insights")
    .update({ chat_state: "answered", chat_state_updated_at: now } as never)
    .eq("organization_id", orgId)
    .eq("chat_state", "sent");
  if (sentUpdate.error) {
    console.error(
      "[chat] insight-queue answered-update failed:",
      sentUpdate.error.message,
    );
    throw new Error(sentUpdate.error.message);
  }

  // Pick the oldest queued insight to promote.
  const { data: nextRow, error: nextErr } = await db
    .from("rgaios_insights")
    .select("id, title, suggested_action, reason")
    .eq("organization_id", orgId)
    .eq("chat_state", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (nextErr) {
    console.error(
      "[chat] insight-queue next-row select failed:",
      nextErr.message,
    );
    throw new Error(nextErr.message);
  }

  if (!nextRow) return;
  type Row = {
    id: string;
    title: string;
    suggested_action: string | null;
    reason: string | null;
  };
  const next = nextRow as unknown as Row;

  const parts = [`**${next.title}**`];
  if (next.reason) parts.push(next.reason);
  if (next.suggested_action) parts.push(next.suggested_action);
  const content = parts.join("\n\n");

  const seedInsert = await db.from("rgaios_agent_chat_messages").insert({
    organization_id: orgId,
    agent_id: agentId,
    user_id: null,
    role: "assistant",
    content,
    metadata: { source: "insight", insight_id: next.id, promoted: true },
  } as never);
  if (seedInsert.error) {
    console.error(
      "[chat] insight-queue seed-insert failed:",
      seedInsert.error.message,
    );
    throw new Error(seedInsert.error.message);
  }

  const promoteUpdate = await db
    .from("rgaios_insights")
    .update({ chat_state: "sent", chat_state_updated_at: now } as never)
    .eq("id", next.id);
  if (promoteUpdate.error) {
    console.error(
      "[chat] insight-queue promote-update failed:",
      promoteUpdate.error.message,
    );
    throw new Error(promoteUpdate.error.message);
  }
}

// Proactive-thread classification. The agent writes unprompted rows
// into the SAME rgaios_agent_chat_messages table as the operator
// conversation:
//   - the atlas-coordinate cron → metadata.kind = "atlas_coordinate"
//   - the insights generator   → metadata.kind = "proactive_anomaly"
// Rendering those inline made the operator's thread noisy ("fica
// confundindo a conversa"). They now live in a SEPARATE interactive
// thread. A row belongs to the proactive thread when EITHER its
// metadata.kind is one of those proactive kinds OR it was explicitly
// tagged metadata.thread = "proactive" (operator turns + the CEO's
// replies sent from the proactive view). Everything else is the main
// operator thread.
const PROACTIVE_KINDS = new Set(["atlas_coordinate", "proactive_anomaly"]);

function isProactiveRow(row: {
  metadata?: Record<string, unknown> | null;
}): boolean {
  const meta = row.metadata ?? {};
  const kind = typeof meta.kind === "string" ? meta.kind : "";
  if (PROACTIVE_KINDS.has(kind)) return true;
  return meta.thread === "proactive";
}

/**
 * GET /api/agents/[id]/chat
 *
 * Returns the last HISTORY_LIMIT messages for this agent (oldest first
 * so the client can render top-to-bottom without flipping). Used to
 * hydrate AgentChatTab on first mount so refreshing the panel keeps
 * the conversation visible.
 *
 * The read is SPLIT into two threads (see isProactiveRow): the main
 * operator conversation is returned as `messages`, and the proactive
 * thread (cron / insight rows + anything the operator and CEO said in
 * the proactive view) is returned as a separate `proactiveMessages`
 * array of the same row shape. The archived filter applies to both.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = ctx.activeOrgId;
  const { id: agentId } = await params;
  const bad = badUuidResponse(agentId);
  if (bad) return bad;
  const db = supabaseAdmin();

  // Cross-tenant guard.
  const { data: agent } = await db
    .from("rgaios_agents")
    .select("id")
    .eq("id", agentId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // include=archived → return archived messages too (for history viewer)
  const includeArchived = new URL(_req.url).searchParams.get("include") === "archived";
  let q = db
    .from("rgaios_agent_chat_messages")
    .select("id, role, content, created_at, metadata")
    .eq("organization_id", orgId)
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(includeArchived ? 200 : HISTORY_LIMIT);
  if (!includeArchived) {
    q = q.or("metadata->>archived.is.null,metadata->>archived.eq.false");
  }
  const { data, error } = await q;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Oldest-first so the client renders top-to-bottom. Then split the
  // two threads: proactive rows (cron / insight + thread-tagged) go to
  // `proactiveMessages`, everything else stays in `messages`.
  const ordered = [...(data ?? [])].reverse() as Array<{
    id: string;
    role: string;
    content: string;
    created_at: string;
    metadata: Record<string, unknown> | null;
  }>;
  const messages = ordered.filter((r) => !isProactiveRow(r));
  const proactiveMessages = ordered.filter((r) => isProactiveRow(r));
  return NextResponse.json({ messages, proactiveMessages });
}

/**
 * DELETE /api/agents/[id]/chat
 * "New chat" - soft-archives the current visible thread by tagging
 * each message with metadata.archived = true + an archived_at stamp.
 * The GET handler filters those out so the tab starts fresh, but the
 * raw history is still in rgaios_agent_chat_messages and can be
 * restored / surfaced later. Memory tab + extracted chat_memory rows
 * are untouched.
 *
 * Per-thread: `?thread=proactive` archives ONLY the proactive thread
 * (cron / insight rows + thread-tagged turns); the default archives
 * ONLY the main operator thread. Starting a fresh main chat must not
 * wipe the proactive feed and vice versa.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = ctx.activeOrgId;
  const { id: agentId } = await params;
  const bad = badUuidResponse(agentId);
  if (bad) return bad;
  const db = supabaseAdmin();

  const { data: agent } = await db
    .from("rgaios_agents")
    .select("id")
    .eq("id", agentId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // Pull current (non-archived) messages, merge archive flag into their
  // metadata, write back. metadata is jsonb so we can carry an archive
  // marker without a schema migration. Parallelize the per-row updates -
  // sequential awaits made "+ New chat" lag noticeably with 30+ messages.
  const thread =
    new URL(_req.url).searchParams.get("thread") === "proactive"
      ? "proactive"
      : "main";
  const { data: rows } = await db
    .from("rgaios_agent_chat_messages")
    .select("id, metadata")
    .eq("organization_id", orgId)
    .eq("agent_id", agentId)
    .or("metadata->>archived.is.null,metadata->>archived.eq.false");
  const stamp = new Date().toISOString();
  // Only archive rows in the requested thread - main "+ New chat" must
  // not nuke the proactive feed, and vice versa.
  const typedRows = (
    (rows ?? []) as Array<{ id: string; metadata: Record<string, unknown> | null }>
  ).filter((r) =>
    thread === "proactive" ? isProactiveRow(r) : !isProactiveRow(r),
  );
  const settled = await Promise.all(
    typedRows.map(async (r): Promise<{ id: string; ok: boolean; error?: string }> => {
      const next = { ...(r.metadata ?? {}), archived: true, archived_at: stamp };
      const res = await db
        .from("rgaios_agent_chat_messages")
        .update({ metadata: next } as never)
        .eq("id", r.id);
      if (res.error) {
        return { id: r.id, ok: false, error: res.error.message };
      }
      return { id: r.id, ok: true };
    }),
  );
  const failed = settled.filter((s) => !s.ok);
  if (failed.length > 0) {
    console.error(
      "[chat] DELETE archive partial failure:",
      failed.map((f) => `${f.id}:${f.error}`).join(", "),
    );
    const archived = settled.length - failed.length;
    const status = archived > 0 ? 207 : 500;
    return NextResponse.json(
      {
        ok: false,
        archived,
        failed: failed.map((f) => ({ id: f.id, error: f.error })),
      },
      { status },
    );
  }
  return NextResponse.json({ ok: true, archived: typedRows.length });
}

/**
 * POST /api/agents/[id]/chat
 *
 * Accepts { messages: [{role, content}, ...] }. Last entry is the new
 * user message. Streams an SSE-style newline-delimited JSON event
 * stream back to the client:
 *   { type: "text", delta: string }   - one or more times as tokens land
 *   { type: "done" }                  - end-of-stream marker
 *   { type: "error", message: string} - terminal failure
 *
 * On the server side:
 *   1. Insert the user message.
 *   2. Build persona context (role + title + system_prompt fallback to
 *      description). Pull top-K agent-file chunks via the same RPC the
 *      MCP knowledge_query tool uses; prepend them as "Relevant context".
 *   3. Call chatReply() with our own history + extraPreamble.
 *   4. Run applyBrandFilter on the assistant text. Hard-fail replaces
 *      the visible reply with the operator-warning string but the audit
 *      row + DB persistence still happen.
 *   5. Insert the assistant reply, emit the final delta + {type:"done"}.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId || !ctx.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = ctx.activeOrgId;
  const userId = ctx.userId;
  const { id: agentId } = await params;
  const bad = badUuidResponse(agentId);
  if (bad) return bad;
  const db = supabaseAdmin();

  // Cross-tenant guard. Persona + RAG happen inside buildAgentChatPreamble.
  // max_tokens is the per-agent reasoning budget (migration 0074); null
  // means "use chatReply's DEFAULT_MAX_TOKENS".
  const { data: agent } = await db
    .from("rgaios_agents")
    .select("id, department, max_tokens")
    .eq("id", agentId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }
  // Per-agent max_tokens override. When null we pass nothing so chatReply
  // falls back to its own DEFAULT_MAX_TOKENS.
  const agentMaxTokens =
    (agent as { max_tokens: number | null }).max_tokens ?? undefined;
  // Per-dept ACL. Marketing-only invitee can't POST chat to a sales
  // agent even if they guess the id.
  const allowed = await isDepartmentAllowed(
    {
      userId,
      organizationId: orgId,
      isAdmin: ctx.isAdmin,
    },
    (agent as { department: string | null }).department,
  );
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { messages?: IncomingMessage[]; thread?: string };
  try {
    body = (await req.json()) as {
      messages?: IncomingMessage[];
      thread?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  // Which thread this turn belongs to. "proactive" turns (operator
  // replies sent from the Proactive (CEO) view) + their resulting
  // assistant reply + every system row written for the turn get
  // tagged metadata.thread = "proactive" so GET groups them into the
  // proactive feed. The reply pipeline (preamble / memory / RAG) is
  // IDENTICAL either way - only the persistence tag differs.
  const thread = body.thread === "proactive" ? "proactive" : "main";
  // Merge the thread tag into any metadata object we persist this
  // turn. For the main thread it's a no-op (untagged = main) so we
  // keep rows lean.
  const withThread = <T extends Record<string, unknown>>(meta: T): T =>
    thread === "proactive" ? ({ ...meta, thread } as T) : meta;
  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const userTurns = incoming.filter(
    (m): m is { role: "user" | "assistant"; content: string } =>
      (m?.role === "user" || m?.role === "assistant") &&
      typeof m?.content === "string" &&
      m.content.trim().length > 0,
  );
  const last = userTurns[userTurns.length - 1];
  if (!last || last.role !== "user") {
    return NextResponse.json(
      { error: "Last message must be from the user." },
      { status: 400 },
    );
  }
  // Cap the user turn at 20kb (matches the mini-saas / invites caps).
  // A multi-megabyte body would balloon the supabase row, the LLM
  // preamble, and the brand-filter regex pass.
  const rawLastContent = last.content.slice(0, 20_000);

  // Inbound secret scrub. Operators have pasted live Composio /
  // Anthropic / VPS-root creds into agent chat. Redact before
  // persistence + LLM forward so secrets never land in
  // rgaios_agent_chat_messages, never get embedded into
  // rgaios_company_chunks, and never echo back across agent memory.
  const inboundScrub = redactSecrets(rawLastContent);
  const lastContent = inboundScrub.redacted;
  const inboundHits = inboundScrub.hits;
  if (inboundHits.length > 0) {
    console.warn(
      "[chat] inbound secret_redacted:",
      JSON.stringify({
        org_id: orgId,
        agent_id: agentId,
        kinds: inboundHits.map((h) => h.kind),
      }),
    );
  }

  // 1. Persist. supabase returns errors as values - without the check
  // the user message silently drops, chatReply still burns an LLM call,
  // and a reload shows an empty thread.
  const userInsert = await db
    .from("rgaios_agent_chat_messages")
    .insert({
      organization_id: orgId,
      agent_id: agentId,
      user_id: userId,
      role: "user",
      content: lastContent,
      ...(thread === "proactive"
        ? { metadata: { thread } }
        : {}),
    } as never);
  if (userInsert.error) {
    console.error("[chat] user insert failed:", userInsert.error.message);
    return NextResponse.json(
      { error: "Failed to save your message. Please try again." },
      { status: 500 },
    );
  }

  // 1a. Insight chat queue: when the user replies in Atlas chat AND
  // there's a "sent" insight question awaiting a reply, mark it
  // answered, then promote the next queued insight (if any) to "sent"
  // and seed its question as the assistant's next turn. Keeps
  // insight-driven questions sequenced one-at-a-time per Pedro's rule.
  try {
    await maybePromoteInsightQueue(orgId, agentId);
  } catch (err) {
    console.warn(
      "[chat] insight-queue promotion failed:",
      (err as Error).message,
    );
  }

  // History for chatReply = everything BEFORE the latest user turn.
  // chatReply re-appends the latest user turn itself wrapped with the
  // persona preamble, so we must not include it twice.
  const history = userTurns.slice(0, -1).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // 1b. Passive tool-result recall. The active two-pass path only
  // re-feeds tool/command payloads when a <command> block ran THIS
  // turn. So if the operator pulls emails on turn 1 then asks "what did
  // the 2nd email say?" on turn 2 - no new command - the agent only
  // sees its own short prior reply text, not the data. Fix: pull the
  // last few persisted `chat_commands_executed` rows for this agent and
  // fold a compact digest of their results into the preamble as a
  // read-only "RECENT TOOL RESULTS" block. This does NOT touch the
  // active two-pass path - it's grounding context only, capped tight so
  // it can't balloon the preamble.
  let recallBlock = "";
  try {
    const { data: recallRows } = await db
      .from("rgaios_agent_chat_messages")
      .select("metadata, created_at")
      .eq("organization_id", orgId)
      .eq("agent_id", agentId)
      .eq("metadata->>kind", "chat_commands_executed")
      .or("metadata->>archived.is.null,metadata->>archived.eq.false")
      .order("created_at", { ascending: false })
      .limit(5);
    type RecallResult = {
      ok?: boolean;
      type?: string;
      summary?: string;
      detail?: Record<string, unknown> | null;
    };
    const RECALL_CAP = 3000;
    const PER_RESULT_CAP = 600;
    const lines: string[] = [];
    // Oldest-first so the digest reads chronologically.
    for (const row of [...(recallRows ?? [])].reverse()) {
      const meta = (row as { metadata: Record<string, unknown> | null })
        .metadata;
      const results = Array.isArray(meta?.results)
        ? (meta!.results as RecallResult[])
        : [];
      for (const r of results) {
        const d = r.detail ?? {};
        let payload: string;
        if (
          typeof d.delegated_output === "string" &&
          d.delegated_output
        ) {
          payload = d.delegated_output;
        } else if (
          typeof d.result_preview === "string" &&
          d.result_preview
        ) {
          payload = `${r.summary ?? ""}\n${d.result_preview}`.trim();
        } else {
          payload = r.summary ?? "";
        }
        const type = r.type ?? "command";
        const status = r.ok === false ? " (failed)" : "";
        const entry = `- ${type}${status}: ${payload}`.slice(
          0,
          PER_RESULT_CAP,
        );
        if (entry.trim().length > 2) lines.push(entry);
      }
    }
    if (lines.length > 0) {
      let body = lines.join("\n");
      if (body.length > RECALL_CAP) {
        body = body.slice(0, RECALL_CAP) + "\n[...truncated]";
      }
      recallBlock =
        "\n\n═══ RECENT TOOL RESULTS IN THIS THREAD ═══\n" +
        "Tool calls / delegations you ran on EARLIER turns and their results. " +
        "Use this to answer follow-up questions about that data (\"what did the 2nd email say?\") " +
        "without re-running anything. This is recall context only - do NOT emit new <command> blocks just to re-fetch it.\n\n" +
        body;
    }
  } catch (err) {
    console.warn(
      "[chat] tool-result recall load failed:",
      (err as Error).message,
    );
  }

  // 2. Build the full preamble (persona + org place + memories + brand
  // + RAG over agent files + company corpus). Helper is shared with the
  // per-agent Telegram webhook so both surfaces see the same grounding.
  const extraPreamble =
    (await buildAgentChatPreamble({
      orgId,
      agentId,
      orgName: ctx.activeOrgName,
      queryText: lastContent,
    })) + recallBlock;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      try {
        // Surface inbound redactions to the operator BEFORE the reply
        // streams. Kinds only - fragments stay server-side.
        if (inboundHits.length > 0) {
          emit({
            type: "secret_redacted",
            hits: inboundHits.map((h) => h.kind),
            redactedText: lastContent,
          });
        }

        // 3. Generate the reply. chatReply is non-streaming today (Anthropic
        // OAuth + the Claude Code beta gate don't expose SSE alongside the
        // current beta header), so we emit the brand-filtered text as a
        // single delta. Wire shape stays {type:"text",delta} so the client
        // doesn't care whether tokens land one-by-one or in one chunk -
        // both render identically through the same accumulator.
        const result = await chatReply({
          organizationId: orgId,
          organizationName: ctx.activeOrgName,
          chatId: 0,
          userMessage: lastContent,
          publicAppUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
          agentId,
          historyOverride: history,
          extraPreamble,
          // Dashboard chat has no MCP tool drain - swap "always handoff"
          // for "answer from injected context" in the persona preamble.
          noHandoff: true,
          // Per-agent reasoning budget (migration 0074). undefined when
          // the agent has no override - chatReply uses DEFAULT_MAX_TOKENS.
          maxTokens: agentMaxTokens,
          // Pool rotation: try caller's own claude-max bucket before
          // borrowing other org members' buckets on 429.
          callerUserId: userId,
        });

        if (!result.ok) {
          emit({ type: "error", message: result.error });
          // Persist the error as a system row so the operator can see what
          // happened in the audit feed even if the client navigated away.
          await db.from("rgaios_agent_chat_messages").insert({
            organization_id: orgId,
            agent_id: agentId,
            user_id: null,
            role: "system",
            content: result.error,
            metadata: withThread({ kind: "chat_reply_failed" }),
          } as never);
          // Also log to audit_log so the connections page health probe
          // can detect a stale Claude Max token without burning a real
          // /v1/messages call on every page load.
          try {
            await db.from("rgaios_audit_log").insert({
              organization_id: orgId,
              kind: "chat_reply_failed",
              actor_type: "agent",
              actor_id: agentId,
              detail: { error: result.error, agent_id: agentId },
            } as never);
          } catch {}
          emit({ type: "done" });
          controller.close();
          return;
        }

        // 3b. Reasoning trace. The agent opens its reply with a
        // <thinking> block (REASONING PROTOCOL in preamble.ts) - the
        // ReAct "Thought" step, its real plan for this turn. Pull it
        // out FIRST so the raw XML never reaches the operator, surface
        // it as a `thinking` event + persist a system row + audit row
        // so /trace shows it. If the model didn't emit a block (older
        // persona, terse turn), fall back to the heuristic brief so the
        // operator still sees SOMETHING above the reply.
        const extractedThinking = extractThinking(result.reply);
        const replyBody = extractedThinking.visibleReply;
        try {
          const brief =
            extractedThinking.thinking ??
            (await generateThinkingBrief(lastContent));
          if (brief) {
            emit({ type: "thinking", brief });
            await db.from("rgaios_agent_chat_messages").insert({
              organization_id: orgId,
              agent_id: agentId,
              user_id: null,
              role: "system",
              content: `Thinking: ${brief}`,
              metadata: withThread({
                kind: "chat_thinking",
                source: extractedThinking.thinking ? "agent" : "heuristic",
              }),
            } as never);
            await db.from("rgaios_audit_log").insert({
              organization_id: orgId,
              kind: "chat_thinking",
              actor_type: "agent",
              actor_id: agentId,
              detail: {
                brief,
                source: extractedThinking.thinking ? "agent" : "heuristic",
                message_preview: lastContent.slice(0, 100),
              },
            } as never);
          }
        } catch {
          // Best-effort - never block the reply on the thinking trace.
        }

        // 4a. Extract <task> blocks BEFORE the brand-voice filter. The
        // task description often quotes Rawgrowth's own banned-words
        // list verbatim (Atlas writes "Zero banned words: game-changer,
        // unlock, leverage..."), which trips the filter on the entire
        // reply even though the customer-visible text is clean. Pulling
        // tasks out first means filter only sees the surrounding prose.
        let preFilterText = replyBody;
        let createdTasks: Array<{
          routineId: string;
          runId: string | null;
          title: string;
          assigneeAgentId: string;
          assigneeName: string;
        }> = [];
        try {
          const ext = await extractAndCreateTasks({
            orgId,
            speakerAgentId: agentId,
            reply: replyBody,
          });
          preFilterText = ext.visibleReply || replyBody;
          createdTasks = ext.tasks;
        } catch (err) {
          console.warn(
            "[chat] task extraction failed:",
            (err as Error).message,
          );
        }

        // 4a-ter. JSON command extraction. Atlas (CEO) and dept heads
        // can emit <command type="tool_call|agent_invoke|routine_create">
        // blocks whose body is JSON. The handler executes each command
        // server-side (composio action / dispatch a routine to a sub-
        // agent / create a scheduled routine) and we post a single
        // system message summarising results back into the chat. This
        // is the response-side substitute for the MCP wire-protocol
        // that Anthropic's OAuth gate refuses to combine with on-call
        // tool_use today.
        // `detail` carries the structured payload the orchestration
        // cards render: composio result_preview, the delegated agent's
        // real output + status, etc. Keep it on the wire so the client
        // shows the actual content, not just "dispatched".
        let commandResults: Array<{
          ok: boolean;
          type: string;
          summary: string;
          detail?: Record<string, unknown>;
        }> = [];
        try {
          const ext = await extractAndExecuteCommands({
            orgId,
            speakerAgentId: agentId,
            reply: preFilterText,
            callerUserId: userId,
            // Live status: stream "Kasia is answering now" / "Running
            // gmail" the moment each command starts, before the slow
            // tool call or delegated run returns.
            onProgress: (ev) => {
              const verb =
                ev.type === "agent_invoke"
                  ? `${ev.label} is answering now`
                  : ev.type === "tool_call"
                    ? `Running ${ev.label}`
                    : ev.type === "routine_create"
                      ? `Creating routine "${ev.label}"`
                      : `Working on ${ev.label}`;
              emit({ type: "command_running", verb, label: ev.label });
            },
          });
          if (ext.results.length > 0) {
            preFilterText = ext.visibleReply || preFilterText;
            commandResults = ext.results;
          }
        } catch (err) {
          console.warn(
            "[chat] command extraction failed:",
            (err as Error).message,
          );
        }

        // 4a-2. Second pass: feed the tool/delegation results back to the
        // agent so the operator-visible reply actually USES the data -
        // "Here are the last 5 posts: ..." instead of "Pulling now."
        // (the pull already happened). One extra LLM call, only when a
        // command ran. The agent is told NOT to emit new <command>
        // blocks, and any it emits anyway are stripped, not executed.
        if (commandResults.length > 0) {
          try {
            const resultsBlock = commandResults
              .map((r, i) => {
                const d = r.detail ?? {};
                // agent_invoke: the dept head's real output. tool_call:
                // the human summary PLUS the raw payload preview, so the
                // agent can actually answer questions about it ("read
                // the body", "which email is the payment one") instead
                // of only seeing the one-line summary.
                let out: string;
                if (
                  typeof d.delegated_output === "string" &&
                  d.delegated_output
                ) {
                  out = d.delegated_output;
                } else if (
                  r.type === "tool_call" &&
                  typeof d.result_preview === "string" &&
                  d.result_preview
                ) {
                  out = `${r.summary}\n\nRaw payload (use this to answer detail questions):\n${d.result_preview}`;
                } else {
                  out = r.summary;
                }
                return `[${i + 1}] ${r.type} ${r.ok ? "(ok)" : "(failed)"}:\n${out}`;
              })
              .join("\n\n");
            const pass2 = await chatReply({
              organizationId: orgId,
              organizationName: ctx.activeOrgName,
              chatId: 0,
              userMessage: lastContent,
              publicAppUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
              agentId,
              historyOverride: [
                ...history,
                { role: "user", content: lastContent },
              ],
              extraPreamble:
                extraPreamble +
                "\n\n═══ TOOL RESULTS - YOU ALREADY RAN THESE ═══\n" +
                "You emitted command block(s) on the previous turn and the system executed them. The real results are below.\n\n" +
                "Open your reply with a <thinking> block that is your OBSERVATION step: in one or two sentences, say what the results actually show and what you make of them (\"3 emails back, all the same membership-confirmation template\" / \"Kasia delivered 3 usable hooks, the contrarian one is strongest\"). This is the Observation in Thought -> Action -> Observation - it must reference the real data, not be generic.\n\n" +
                // RANKED / FILTERED GROUNDING (Marti GAP #12 wrong-info root cause,
                // inv-logic-thinking D5). When operator asked for a ranked or filtered
                // list, OBSERVATION must declare the ranking field + window + source
                // and every visible item must cite its metric.
                "RANKED / FILTERED ANSWERS - GROUNDING RULE: when the operator asked for a ranked or filtered list (top N by X, latest N in window Y, most-engaged Z), your OBSERVATION <thinking> MUST include a one-line declaration: `ranked_by: <field>, window: <if any>, source: <tool/dataset>`. The visible answer MUST inline-cite the metric value per item that justifies its position (\"@advicewithjean - 2,125 comments\", \"@codiesanchez - 1,261 comments\"). NEVER claim 'top by X' while ordering by anything else - that is the wrong-info failure mode. If the tool result surface includes a `Top by comments: ...` header (apify or composio Instagram), rank YOUR visible reply by THAT header, not by the order of the body.\n\n" +

                "Then write your final answer to the operator USING this data - quote the actual emails / posts / numbers / the delegated agent's actual output. Do NOT say 'pulling now' or 'on it' for the work that is already done. You MAY emit ONE follow-on <command> block IF the results genuinely call for a next action you could not have known to take before seeing them - e.g. now that you have the top post, dispatch Kasia to draft hooks off it. If you do, the system runs it and shows the card; if you only say you are doing it, you MUST emit it (SAY-IT-MEANS-DO-IT). Do NOT re-run a command that already ran above.\n\n" +
                resultsBlock,
              noHandoff: true,
              // Same per-agent reasoning budget as pass 1.
              maxTokens: agentMaxTokens,
              callerUserId: userId,
            });
            if (pass2.ok && pass2.reply.trim()) {
              // Pass 2 CAN legitimately emit a command - a delegation or
              // tool call that only makes sense after seeing the pass-1
              // results ("now that I have the top post, dispatch Kasia").
              // The old code stripped + discarded those, so the agent
              // narrated a dispatch it never actually emitted (the e2e
              // test caught exactly this). Execute pass-2 commands ONCE
              // more - bounded, no pass 3 - and append their cards to
              // commandResults so they render + persist with the rest.
              let pass2Visible = pass2.reply;
              try {
                const ext2 = await extractAndExecuteCommands({
                  orgId,
                  speakerAgentId: agentId,
                  reply: pass2.reply,
                  callerUserId: userId,
                  onProgress: (ev) => {
                    const verb =
                      ev.type === "agent_invoke"
                        ? `${ev.label} is answering now`
                        : ev.type === "tool_call"
                          ? `Running ${ev.label}`
                          : ev.type === "routine_create"
                            ? `Creating routine "${ev.label}"`
                            : `Working on ${ev.label}`;
                    emit({ type: "command_running", verb, label: ev.label });
                  },
                });
                if (ext2.results.length > 0) {
                  pass2Visible = ext2.visibleReply || pass2.reply;
                  commandResults = [...commandResults, ...ext2.results];
                }
              } catch (err) {
                console.warn(
                  "[chat] pass-2 command extraction failed:",
                  (err as Error).message,
                );
              }
              const pass2Thinking = extractThinking(pass2Visible);
              // Pass 2's <thinking> is the Observation step - emit it as
              // a second reasoning trace so the operator sees the full
              // ReAct chain: plan (pass 1) -> tool cards -> observation
              // (pass 2) -> answer. Best-effort, never blocks the reply.
              if (pass2Thinking.thinking) {
                emit({ type: "thinking", brief: pass2Thinking.thinking });
                try {
                  await db.from("rgaios_agent_chat_messages").insert({
                    organization_id: orgId,
                    agent_id: agentId,
                    user_id: null,
                    role: "system",
                    content: `Thinking: ${pass2Thinking.thinking}`,
                    metadata: withThread({ kind: "chat_thinking", source: "agent", step: "observation" }),
                  } as never);
                } catch {}
              }
              if (pass2Thinking.visibleReply) {
                preFilterText = pass2Thinking.visibleReply;
              }
            }
          } catch (err) {
            console.warn(
              "[chat] second-pass reply failed:",
              (err as Error).message,
            );
          }
        }

        // 4a-bis. Data-ask extraction. Atlas (or any agent following the
        // DATA-ASK PROTOCOL in preamble.ts) can emit <need scope="..."> blocks
        // when it genuinely lacks data. We strip those blocks from the
        // visible reply, post a follow-up assistant message asking the
        // operator to supply the data, and surface the scope so the UI
        // can later upgrade these into Data Entry stubs.
        try {
          const needRegex = /<need(?:\s+scope=["']([^"']+)["'])?\s*>([\s\S]*?)<\/need>/gi;
          const needs: Array<{ scope: string; text: string }> = [];
          let m: RegExpExecArray | null;
          while ((m = needRegex.exec(preFilterText)) !== null) {
            const scope = (m[1] ?? "other").trim();
            const text = m[2].trim();
            if (text) needs.push({ scope, text });
          }
          if (needs.length > 0) {
            preFilterText = preFilterText.replace(needRegex, "").trim();
            await Promise.all(
              needs.map((n) =>
                db.from("rgaios_agent_chat_messages").insert({
                  organization_id: orgId,
                  agent_id: agentId,
                  user_id: null,
                  role: "assistant",
                  content: `I need: ${n.text}. Paste it in this chat or use Data Entry.`,
                  metadata: withThread({ kind: "data_ask", scope: n.scope }) as never,
                } as never),
              ),
            );
          }
        } catch (err) {
          console.warn(
            "[chat] data-ask extraction failed:",
            (err as Error).message,
          );
        }

        // 4a-quater. Shared-memory extraction. Agents emit
        // <shared_memory importance="N" scope="...">FACT</shared_memory>
        // when they learn something peers need. extractSharedMemoryBlocks
        // exists but was never wired into the dashboard chat route, so
        // the raw XML leaked into the visible reply AND the fact was
        // never persisted. Now: strip the blocks, persist each fact.
        try {
          const sm = await persistSharedMemoryFromReply({
            orgId,
            sourceAgentId: agentId,
            sourceChatId: null,
            reply: preFilterText,
          });
          preFilterText = sm.visibleReply || preFilterText;
        } catch (err) {
          console.warn(
            "[chat] shared-memory extraction failed:",
            (err as Error).message,
          );
        }

        // 4b. Brand-voice filter on the visible text only. Audit row is
        // written inside applyBrandFilter for both regenerated and
        // hard-fail outcomes - no extra writes needed here.
        const filtered = await applyBrandFilter(preFilterText, {
          organizationId: orgId,
          agentId,
          surface: SURFACE,
        });

        const preRedactVisible = filtered.ok ? filtered.text : HARD_FAIL_MESSAGE;

        // Outbound secret scrub. Models echo back pasted creds in
        // their own "rotate that key" warnings (Scan repeated
        // ak_gHrg9Sor... verbatim). Redact-on-finalize is the
        // security gate - intermediate buffer in client is
        // best-effort only.
        const outboundScrub = redactSecrets(preRedactVisible);
        const visibleText = outboundScrub.redacted;
        if (outboundScrub.hits.length > 0) {
          console.warn(
            "[chat] outbound secret_redacted:",
            JSON.stringify({
              org_id: orgId,
              agent_id: agentId,
              kinds: outboundScrub.hits.map((h) => h.kind),
            }),
          );
          emit({
            type: "secret_redacted",
            hits: outboundScrub.hits.map((h) => h.kind),
          });
        }

        const persistMetadata = filtered.ok
          ? {
              regenerated: filtered.regenerated,
              tasks_created: createdTasks.map((t) => ({
                routine_id: t.routineId,
                run_id: t.runId,
                assignee_agent_id: t.assigneeAgentId,
                title: t.title,
              })),
            }
          : {
              kind: "brand_voice_hard_fail",
              hits: filtered.hits,
              final_attempt_excerpt: filtered.finalAttempt.slice(0, 500),
            };

        emit({ type: "text", delta: visibleText });
        if (createdTasks.length > 0) {
          emit({ type: "tasks_created", tasks: createdTasks });
        }
        if (commandResults.length > 0) {
          // Surface each command result as a system row so the operator
          // can see WHAT just got executed in their behalf (Composio
          // action ran, dept head was invoked, routine created). Best-
          // effort - the visible chat text already streamed.
          emit({ type: "commands_executed", results: commandResults });
          const summary = commandResults
            .map(
              (r, i) => `${i + 1}. [${r.ok ? "ok" : "fail"}] ${r.type} - ${r.summary}`,
            )
            .join("\n");
          try {
            await db.from("rgaios_agent_chat_messages").insert({
              organization_id: orgId,
              agent_id: agentId,
              user_id: null,
              role: "system",
              content: `Commands executed:\n${summary}`,
              metadata: withThread({
                kind: "chat_commands_executed",
                results: commandResults,
              }) as never,
            } as never);
          } catch (err) {
            console.warn(
              "[chat] command system message insert failed:",
              (err as Error).message,
            );
          }
        }

        // 5. Persist the assistant reply (or operator-warning sentinel).
        // Log the cause of any failure so we don't silently lose a reply
        // the operator just saw stream into the page. The client already
        // has the visible text so we don't fail the request - just
        // surface the issue in server logs for follow-up.
        const assistantInsert = await db
          .from("rgaios_agent_chat_messages")
          .insert({
            organization_id: orgId,
            agent_id: agentId,
            user_id: null,
            role: "assistant",
            content: visibleText,
            metadata: withThread(persistMetadata),
          } as never);
        if (assistantInsert.error) {
          console.error(
            "[chat] assistant insert failed:",
            assistantInsert.error.message,
          );
        }

        // 5b. Extract a single short memory from this exchange so future
        // chats remember decisions / facts / preferences. Heuristic v0:
        // pull the user's question + first sentence of the reply, write
        // a one-line "user asked X; agent decided Y" memory. Future:
        // call a small LLM to do this properly. Best-effort, non-fatal.
        //
        // Skip noisy exchanges - greetings, ack-only messages, and
        // hard-fail replies aren't worth remembering and just bloat the
        // preamble's Past Memories section. Thresholds picked from
        // looking at the rawgrowth-mvp memory log: under 30 chars is
        // basically always "thanks" / "ok" / "sim" / a typo.
        const skipMemory =
          !filtered.ok ||
          lastContent.trim().length < 30 ||
          visibleText.trim().length < 30;
        if (!skipMemory) {
          try {
            const userBit = lastContent.trim().slice(0, 140);
            const replyBit =
              visibleText.trim().split(/[.!?\n]/)[0]?.slice(0, 200) ?? "";
            const fact = `User asked: "${userBit}". I responded with: "${replyBit}".`;
            await db.from("rgaios_audit_log").insert({
              organization_id: orgId,
              kind: "chat_memory",
              actor_type: "agent",
              actor_id: agentId,
              detail: {
                agent_id: agentId,
                fact,
                user_id: userId,
              },
            });
          } catch (err) {
            console.warn("[chat] memory extract failed:", (err as Error).message);
          }
        }

        emit({ type: "done" });
        controller.close();
      } catch (err) {
        emit({
          type: "error",
          message: (err as Error).message ?? "stream failed",
        });
        emit({ type: "done" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
