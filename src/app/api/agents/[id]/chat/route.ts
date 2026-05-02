import { NextRequest, NextResponse } from "next/server";

import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { chatReply } from "@/lib/agent/chat";
import { applyBrandFilter } from "@/lib/brand/apply-filter";
import { embedOne, toPgVector } from "@/lib/knowledge/embedder";

export const runtime = "nodejs";

const HISTORY_LIMIT = 50;
const RAG_TOP_K = 3;
const SURFACE = "agent_chat";

const HARD_FAIL_MESSAGE =
  "[brand voice guard] Reply withheld - copy still contained banned words after one regeneration. An operator needs to review.";

type IncomingMessage = { role: string; content: string };

type ChunkRow = {
  filename: string;
  chunk_index: number;
  content: string;
  similarity: number;
};

/**
 * GET /api/agents/[id]/chat
 *
 * Returns the last HISTORY_LIMIT messages for this agent (oldest first
 * so the client can render top-to-bottom without flipping). Used to
 * hydrate AgentChatTab on first mount so refreshing the panel keeps
 * the conversation visible.
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

  const messages = [...(data ?? [])].reverse();
  return NextResponse.json({ messages });
}

/**
 * DELETE /api/agents/[id]/chat
 * "New chat" - soft-archives the current visible thread by tagging
 * each message with metadata.archived = true + an archived_at stamp.
 * The GET handler filters those out so the tab starts fresh, but the
 * raw history is still in rgaios_agent_chat_messages and can be
 * restored / surfaced later. Memory tab + extracted chat_memory rows
 * are untouched.
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
  const { data: rows } = await db
    .from("rgaios_agent_chat_messages")
    .select("id, metadata")
    .eq("organization_id", orgId)
    .eq("agent_id", agentId)
    .or("metadata->>archived.is.null,metadata->>archived.eq.false");
  const stamp = new Date().toISOString();
  const typedRows = (rows ?? []) as Array<{ id: string; metadata: Record<string, unknown> | null }>;
  await Promise.all(
    typedRows.map((r) => {
      const next = { ...(r.metadata ?? {}), archived: true, archived_at: stamp };
      return db
        .from("rgaios_agent_chat_messages")
        .update({ metadata: next as never })
        .eq("id", r.id);
    }),
  );
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
  const db = supabaseAdmin();

  // Cross-tenant guard + persona load in one round trip.
  const { data: agent } = await db
    .from("rgaios_agents")
    .select(
      "id, name, title, role, description, organization_id",
    )
    .eq("id", agentId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // The system_prompt column lands in migration 0036 (P0 #3 in the plan).
  // Until that ships, fall back to description so this route still works
  // on the v3 cloud db before #3 is applied. The cast keeps the types
  // honest without forcing a full Database<...> regeneration.
  const agentRow = agent as typeof agent & { system_prompt?: string | null };
  const personaPrompt =
    (agentRow.system_prompt && agentRow.system_prompt.trim()) ||
    (agentRow.description && agentRow.description.trim()) ||
    "";

  let body: { messages?: IncomingMessage[] };
  try {
    body = (await req.json()) as { messages?: IncomingMessage[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
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

  // 1. Persist the user message.
  await db.from("rgaios_agent_chat_messages").insert({
    organization_id: orgId,
    agent_id: agentId,
    user_id: userId,
    role: "user",
    content: last.content,
  });

  // History for chatReply = everything BEFORE the latest user turn.
  // chatReply re-appends the latest user turn itself wrapped with the
  // persona preamble, so we must not include it twice.
  const history = userTurns.slice(0, -1).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // 2. Optional RAG retrieval. Failures here are non-fatal - we still
  // reply, just without grounded context.
  let extraPreamble = "";
  const personaLines: string[] = [];
  if (agentRow.role) personaLines.push(`Role: ${agentRow.role}`);
  if (agentRow.title) personaLines.push(`Title: ${agentRow.title}`);
  if (personaPrompt) personaLines.push(`Persona: ${personaPrompt}`);
  if (personaLines.length > 0) {
    extraPreamble += personaLines.join("\n");
  }

  // Org place - tell the agent who they report to and who reports to
  // them. Lets dept heads coordinate cross-team work without inventing
  // org structure.
  try {
    const { data: agentRow2 } = await db
      .from("rgaios_agents")
      .select("reports_to, department")
      .eq("id", agentId)
      .maybeSingle();
    const reportsToId = (agentRow2 as { reports_to: string | null } | null)?.reports_to;
    let parentLabel: string | null = null;
    if (reportsToId) {
      const { data: parent } = await db
        .from("rgaios_agents")
        .select("name, role")
        .eq("id", reportsToId)
        .maybeSingle();
      const p = parent as { name: string; role: string } | null;
      if (p) parentLabel = `${p.name} (${p.role})`;
    }
    const { data: directs } = await db
      .from("rgaios_agents")
      .select("name, role")
      .eq("organization_id", orgId)
      .eq("reports_to", agentId);
    const directList = (directs ?? []) as Array<{ name: string; role: string }>;
    const lines: string[] = [];
    if (parentLabel) lines.push(`You report to: ${parentLabel}.`);
    if (directList.length > 0) {
      lines.push(
        `You have ${directList.length} direct report${directList.length === 1 ? "" : "s"}: ${directList.map((d) => `${d.name} (${d.role})`).join(", ")}.`,
      );
    }
    if (lines.length > 0) {
      extraPreamble +=
        (extraPreamble ? "\n\n" : "") +
        `Your place in the org (use this when coordinating cross-team work):\n${lines.join("\n")}`;
    }
  } catch {}

  // Persistent agent memories - load the last 15 chat_memory entries
  // from the audit log so this agent "remembers" decisions, facts, and
  // user preferences across new chats. The extraction step at the end
  // of this route writes new ones.
  try {
    const { data: memories } = await db
      .from("rgaios_audit_log")
      .select("ts, detail")
      .eq("organization_id", orgId)
      .eq("kind", "chat_memory")
      .filter("detail->>agent_id", "eq", agentId)
      .order("ts", { ascending: false })
      .limit(15);
    const memoryRows = (memories ?? []) as Array<{
      ts: string;
      detail: { fact?: string; agent_id?: string };
    }>;
    if (memoryRows.length > 0) {
      const block = memoryRows
        .filter((m) => m.detail?.fact)
        .reverse()
        .map((m, i) => `${i + 1}. ${m.detail.fact}`)
        .join("\n");
      if (block) {
        extraPreamble +=
          (extraPreamble ? "\n\n" : "") +
          `Things you remember from past conversations with this user (treat as facts about their business + preferences):\n${block}`;
      }
    }
  } catch {}

  // Brand profile - inject the latest approved markdown so every reply
  // is grounded in the org's voice/positioning/offer details.
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
      extraPreamble +=
        (extraPreamble ? "\n\n" : "") +
        `Brand profile for ${ctx.activeOrgName ?? "this organisation"} (THIS IS THE CLIENT YOU WORK FOR - reference their offer, voice, ICP, frameworks, and banned-words list explicitly when relevant. Generic advice is a failure mode):\n\n${content}`;
    }
  } catch {}

  try {
    const queryVector = await embedOne(last.content);

    // Per-agent files (RAG over rgaios_agent_files chunks).
    const { data: rows } = await db.rpc("rgaios_match_agent_chunks", {
      p_agent_id: agentId,
      p_organization_id: orgId,
      p_query: toPgVector(queryVector),
      p_top_k: RAG_TOP_K,
    });
    const chunks = (rows ?? []) as ChunkRow[];
    if (chunks.length > 0) {
      const block = chunks
        .map(
          (c, i) =>
            `[${i + 1}] ${c.filename} (chunk ${c.chunk_index}):\n${c.content}`,
        )
        .join("\n\n");
      extraPreamble +=
        (extraPreamble ? "\n\n" : "") +
        `Relevant context retrieved from this agent's uploaded files (cite when you use them):\n\n${block}`;
    }

    // Note: knowledge files (markdown SOPs uploaded on /knowledge)
    // already flow into rgaios_company_chunks via the embedding pipeline,
    // so they're picked up by the company corpus RPC below. No separate
    // query needed.

    // Company corpus (rgaios_company_chunks - intake + brand + scrape +
    // sales calls + onboarding docs unioned). Topical chunks across the
    // whole organisation.
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
      extraPreamble +=
        (extraPreamble ? "\n\n" : "") +
        `Company-wide context (intake / brand / scraped content / sales calls):\n\n${block}`;
    }
  } catch {
    // No embedder, no key, or RPC missing on this deploy. Continue.
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      try {
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
          userMessage: last.content,
          publicAppUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
          agentId,
          historyOverride: history,
          extraPreamble,
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
            metadata: { kind: "chat_reply_failed" },
          });
          emit({ type: "done" });
          controller.close();
          return;
        }

        // 4. Brand-voice filter. Audit row is written inside applyBrandFilter
        // for both regenerated and hard-fail outcomes - no extra writes
        // needed here.
        const filtered = await applyBrandFilter(result.reply, {
          organizationId: orgId,
          agentId,
          surface: SURFACE,
        });

        const visibleText = filtered.ok ? filtered.text : HARD_FAIL_MESSAGE;
        const persistMetadata = filtered.ok
          ? { regenerated: filtered.regenerated }
          : {
              kind: "brand_voice_hard_fail",
              hits: filtered.hits,
              final_attempt_excerpt: filtered.finalAttempt.slice(0, 500),
            };

        emit({ type: "text", delta: visibleText });

        // 5. Persist the assistant reply (or operator-warning sentinel).
        await db.from("rgaios_agent_chat_messages").insert({
          organization_id: orgId,
          agent_id: agentId,
          user_id: null,
          role: "assistant",
          content: visibleText,
          metadata: persistMetadata,
        });

        // 5b. Extract a single short memory from this exchange so future
        // chats remember decisions / facts / preferences. Heuristic v0:
        // pull the user's question + first 200 chars of the reply, write
        // a one-line "user asked X; agent decided Y" memory. Future:
        // call a small LLM to do this properly. Best-effort, non-fatal.
        try {
          const userBit = last.content.trim().slice(0, 140);
          const replyBit = visibleText.trim().split(/[.!?\n]/)[0]?.slice(0, 200) ?? "";
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
