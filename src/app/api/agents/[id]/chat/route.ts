import { NextRequest, NextResponse } from "next/server";

import { getOrgContext } from "@/lib/auth/admin";
import { isDepartmentAllowed } from "@/lib/auth/dept-acl";
import { supabaseAdmin } from "@/lib/supabase/server";
import { chatReply } from "@/lib/agent/chat";
import { applyBrandFilter } from "@/lib/brand/apply-filter";
import { buildAgentChatPreamble } from "@/lib/agent/preamble";
import { extractAndCreateTasks } from "@/lib/agent/tasks";

export const runtime = "nodejs";

const HISTORY_LIMIT = 50;
const SURFACE = "agent_chat";

const HARD_FAIL_MESSAGE =
  "[brand voice guard] Reply withheld - copy still contained banned words after one regeneration. An operator needs to review.";

type IncomingMessage = { role: string; content: string };

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
  const { data: agent } = await db
    .from("rgaios_agents")
    .select("role")
    .eq("id", agentId)
    .maybeSingle();
  if ((agent as unknown as { role?: string } | null)?.role !== "ceo") return;

  const now = new Date().toISOString();

  // Mark all currently-sent insights as answered. There should only be
  // one but be tolerant of pre-existing dupes.
  await db
    .from("rgaios_insights")
    .update({ chat_state: "answered", chat_state_updated_at: now } as never)
    .eq("organization_id", orgId)
    .eq("chat_state", "sent");

  // Pick the oldest queued insight to promote.
  const { data: nextRow } = await db
    .from("rgaios_insights")
    .select("id, title, suggested_action, reason")
    .eq("organization_id", orgId)
    .eq("chat_state", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

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

  await db.from("rgaios_agent_chat_messages").insert({
    organization_id: orgId,
    agent_id: agentId,
    user_id: null,
    role: "assistant",
    content,
    metadata: { source: "insight", insight_id: next.id, promoted: true },
  } as never);

  await db
    .from("rgaios_insights")
    .update({ chat_state: "sent", chat_state_updated_at: now } as never)
    .eq("id", next.id);
}

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

  // Cross-tenant guard. Persona + RAG happen inside buildAgentChatPreamble.
  const { data: agent } = await db
    .from("rgaios_agents")
    .select("id, department")
    .eq("id", agentId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }
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

  // 1. Persist the user message. Bail loudly if the insert fails - the
  // supabase client returns errors as a plain object instead of throwing,
  // so without an explicit check a transient DB blip would silently drop
  // the message, the route would still call chatReply (burning an LLM
  // call), and a reload would show an empty thread. Surface a 500 so the
  // client can show an error and the user can retry.
  const userInsert = await db
    .from("rgaios_agent_chat_messages")
    .insert({
      organization_id: orgId,
      agent_id: agentId,
      user_id: userId,
      role: "user",
      content: last.content,
    });
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
  await maybePromoteInsightQueue(orgId, agentId);

  // History for chatReply = everything BEFORE the latest user turn.
  // chatReply re-appends the latest user turn itself wrapped with the
  // persona preamble, so we must not include it twice.
  const history = userTurns.slice(0, -1).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // 2. Build the full preamble (persona + org place + memories + brand
  // + RAG over agent files + company corpus). Helper is shared with the
  // per-agent Telegram webhook so both surfaces see the same grounding.
  const extraPreamble = await buildAgentChatPreamble({
    orgId,
    agentId,
    orgName: ctx.activeOrgName,
    queryText: last.content,
  });

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
          // Dashboard chat has no MCP tool drain - swap "always handoff"
          // for "answer from injected context" in the persona preamble.
          noHandoff: true,
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

        // 4a. Extract <task> blocks BEFORE the brand-voice filter. The
        // task description often quotes Rawgrowth's own banned-words
        // list verbatim (Atlas writes "Zero banned words: game-changer,
        // unlock, leverage..."), which trips the filter on the entire
        // reply even though the customer-visible text is clean. Pulling
        // tasks out first means filter only sees the surrounding prose.
        let preFilterText = result.reply;
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
            reply: result.reply,
          });
          preFilterText = ext.visibleReply || result.reply;
          createdTasks = ext.tasks;
        } catch (err) {
          console.warn(
            "[chat] task extraction failed:",
            (err as Error).message,
          );
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
                  metadata: { kind: "data_ask", scope: n.scope } as never,
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

        // 4b. Brand-voice filter on the visible text only. Audit row is
        // written inside applyBrandFilter for both regenerated and
        // hard-fail outcomes - no extra writes needed here.
        const filtered = await applyBrandFilter(preFilterText, {
          organizationId: orgId,
          agentId,
          surface: SURFACE,
        });

        const visibleText = filtered.ok ? filtered.text : HARD_FAIL_MESSAGE;

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
          last.content.trim().length < 30 ||
          visibleText.trim().length < 30;
        if (!skipMemory) {
          try {
            const userBit = last.content.trim().slice(0, 140);
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
