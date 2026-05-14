"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  ArrowUp,
  ArrowRightLeft,
  Bot,
  Brain,
  Check,
  ChevronRight,
  ClipboardList,
  Clock,
  Code,
  Cpu,
  Crown,
  Eye,
  Megaphone,
  Palette,
  Paperclip,
  PhoneCall,
  Sparkles,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";

import { Response } from "@/components/ui/response";
import { Button } from "@/components/ui/button";
import AgentPlanPanel from "@/components/agents/AgentPlanPanel";
import { AGENT_ROLES } from "@/lib/agents/constants";

// One executed <command> block: a Composio tool call, an agent
// delegation, or a routine creation. Carried on the system ChatMessage
// so Bubble can render a structured orchestration card instead of a
// flat "Commands executed:" text line. `detail` holds the structured
// payload the card renders (composio result, the delegated agent's real
// output + status, etc.).
type CommandResult = {
  ok: boolean;
  type: string;
  summary: string;
  detail?: Record<string, unknown>;
};

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  // System-message variant. When unset, Bubble falls back to parsing
  // the legacy string prefixes ("Thinking: ", "Commands executed:")
  // so DB-loaded history still renders as rich cards.
  kind?: "thinking" | "commands" | "tasks" | "secret" | "running" | "plain";
  // Structured payload for kind==="commands".
  commands?: CommandResult[];
};

// Rotating thinking-frame phrases shown in the pending assistant
// bubble before the first stream delta arrives. Mirrors the Telegram
// path (src/app/api/webhooks/telegram/[connectionId]/route.ts) so
// chat surface and bot surface feel consistent. Emoji stripped for
// the web bubble since the Bubble component already shows a role
// icon to the left.
const THINKING_FRAMES = [
  "Thinking…",
  "Pondering…",
  "Analysing…",
  "Reasoning…",
  "Looking into it…",
  "Composing reply…",
];

type HistoryRow = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
};

// A row as returned by GET /api/agents/[id]/chat - carries metadata so
// the client can keep the proactive feed coherent across reloads.
type ChatRow = {
  id?: string;
  role: string;
  content: string;
  created_at?: string;
  metadata?: Record<string, unknown> | null;
};

// Which conversation the operator is looking at. "main" is the normal
// operator <-> agent thread; "proactive" is the CEO agent's unprompted
// feed (atlas-coordinate cron + insight anomalies) which is ALSO a
// full interactive chat - the operator can reply there and the agent
// answers with the same context pipeline.
type ThreadId = "main" | "proactive";

interface AgentChatTabProps {
  agentId: string;
  agentName?: string;
  agentRole?: string | null;
  agentTitle?: string;
  // SSR-loaded thread so the panel renders existing messages on first
  // paint instead of waiting on a useEffect fetch. Eliminates the
  // hydration race where Playwright reads bodyText before the client
  // GET completes under load. Note: the SSR query only selects
  // {role, content} (no metadata), so it cannot tell main vs proactive
  // rows apart - the client always reconciles via the GET on mount,
  // which returns the authoritative split.
  initialMessages?: Array<{ role: string; content: string }>;
}

// Lucide icons keyed by the string the AGENT_ROLES catalog stores.
const ROLE_ICON_MAP = {
  Crown,
  Cpu,
  Code,
  Megaphone,
  PhoneCall,
  ClipboardList,
  Palette,
  Bot,
} as const;
type RoleIconKey = keyof typeof ROLE_ICON_MAP;


// Starter prompts surfaced as chips on an empty conversation. Keys are
// the title-cased role labels stored in role-templates.ts (Copywriter,
// SDR, etc.), with role-value fallbacks (ceo, marketer) so seeded agents
// hit the chip set even when their title is freeform.
const ROLE_STARTERS: Record<string, string[]> = {
  ceo: [
    "Run a cross-department health check",
    "Draft a 3-bullet weekly briefing",
    "Which department needs my attention this week?",
  ],
  copywriter: [
    "Draft a 3-line LinkedIn hook",
    "Audit my last email send",
    "PAS frame this offer for me",
  ],
  "media buyer": [
    "Plan a $500/day Meta test",
    "Audit my last week of Google ads",
    "Suggest 3 creative angles for our offer",
  ],
  sdr: [
    "Write a 6-touch cold cadence",
    "Personalise this opener with one public signal",
    "Handle the objection: send me info",
  ],
  "marketing manager": [
    "Plan this week's marketing sprint",
    "Pick the single Friday number to report",
    "Brief the copywriter on a new test",
  ],
  "sales manager": [
    "Walk me through the commit forecast",
    "Coach an AE on a stalled deal",
    "Pick one risk that could move the number",
  ],
  "operations manager": [
    "Plan a 7-day client onboarding",
    "Audit a stuck account by handoff",
    "Draft a change order template",
  ],
  "finance manager": [
    "Project runway in 3 scenarios",
    "Review last month close",
    "Pick the top 3 cost cuts",
  ],
  "engineering manager": [
    "Plan the next 2-week sprint",
    "Review a stalled PR",
    "Triage a production outage",
  ],
  "backend engineer": [
    "Sketch a SQL migration for a new feature",
    "Add idempotency to this webhook",
    "Write a failing test for this bug",
  ],
  "frontend engineer": [
    "List data needs for this screen",
    "Fix the loading + empty + error states",
    "Refactor this client component",
  ],
  "qa engineer": [
    "Draft a test plan for this PR",
    "Write a regression test for this bug",
    "Run a smoke pass on the deployed preview",
  ],
  "content strategist": [
    "Plan a quarterly editorial calendar",
    "Repurpose this long-form into 8 atomic pieces",
    "Outline next week's lead piece",
  ],
  "social media manager": [
    "Plan a 7-day social schedule",
    "Repurpose this interview into 8 short posts",
    "Test 3 alternate hooks for this post",
  ],
  "project coordinator": [
    "Build a 4-week project plan",
    "Draft this week's status one-pager",
    "List the top 3 risks on the project",
  ],
  bookkeeper: [
    "Run the month-end close checklist",
    "Reconcile last week of transactions",
    "Spot variance vs last month",
  ],
  marketer: [
    "Plan a 1-week marketing experiment",
    "Pick the one number to report on Friday",
    "Brief a creative test in 5 bullets",
  ],
  ops: [
    "Plan a 7-day onboarding for a new client",
    "Audit a stuck account by missing handoff",
    "Draft an SLA escalation template",
  ],
  designer: [
    "Sketch 3 directions for this hero section",
    "Audit our type scale",
    "Pick a color path for this campaign",
  ],
  engineer: [
    "Plan a 2-week sprint",
    "Triage a deploy that broke last night",
    "Review a PR that needs a second eye",
  ],
  cto: [
    "Plan the engineering roadmap",
    "Pick the top 3 tech risks",
    "Audit the team's deploy cadence",
  ],
};

function startersFor(role: string | null | undefined, title?: string): string[] {
  if (title) {
    const titleKey = title.trim().toLowerCase();
    if (ROLE_STARTERS[titleKey]) return ROLE_STARTERS[titleKey];
  }
  if (role && ROLE_STARTERS[role]) return ROLE_STARTERS[role];
  return [
    "Walk me through your job in 3 bullets",
    "What context do you need from me?",
    "Pick a sample task and run it end to end",
  ];
}

// Narrow GET rows ({role, content, ...}) down to renderable
// ChatMessages. Pure - module scope so it never lands in a hook's
// dep array. Used to hydrate both the main and proactive threads.
function toChatMessages(rows: ChatRow[]): ChatMessage[] {
  return rows
    .filter(
      (m): m is ChatRow & { role: ChatMessage["role"] } =>
        (m.role === "user" ||
          m.role === "assistant" ||
          m.role === "system") &&
        typeof m.content === "string",
    )
    .map((m) => ({ role: m.role, content: m.content }));
}

/**
 * AgentChatTab
 *
 * Mirrors src/app/onboarding/OnboardingChat.tsx UX. Single-thread chat
 * with a per-agent server. Hydrates history from GET
 * /api/agents/[id]/chat, posts new turns to POST /api/agents/[id]/chat
 * which streams newline-delimited JSON events:
 *   { type: "text",  delta: string }
 *   { type: "done" }
 *   { type: "error", message: string }
 *
 * Drag-drop on the bubble pane uploads the file as an agent file via
 * POST /api/agent-files/upload (multipart). The pipeline chunks +
 * embeds inline so the next reply can RAG-cite it. We surface the
 * upload result as a system bubble so the operator sees what happened.
 */
export default function AgentChatTab({
  agentId,
  agentName,
  agentRole,
  agentTitle,
  initialMessages = [],
}: AgentChatTabProps) {
  // Which thread is on screen. Default "main" - the proactive feed is
  // opt-in via the header toggle so it never clutters the operator's
  // working conversation.
  const [activeThread, setActiveThread] = useState<ThreadId>("main");
  // Main operator thread. SSR seeds it on first paint (best-effort -
  // see below; the GET on mount reconciles the real main/proactive
  // split since SSR rows carry no metadata).
  const [mainMessages, setMainMessages] = useState<ChatMessage[]>(() =>
    initialMessages
      .filter(
        (m): m is { role: ChatMessage["role"]; content: string } =>
          (m.role === "user" || m.role === "assistant" || m.role === "system") &&
          typeof m.content === "string",
      )
      .map((m) => ({ role: m.role, content: m.content })),
  );
  // Proactive (CEO) thread - cron / insight rows + anything said in
  // the proactive view. Always hydrated from the GET on mount.
  const [proactiveMessages, setProactiveMessages] = useState<ChatMessage[]>([]);
  // The visible thread's array + setter. Streaming closures capture
  // these per-render, so a run started in one thread keeps writing to
  // that thread even if the operator toggles away mid-stream.
  const messages = activeThread === "main" ? mainMessages : proactiveMessages;
  const setMessages =
    activeThread === "main" ? setMainMessages : setProactiveMessages;
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  // Messages typed while a run is streaming. The operator can keep
  // sending mid-run; queued turns drain FIFO the moment `streaming`
  // flips false (drain effect below). Each item carries its thread so
  // a queued turn replays into the conversation it was typed in.
  const [queued, setQueued] = useState<Array<{ text: string; thread: ThreadId }>>(
    [],
  );
  // Which thread the in-flight run belongs to (null when idle). Lets
  // the message list show the streaming indicator only on the thread
  // that is actually running, even if the operator toggles away.
  const [streamingThread, setStreamingThread] = useState<ThreadId | null>(null);
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(initialMessages.length > 0);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRows, setHistoryRows] = useState<HistoryRow[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const _roleMeta =
    AGENT_ROLES.find((r) => r.value === agentRole) ??
    AGENT_ROLES[AGENT_ROLES.length - 1];
  const RoleIcon = ROLE_ICON_MAP[_roleMeta.icon as RoleIconKey] ?? Bot;
  const displayName = agentName?.trim() || "this agent";
  const starters = startersFor(agentRole, agentTitle);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // SSR seeds initialMessages into the main thread for instant first
  // paint, but it carries no metadata so it can't tell main vs
  // proactive rows apart - so we ALWAYS run the client GET on mount to
  // get the authoritative split (main `messages` + `proactiveMessages`)
  // and reconcile both arrays. Any proactive rows that flashed inline
  // from the SSR seed are corrected the moment this resolves.
  // AbortController on cleanup so fast page navigations (chat picker,
  // /agents/tree) actually CANCEL the in-flight history fetch instead
  // of letting it leak a stale 404 toast after unmount. Without abort,
  // navigating off mid-flight surfaces the prior page's 404 in console
  // (bug W8 #9).
  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    fetch(`/api/agents/${agentId}/chat`, { signal: ctrl.signal })
      .then(async (r) => {
        if (r.ok) {
          return r.json().catch(() => ({ messages: [], proactiveMessages: [] }));
        }
        if (!cancelled) {
          setError(
            r.status === 404
              ? "This agent is in a different workspace. Switch org from the sidebar."
              : `Chat history fetch failed (${r.status})`,
          );
        }
        return { messages: [], proactiveMessages: [] };
      })
      .then(
        (data: { messages?: ChatRow[]; proactiveMessages?: ChatRow[] }) => {
          if (cancelled) return;
          const main = Array.isArray(data.messages) ? data.messages : [];
          const proactive = Array.isArray(data.proactiveMessages)
            ? data.proactiveMessages
            : [];
          setMainMessages(toChatMessages(main));
          setProactiveMessages(toChatMessages(proactive));
          setHydrated(true);
        },
      )
      .catch((err: unknown) => {
        // AbortError on unmount is expected, never log/toast.
        if (cancelled) return;
        if ((err as { name?: string })?.name === "AbortError") return;
        setHydrated(true);
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [agentId]);

  // Auto-scroll on new content.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  // Drain the queued-message FIFO. Fires when a run finishes
  // (streaming -> false) and a turn is pending; replays the head via
  // the `override` path. sendMessage drops the head from the queue
  // itself (keeping this effect free of cascading setState), then sets
  // streaming true - so the next render re-guards here until the
  // replay's own run settles.
  useEffect(() => {
    if (streaming || queued.length === 0) return;
    const head = queued[0];
    void sendMessage(head.text, head.thread);
    // sendMessage is a stable in-component closure recreated each
    // render; the drain only depends on streaming + queued.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, queued]);

  // `override` replays a queued turn (drain effect); `threadOverride`
  // pins it to the thread it was typed in even if the operator has
  // since toggled away. A fresh send with no override targets the
  // currently-visible thread.
  async function sendMessage(override?: string, threadOverride?: ThreadId) {
    const text = (override ?? input).trim();
    if (!text) return;
    const turnThread: ThreadId = threadOverride ?? activeThread;
    // Resolve the thread-specific state + setter ONCE so every closure
    // below (stream loop, timers, finally) writes to the conversation
    // this turn belongs to, regardless of what the operator toggles to
    // mid-stream.
    const threadMessages =
      turnThread === "main" ? mainMessages : proactiveMessages;
    const setThreadMessages =
      turnThread === "main" ? setMainMessages : setProactiveMessages;
    // A run is already streaming - queue instead of dropping the turn.
    // `override` means the drain effect is replaying a queued turn;
    // never re-queue that or it would loop forever.
    if (streaming && override === undefined) {
      setInput("");
      setQueued((q) => [...q, { text, thread: turnThread }]);
      return;
    }
    setError("");
    if (override === undefined) {
      setInput("");
    } else {
      // Drain replay - drop this turn from the head of the queue.
      // Guarded by head-equality so a stray re-fire is a no-op.
      setQueued((q) => (q[0]?.text === override ? q.slice(1) : q));
    }

    const next: ChatMessage[] = [
      ...threadMessages,
      { role: "user", content: text },
      { role: "assistant", content: THINKING_FRAMES[0] },
    ];
    setThreadMessages(next);
    setStreaming(true);
    setStreamingThread(turnThread);

    // Rotate the thinking-frame phrase in the trailing assistant
    // bubble every 2.5s so the chat doesn't feel frozen between POST
    // and the first stream delta. Cleared the moment the first
    // { type: "text" } event lands (and again in `finally` as a
    // safety net for error / abort paths).
    let firstDelta = true;
    let frame = 0;
    const thinkingTimer: ReturnType<typeof setInterval> = setInterval(() => {
      if (!firstDelta) return;
      frame = (frame + 1) % THINKING_FRAMES.length;
      const phrase = THINKING_FRAMES[frame];
      setThreadMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.role === "assistant" && firstDelta) {
          copy[copy.length - 1] = { role: "assistant", content: phrase };
        }
        return copy;
      });
    }, 2500);

    try {
      // Wire shape mirrors onboarding chat: send only user/assistant
      // turns with non-empty content. Strip the empty trailing
      // assistant placeholder we just pushed for UX.
      const wireMessages = next
        .slice(0, -1)
        .filter(
          (m): m is { role: "user" | "assistant"; content: string } =>
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string" &&
            m.content.trim().length > 0,
        );

      const res = await fetch(`/api/agents/${agentId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `thread` tells the route which conversation to persist the
        // turn + reply under. "main" turns stay untagged; "proactive"
        // turns are tagged metadata.thread so GET groups them into the
        // proactive feed. The reply pipeline is identical either way.
        body: JSON.stringify({ messages: wireMessages, thread: turnThread }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- streamed JSON event from internal API; narrowed at each branch
          let event: any;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }

          if (event.type === "text" && typeof event.delta === "string") {
            // First delta replaces the rotating thinking-frame
            // placeholder; subsequent deltas append as usual.
            const isFirst = firstDelta;
            if (firstDelta) {
              firstDelta = false;
              clearInterval(thinkingTimer);
            }
            setThreadMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last && last.role === "assistant") {
                // Bulletproof placeholder swap: if the bubble still holds
                // a rotating "Thinking…/Looking into it…" frame, the real
                // text REPLACES it regardless of firstDelta state. The
                // two-pass reply path emits text after a long gap (tool
                // run + delegation poll), and an interleaved timer tick
                // could otherwise leave the frame stuck above the answer.
                const isPlaceholder = THINKING_FRAMES.includes(last.content);
                copy[copy.length - 1] = {
                  role: "assistant",
                  content:
                    (isFirst || isPlaceholder ? "" : last.content) +
                    event.delta,
                };
              } else {
                copy.push({ role: "assistant", content: event.delta });
              }
              return copy;
            });
          } else if (event.type === "error") {
            setError(event.message || "Stream error");
          } else if (event.type === "thinking" && typeof event.brief === "string") {
            const brief = event.brief;
            setThreadMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              const note: ChatMessage = {
                role: "system",
                kind: "thinking",
                content: brief,
              };
              if (last && last.role === "assistant" && firstDelta) {
                copy.splice(copy.length - 1, 0, note);
              } else {
                copy.push(note);
              }
              return copy;
            });
          } else if (
            event.type === "command_running" &&
            typeof event.verb === "string"
          ) {
            // Live orchestration status - "Kasia is answering now",
            // "Running gmail" - streamed the moment a command starts,
            // before the slow call returns.
            const verb = event.verb;
            setThreadMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              const note: ChatMessage = {
                role: "system",
                kind: "running",
                content: verb,
              };
              if (last && last.role === "assistant" && firstDelta) {
                copy.splice(copy.length - 1, 0, note);
              } else {
                copy.push(note);
              }
              return copy;
            });
          } else if (event.type === "secret_redacted" && Array.isArray(event.hits)) {
            const hits = (event.hits as unknown[]).filter(
              (h): h is string => typeof h === "string",
            );
            const redactedText = typeof event.redactedText === "string" ? event.redactedText : null;
            setThreadMessages((prev) => {
              const copy = [...prev];
              // Replace the just-sent user message with the server's
              // redacted version so the bubble doesn't keep displaying
              // the raw secret we already scrubbed server-side.
              if (redactedText) {
                for (let i = copy.length - 1; i >= 0; i--) {
                  if (copy[i].role === "user") {
                    copy[i] = { role: "user", content: redactedText };
                    break;
                  }
                }
              }
              const last = copy[copy.length - 1];
              const warning: ChatMessage = {
                role: "system",
                kind: "secret",
                content: `⚠ Detected ${hits.length} secret(s) in your message: ${hits.join(", ")}. Redacted before processing. Rotate them now.`,
              };
              if (last && last.role === "assistant" && firstDelta) {
                copy.splice(copy.length - 1, 0, warning);
              } else {
                copy.push(warning);
              }
              return copy;
            });
          } else if (event.type === "commands_executed" && Array.isArray(event.results)) {
            // Structured orchestration payload - the Bubble renders each
            // entry as a tool-call / delegation card with the real
            // content (emails listed, the dept head's actual output).
            const commands = (event.results as CommandResult[]).map((r) => ({
              ok: !!r.ok,
              type: String(r.type),
              summary: typeof r.summary === "string" ? r.summary : "",
              detail:
                r.detail && typeof r.detail === "object"
                  ? (r.detail as Record<string, unknown>)
                  : undefined,
            }));
            setThreadMessages((prev) => [
              ...prev,
              { role: "system", kind: "commands", content: "", commands },
            ]);
          } else if (event.type === "tasks_created" && Array.isArray(event.tasks)) {
            // Surface the just-created tasks as inline assistant chips
            // so the operator sees them land. We deliberately do NOT
            // call router.refresh() here - that was bumping the
            // operator out of the chat view mid-stream when the Tasks
            // sibling tab remounted. The /tasks page has its own SWR
            // poll and the operator can navigate there manually.
            const lines = (event.tasks as Array<{
              title: string;
              assigneeName: string;
            }>).map((t) => `→ ${t.title} (${t.assigneeName})`).join("\n");
            setThreadMessages((prev) => [
              ...prev,
              {
                role: "system",
                kind: "tasks",
                content: `Created ${event.tasks.length} task${event.tasks.length === 1 ? "" : "s"}:\n${lines}`,
              },
            ]);
          }
          // event.type === "done" is implicit; the reader exits when
          // the server closes the stream.
        }
      }

      // Drop trailing placeholder if the server closed without ever
      // emitting a text delta (rare; e.g. brand-voice hard fail with
      // no visible reply). If `firstDelta` is still true the bubble
      // is showing a rotating thinking-frame and never got real text,
      // so we drop it. Otherwise also handle the legacy empty-string
      // case for safety.
      setThreadMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && (firstDelta || !last.content.trim())) {
          return prev.slice(0, -1);
        }
        return prev;
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Something went wrong";
      setError(message);
      setThreadMessages((prev) => prev.slice(0, -1));
    } finally {
      clearInterval(thinkingTimer);
      setStreaming(false);
      setStreamingThread(null);
    }
  }

  async function uploadFiles(picked: FileList | File[]) {
    const arr = Array.from(picked);
    if (arr.length === 0) return;
    setUploading(true);
    setError("");
    let okCount = 0;
    let totalChunks = 0;
    const errs: string[] = [];
    for (const f of arr) {
      try {
        const fd = new FormData();
        fd.append("file", f);
        fd.append("agent_id", agentId);
        const res = await fetch("/api/agent-files/upload", {
          method: "POST",
          body: fd,
        });
        const j = (await res.json().catch(() => ({}))) as {
          file_id?: string;
          chunk_count?: number;
          error?: string;
        };
        if (!res.ok) {
          errs.push(`${f.name}: ${j.error ?? res.statusText}`);
          continue;
        }
        okCount += 1;
        totalChunks += j.chunk_count ?? 0;
      } catch (err) {
        errs.push(`${f.name}: ${(err as Error).message}`);
      }
    }
    setUploading(false);
    const summary = okCount > 0
      ? `Uploaded ${okCount} file${okCount === 1 ? "" : "s"} (${totalChunks} chunks indexed). Ask me anything about ${okCount === 1 ? "it" : "them"}.`
      : null;
    if (summary) {
      setMessages((prev) => [...prev, { role: "system", content: summary }]);
    }
    if (errs.length > 0) setError(errs.join("; "));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // "Discuss in main chat" - invoked from a proactive bubble. Switches
  // to the main thread and seeds the input with a quoted reference of
  // that proactive message so the operator types their question with
  // the heads-up already in context. We seed the input (not auto-send)
  // so the operator stays in control of what they actually ask.
  function discussInMain(proactiveContent: string) {
    const quote = proactiveContent.replace(/\s+/g, " ").trim().slice(0, 140);
    setActiveThread("main");
    setInput(`Re: ${quote}\n\n`);
    // Focus + drop the caret at the end so the operator can type
    // straight away after the seeded reference.
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }

  return (
    <div
      data-onboarding="agent-chat"
      className="flex h-full flex-col"
      onDragEnter={(e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDragActive(false);
        if (e.dataTransfer.files?.length) {
          void uploadFiles(e.dataTransfer.files);
        }
      }}
    >
      {/* Drag overlay */}
      {dragActive && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-[var(--brand-primary)] bg-[var(--brand-primary-soft)]">
          <p className="text-sm font-medium text-[var(--brand-primary)]">
            Drop to add to {displayName}&apos;s memory
          </p>
        </div>
      )}

      {/* Chat header strip - thread toggle + thread controls. The
          Main | Proactive (CEO) toggle keeps the agent's unprompted
          feed (atlas-coordinate cron + insight anomalies) in its own
          interactive thread so it never clutters the operator's
          working conversation. Default view is Main. */}
      {hydrated && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--brand-surface)]/40 px-4 py-2">
          <div className="flex items-center gap-2">
            {/* Two-state segmented toggle. Switching swaps the whole
                conversation; the run streaming in the other thread
                keeps going (its closure pinned the thread). */}
            <div className="inline-flex rounded-md border border-[var(--line-strong)] bg-[var(--brand-surface)] p-0.5">
              <button
                type="button"
                onClick={() => setActiveThread("main")}
                className={
                  "rounded px-2 py-0.5 text-[11px] transition-colors " +
                  (activeThread === "main"
                    ? "bg-[var(--brand-primary)]/12 text-[var(--brand-primary)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-body)]")
                }
              >
                Main
              </button>
              <button
                type="button"
                onClick={() => setActiveThread("proactive")}
                className={
                  "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] transition-colors " +
                  (activeThread === "proactive"
                    ? "bg-[var(--brand-primary)]/12 text-[var(--brand-primary)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-body)]")
                }
              >
                <Sparkles className="h-3 w-3" />
                Proactive (CEO)
                {proactiveMessages.length > 0 && (
                  <span className="rounded-full bg-[var(--brand-primary)]/15 px-1 text-[9px] font-medium text-[var(--brand-primary)]">
                    {proactiveMessages.length}
                  </span>
                )}
              </button>
            </div>
            <span className="hidden text-[11px] uppercase tracking-[1.5px] text-[var(--text-muted)] sm:inline">
              {messages.length === 0
                ? "New chat"
                : `${messages.length} message${messages.length === 1 ? "" : "s"}`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {activeThread === "proactive" && (
              <button
                type="button"
                onClick={() => setActiveThread("main")}
                className="inline-flex h-6 items-center gap-1 rounded-md border border-[var(--line-strong)] bg-[var(--brand-surface)] px-2 text-[11px] text-[var(--text-body)] hover:border-[var(--brand-primary)]/50 hover:text-[var(--brand-primary)]"
              >
                Go to main chat
              </button>
            )}
            <button
              type="button"
              onClick={async () => {
                setHistoryOpen(true);
                setHistoryLoading(true);
                try {
                  const r = await fetch(`/api/agents/${agentId}/chat?include=archived`);
                  if (!r.ok) {
                    setHistoryRows([]);
                    setError(
                      r.status === 404
                        ? "Agent not found in this org. Switch back to the right workspace from the sidebar."
                        : `History fetch failed (${r.status})`,
                    );
                    return;
                  }
                  const j = (await r.json().catch(() => ({}))) as {
                    messages?: HistoryRow[];
                    proactiveMessages?: HistoryRow[];
                  };
                  // History shows the archived rows of whichever thread
                  // is on screen.
                  setHistoryRows(
                    (activeThread === "proactive"
                      ? j.proactiveMessages
                      : j.messages) ?? [],
                  );
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setHistoryLoading(false);
                }
              }}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-[var(--line-strong)] bg-[var(--brand-surface)] px-2 text-[11px] text-[var(--text-body)] hover:border-[var(--brand-primary)]/50 hover:text-[var(--brand-primary)]"
            >
              History
            </button>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={async () => {
                  if (!confirm("Start a new chat? Past messages are archived (visible via History) - never deleted.")) return;
                  try {
                    // Per-thread archive - "+ New chat" in Main never
                    // touches the proactive feed and vice versa.
                    await fetch(
                      `/api/agents/${agentId}/chat?thread=${activeThread}`,
                      { method: "DELETE" },
                    );
                    setMessages([]);
                    setInput("");
                    setError("");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
                className="inline-flex h-6 items-center gap-1 rounded-md border border-[var(--line-strong)] bg-[var(--brand-surface)] px-2 text-[11px] text-[var(--text-body)] hover:border-[var(--brand-primary)]/50 hover:text-[var(--brand-primary)]"
              >
                + New chat
              </button>
            )}
          </div>
        </div>
      )}

      {/* Plan panel - collapsed chip showing the orchestrator's durable
          active plan (rgaios_plans) + per-step status. Sits below the
          thread-controls strip so it never clutters the message
          timeline; renders nothing when there is no active plan. */}
      <AgentPlanPanel agentId={agentId} />

      {/* History drawer */}
      {historyOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-sm"
          onClick={() => setHistoryOpen(false)}
        >
          <div
            className="h-full w-[480px] overflow-y-auto border-l border-[var(--line)] bg-[var(--brand-bg)] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-serif text-xl tracking-tight text-foreground">
                Chat history with {displayName}
              </h3>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                className="text-sm text-[var(--text-muted)] hover:text-foreground"
              >
                ×
              </button>
            </div>
            {historyLoading ? (
              <p className="text-xs text-[var(--text-muted)]">Loading...</p>
            ) : (historyRows ?? []).length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">No history yet.</p>
            ) : (
              <ul className="space-y-3">
                {(historyRows ?? []).map((m) => (
                  <li
                    key={m.id}
                    className={
                      "rounded-md border p-3 " +
                      (m.role === "user"
                        ? "border-[var(--brand-primary)]/30 bg-[var(--brand-primary)]/5"
                        : "border-[var(--line)] bg-[var(--brand-surface)]")
                    }
                  >
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span className="text-[10px] uppercase tracking-[1.5px] text-[var(--text-muted)]">
                        {m.role}
                      </span>
                      <time className="text-[10px] text-[var(--text-muted)]">
                        {new Date(m.created_at).toLocaleString()}
                      </time>
                    </div>
                    <p className="whitespace-pre-wrap text-[13px] text-[var(--text-body)]">
                      {m.content}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4">
        <div className="mx-auto max-w-2xl space-y-5 py-6">
          {!hydrated && (
            <p className="text-center text-xs text-[var(--text-muted)]">
              Loading conversation...
            </p>
          )}
          {hydrated && messages.length === 0 && (
            <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-[var(--line)] bg-[var(--brand-surface)]/40 p-8 text-center">
              <div
                className={
                  "flex size-12 items-center justify-center rounded-2xl border " +
                  "border-[var(--brand-primary)]/40 bg-[var(--brand-primary)]/10 text-[var(--brand-primary)]"
                }
                aria-hidden
              >
                <RoleIcon className="size-5" />
              </div>
              <div>
                <p className="font-serif text-xl tracking-tight text-foreground">
                  {activeThread === "proactive"
                    ? `Proactive feed with ${displayName}`
                    : `Ask ${displayName} anything`}
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {activeThread === "proactive"
                    ? "Unprompted updates land here. Reply to debate the angle - the CEO answers with full context."
                    : "Or drop a file to add it to memory."}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 pt-1">
                {starters.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setInput(prompt)}
                    className={
                      "rounded-full border border-[var(--line-strong)] bg-[var(--brand-surface)] px-3 py-1.5 text-[12px] text-[var(--text-body)] transition-[color,border-color,background-color] " +
                      "hover:border-[var(--brand-primary)]/50 hover:bg-[var(--brand-primary)]/8 hover:text-[var(--brand-primary)]"
                    }
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((msg, i) => {
            // A "run" is a contiguous stretch of system steps optionally
            // capped by the assistant reply. Knowing the neighbouring
            // roles lets each timeline row draw the connecting rail above
            // / below itself so the whole turn reads as one spine instead
            // of free-floating sibling cards.
            const prev = messages[i - 1];
            const nextMsg = messages[i + 1];
            const onRail = msg.role === "system" || msg.role === "assistant";
            const prevOnRail =
              !!prev && (prev.role === "system" || prev.role === "assistant");
            const nextOnRail =
              !!nextMsg &&
              (nextMsg.role === "system" || nextMsg.role === "assistant");
            return (
              <Bubble
                key={i}
                message={msg}
                streaming={
                  streaming &&
                  streamingThread === activeThread &&
                  i === messages.length - 1
                }
                RoleIcon={RoleIcon}
                railTop={onRail && prevOnRail}
                railBottom={onRail && nextOnRail}
                // In the proactive view only, each agent bubble gets a
                // "Discuss in main chat" action. It carries THAT message
                // into the main thread as a quoted reference so the
                // operator can ask about the specific heads-up they were
                // reading, not start from a blank main chat.
                onDiscussInMain={
                  activeThread === "proactive" && msg.role === "assistant"
                    ? () => discussInMain(msg.content)
                    : undefined
                }
              />
            );
          })}
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
              {error.includes("Claude Max") && (
                <>
                  {" "}
                  <a href="/connections" className="underline hover:text-destructive/80">
                    Open Connections →
                  </a>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Input bar */}
      <div className="shrink-0 border-t border-[var(--line)] bg-[var(--brand-bg)]/80 backdrop-blur">
        <div className="mx-auto max-w-2xl px-4 py-3">
          {queued.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {queued.map((q, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--line-strong)] bg-[var(--brand-surface)] px-2.5 py-1 text-[11px] text-[var(--text-muted)]"
                >
                  <Clock className="h-3 w-3 shrink-0" />
                  {q.thread === "proactive" && (
                    <Sparkles className="h-3 w-3 shrink-0 text-[var(--brand-primary)]" />
                  )}
                  <span className="max-w-[220px] truncate">{q.text}</span>
                  <button
                    type="button"
                    aria-label="Remove queued message"
                    onClick={() =>
                      setQueued((prev) => prev.filter((_, j) => j !== i))
                    }
                    className="ml-0.5 text-[var(--text-muted)] transition-colors hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <span className="text-[11px] text-[var(--text-muted)]">
                {queued.length === 1 ? "1 queued" : `${queued.length} queued`}{" "}
                &middot; sends when the run finishes
              </span>
            </div>
          )}
          <div className="flex items-end gap-2 rounded-2xl border border-[var(--line-strong)] bg-[var(--brand-surface)] p-2 focus-within:border-[var(--brand-primary)]">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || streaming}
              aria-label="Attach file"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[var(--text-muted)] transition-colors hover:text-[var(--brand-primary)] disabled:opacity-40"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.md,.markdown,.txt,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain,text/csv,image/*"
              hidden
              onChange={(e) => {
                if (e.target.files?.length) {
                  void uploadFiles(e.target.files);
                }
                e.target.value = "";
              }}
            />
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder={
                uploading
                  ? "Uploading file..."
                  : streaming
                    ? "Type ahead - queues until the run finishes..."
                    : activeThread === "proactive"
                      ? "Reply in the proactive thread..."
                      : "Talk to this agent..."
              }
              disabled={uploading}
              className="min-h-[40px] flex-1 resize-none bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-[var(--text-muted)] outline-none disabled:opacity-60"
            />
            <Button
              type="button"
              size="icon"
              onClick={() => sendMessage()}
              disabled={!input.trim() || uploading}
              aria-label="Send message"
              title={
                streaming
                  ? "Queue message - sends when the current run finishes"
                  : "Send message"
              }
              className={
                // eslint-disable-next-line rawgrowth-brand/banned-tailwind-defaults -- transition target names box-shadow as the explicit property; arbitrary shadow value is an intentional brand accent
                "h-9 w-9 shrink-0 rounded-xl transition-[box-shadow,transform] " +
                (streaming
                  ? "shadow-[0_0_18px_rgba(51,202,127,.55)] animate-pulse"
                  : "")
              }
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-2 text-center text-[11px] text-[var(--text-muted)]">
            Drag-drop a file to add it to this agent&apos;s memory. Press
            Enter to send, Shift+Enter for newline.
          </p>
        </div>
      </div>
    </div>
  );
}

function Bubble({
  message,
  streaming,
  RoleIcon,
  railTop,
  railBottom,
  onDiscussInMain,
}: {
  message: ChatMessage;
  streaming: boolean;
  RoleIcon: LucideIcon;
  // When true, draw the connecting timeline rail above / below this
  // row's icon node so a turn (system steps + assistant reply) reads as
  // one continuous spine.
  railTop: boolean;
  railBottom: boolean;
  // Set only for agent bubbles rendered in the proactive thread.
  // Carries this message into the main chat as a quoted reference.
  onDiscussInMain?: () => void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end" data-role="user">
        <div className="max-w-[85%] rounded-xl rounded-br-sm border border-[var(--brand-primary)]/20 bg-[var(--brand-primary-soft)] px-4 py-2.5 text-sm text-foreground">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.role === "system") {
    return (
      <SystemBlock message={message} railTop={railTop} railBottom={railBottom} />
    );
  }

  // Assistant reply: the conclusion of the run. Sits on the same rail as
  // the orchestration steps above it (railTop) so it reads as the answer
  // the timeline was building toward, not a disconnected block.
  //
  // showActions gates the inline "Open Updates" panel on the proactive
  // anomaly heads-ups. The generator copy leads with the metric title
  // then carries a "Root cause:" line and points at "in Updates" /
  // "drafted plan in Updates" - match those so the panel still renders
  // after the copy rewrite.
  const showActions =
    !!message.content &&
    /Root cause:[\s\S]*\bin Updates\b|drafted plan in Updates/i.test(
      message.content,
    );
  return (
    <TimelineRow
      icon={RoleIcon}
      tone="answer"
      railTop={railTop}
      railBottom={railBottom}
      dataRole="assistant"
    >
      <div className="min-w-0 rounded-xl rounded-tl-sm border border-[var(--line)] bg-[var(--brand-surface-2)] px-4 py-2.5 text-sm leading-relaxed text-[var(--text-body)]">
        {message.content ? (
          <>
            <Response>{message.content}</Response>
            {/* Inline action panel for proactive anomaly messages */}
            {showActions && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-2.5">
                <a
                  href="/updates"
                  className="inline-flex items-center gap-1 rounded-md bg-[var(--brand-primary)] px-3 py-1.5 text-[11px] font-medium text-[var(--brand-primary-foreground,#000)] hover:opacity-90"
                >
                  Open Updates →
                </a>
                <span className="text-[10px] text-[var(--text-muted)]">
                  Approve / reject the plan from Updates, or reply here to debate the angle.
                </span>
              </div>
            )}
            {/* Proactive-thread-only: take THIS heads-up into the main
                chat as a quoted reference. Sits below the anomaly panel
                when both render; on its own for atlas_coordinate
                bubbles that don't trip showActions. */}
            {onDiscussInMain && (
              <div
                className={
                  "flex " +
                  (showActions ? "mt-2" : "mt-3 border-t border-[var(--line)] pt-2.5")
                }
              >
                <button
                  type="button"
                  onClick={onDiscussInMain}
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--line-strong)] bg-[var(--brand-surface)] px-2 py-1 text-[11px] text-[var(--text-body)] transition-colors hover:border-[var(--brand-primary)]/50 hover:text-[var(--brand-primary)]"
                >
                  <ArrowRightLeft className="h-3 w-3" />
                  Discuss in main chat
                </button>
              </div>
            )}
          </>
        ) : streaming ? (
          <span
            className="inline-flex h-3 items-center gap-1 text-[var(--brand-primary)]"
            aria-label="Streaming reply"
          >
            <span className="size-1.5 animate-pulse rounded-full bg-current" />
            <span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:.15s]" />
            <span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:.3s]" />
          </span>
        ) : null}
      </div>
    </TimelineRow>
  );
}

// ── Orchestration timeline ────────────────────────────────────────────
// A single orchestration turn used to render as a loose stack of
// disconnected sibling cards (a "REASONING" box, a "Running X" pill,
// per-command cards, then the reply bubble floating off on its own).
// It now renders as ONE connected vertical timeline: every step
// (reasoning, tool call, delegation, observation, tasks) is a node on a
// shared rail, and the assistant reply is the rail's final node - the
// conclusion the run was building toward.
//
// Design principles applied (see research):
//  - One connected timeline, not separate cards. A continuous rail in a
//    fixed-width gutter visually binds every step of a turn.
//  - Progressive disclosure: each step shows a tight one-line headline;
//    heavy detail (raw tool payload, full delegated output) is collapsed
//    behind an expand toggle, not dumped inline.
//  - Clear status affordances: each node carries an icon + ok/failed
//    state so the run is glanceable.
//  - The final answer is visually attached to the timeline as its
//    conclusion, not a disconnected block.

function sysStr(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

type SystemKind =
  | "thinking"
  | "commands"
  | "tasks"
  | "secret"
  | "running"
  | "delegation"
  | "plain";

// Resolve a system ChatMessage into a render kind. Structured (live SSE)
// messages carry an explicit `kind`; DB-loaded history is classified by
// string prefix so old threads still render as steps (best-effort - no
// structured command payload survives a page reload).
function classifySystem(message: ChatMessage): {
  kind: SystemKind;
  text: string;
  commands?: CommandResult[];
} {
  if (message.kind === "thinking")
    return { kind: "thinking", text: message.content };
  if (message.kind === "commands")
    return { kind: "commands", text: "", commands: message.commands ?? [] };
  if (message.kind === "tasks") return { kind: "tasks", text: message.content };
  if (message.kind === "secret")
    return { kind: "secret", text: message.content };
  if (message.kind === "running")
    return { kind: "running", text: message.content };

  const c = message.content;
  if (c.startsWith("Thinking: "))
    return { kind: "thinking", text: c.slice("Thinking: ".length) };
  if (c.startsWith("⚠ Detected ")) return { kind: "secret", text: c };
  if (c.startsWith("Created ") && /\btask/i.test(c))
    return { kind: "tasks", text: c };
  if (c.startsWith("Commands executed:"))
    return { kind: "commands", text: c.replace(/^Commands executed:\s*/, "") };
  if (c.startsWith("Delegated to "))
    return { kind: "delegation", text: c };
  return { kind: "plain", text: c };
}

// Tone drives the rail-node accent. "answer" is the assistant
// conclusion, "active" is a live in-flight step, "warn" is a failed /
// flagged step, "step" is a normal completed step.
type RowTone = "step" | "active" | "answer" | "warn" | "muted";

// Shared timeline row. Renders a fixed-width rail gutter (icon node + a
// connecting line span above / below the node) and the step content to
// its right. railTop / railBottom decide whether the connecting line is
// drawn above / below this node so a contiguous run of rows reads as
// one unbroken spine. The line is a plain absolutely-positioned <span>
// (not a ::before/::after with dynamic classes) so Tailwind can see
// every utility statically.
function TimelineRow({
  icon: Icon,
  tone = "step",
  railTop,
  railBottom,
  dataRole,
  dataKind,
  dataCard,
  children,
}: {
  icon: LucideIcon;
  tone?: RowTone;
  railTop: boolean;
  railBottom: boolean;
  dataRole: string;
  dataKind?: string;
  dataCard?: string;
  children: React.ReactNode;
}) {
  const nodeAccent =
    tone === "answer"
      ? "border-[var(--brand-primary)]/40 bg-[var(--brand-primary)]/10 text-[var(--brand-primary)]"
      : tone === "active"
        ? "border-[var(--brand-primary)]/45 bg-[var(--brand-primary)]/10 text-[var(--brand-primary)]"
        : tone === "warn"
          ? "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-300"
          : tone === "muted"
            ? "border-[var(--line)] bg-[var(--brand-surface)] text-[var(--text-muted)]"
            : "border-[var(--line-strong)] bg-[var(--brand-surface)] text-[var(--text-muted)]";

  return (
    <div
      className="flex gap-3"
      data-role={dataRole}
      data-kind={dataKind}
      data-card={dataCard}
    >
      {/* Rail gutter: 28px wide, holds the node + the connecting line.
          The line is two absolutely-centred 1px spans - one above the
          node, one below. They extend -top-5 / -bottom-5 into the
          space-y-5 row gap so a contiguous run of rows shows one
          unbroken spine rather than dashes between cards. */}
      <div className="relative flex w-7 shrink-0 justify-center">
        {railTop && (
          <span
            aria-hidden
            className="absolute left-1/2 -top-5 h-[calc(0.875rem+1.25rem)] w-px -translate-x-1/2 bg-[var(--line-strong)]"
          />
        )}
        {railBottom && (
          <span
            aria-hidden
            className="absolute -bottom-5 left-1/2 top-3.5 w-px -translate-x-1/2 bg-[var(--line-strong)]"
          />
        )}
        <div
          className={
            "relative z-[1] mt-0.5 flex size-7 items-center justify-center rounded-full border " +
            nodeAccent +
            (tone === "active" ? " animate-pulse" : "")
          }
          aria-hidden
        >
          <Icon className="size-3.5" />
        </div>
      </div>
      <div className="min-w-0 flex-1 pb-0.5">{children}</div>
    </div>
  );
}

// One-line step headline used by every non-answer node. Keeps the
// timeline scannable: label on the left, optional status on the right.
function StepHeadline({
  label,
  status,
  badge,
}: {
  label: React.ReactNode;
  status?: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-7 items-center gap-2">
      <span className="truncate text-[12px] font-medium text-[var(--text-body)]">
        {label}
      </span>
      {badge}
      {status ? <span className="ml-auto shrink-0">{status}</span> : null}
    </div>
  );
}

// Progressive-disclosure wrapper: a step renders its tight headline
// always; the heavy detail (raw tool payload, full delegated output)
// lives behind this collapsed-by-default toggle.
function StepDetail({
  summary,
  children,
}: {
  summary: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--brand-primary)]"
        aria-expanded={open}
      >
        <ChevronRight
          className={
            "size-3 transition-transform " + (open ? "rotate-90" : "")
          }
        />
        {open ? "Hide detail" : summary}
      </button>
      {open && (
        <div className="mt-1.5 rounded-md border border-[var(--line)] bg-[var(--brand-surface-2)] px-2.5 py-1.5">
          {children}
        </div>
      )}
    </div>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--brand-primary)]/15 px-1.5 py-0.5 text-[9px] font-medium uppercase text-[var(--brand-primary)]">
      <Check className="size-2.5" /> ok
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase text-amber-600 dark:text-amber-300">
      <X className="size-2.5" /> failed
    </span>
  );
}

// A system ChatMessage rendered as one (or more) nodes on the run
// timeline. `commands` messages can carry several executed commands;
// each becomes its own node so tool calls, delegations and routine
// creations all sit in order on the same rail.
function SystemBlock({
  message,
  railTop,
  railBottom,
}: {
  message: ChatMessage;
  railTop: boolean;
  railBottom: boolean;
}) {
  const { kind, text, commands } = classifySystem(message);

  if (kind === "thinking") {
    return (
      <TimelineRow
        icon={Brain}
        tone="step"
        railTop={railTop}
        railBottom={railBottom}
        dataRole="system"
        dataKind="thinking"
      >
        <StepHeadline
          label={
            <span className="text-[var(--brand-primary)]">Reasoning</span>
          }
        />
        <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--text-muted)]">
          {text}
        </p>
      </TimelineRow>
    );
  }

  if (kind === "running") {
    return (
      <TimelineRow
        icon={Cpu}
        tone="active"
        railTop={railTop}
        railBottom={railBottom}
        dataRole="system"
        dataKind="running"
      >
        <StepHeadline
          label={
            <span className="text-[var(--brand-primary)]">{text}…</span>
          }
          status={
            <span className="inline-flex items-center gap-1 text-[10px] text-[var(--brand-primary)]">
              <span className="size-1.5 animate-pulse rounded-full bg-current" />
              running
            </span>
          }
        />
      </TimelineRow>
    );
  }

  if (kind === "secret") {
    return (
      <TimelineRow
        icon={X}
        tone="warn"
        railTop={railTop}
        railBottom={railBottom}
        dataRole="system"
        dataKind="secret"
      >
        <div
          aria-label="Secret redacted warning"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-600 dark:text-amber-300"
        >
          {text}
        </div>
      </TimelineRow>
    );
  }

  if (kind === "tasks") {
    return (
      <TimelineRow
        icon={ClipboardList}
        tone="step"
        railTop={railTop}
        railBottom={railBottom}
        dataRole="system"
        dataKind="tasks"
      >
        <StepHeadline label="Tasks created" />
        <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--text-body)]">
          {text}
        </p>
      </TimelineRow>
    );
  }

  if (kind === "delegation") {
    // Legacy DB-string delegation ("Delegated to <name>: <output>"):
    // the structured detail does not survive a reload, so all we have
    // is the flat string. Headline = "Delegated to <name>"; the
    // delegated output collapses behind expand - NEVER dump the full
    // dept-head reply inline, that buries the operator under a wall of
    // text (operator caught this on the /chat surface, which always
    // renders from the DB string).
    const colonIdx = text.indexOf(":");
    const head =
      colonIdx > 0 && colonIdx < 60 ? text.slice(0, colonIdx) : "Delegation";
    const body =
      colonIdx > 0 && colonIdx < 60 ? text.slice(colonIdx + 1).trim() : text;
    return (
      <TimelineRow
        icon={ArrowRightLeft}
        tone="step"
        railTop={railTop}
        railBottom={railBottom}
        dataRole="system"
        dataKind="delegation"
      >
        <StepHeadline
          label={<span className="text-[var(--brand-primary)]">{head}</span>}
        />
        {body ? (
          <StepDetail summary="View delegated output">
            <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--text-body)]">
              {body}
            </p>
          </StepDetail>
        ) : null}
      </TimelineRow>
    );
  }

  if (kind === "commands") {
    if (commands && commands.length > 0) {
      // Each executed command is its own node on the rail, in order.
      // The rail runs through all of them (railTop/railBottom on the
      // ends; always-connected in the middle) so a multi-tool turn
      // reads as one sequence.
      return (
        <>
          {commands.map((cmd, i) => (
            <OrchestrationStep
              key={i}
              cmd={cmd}
              railTop={i === 0 ? railTop : true}
              railBottom={i === commands.length - 1 ? railBottom : true}
            />
          ))}
        </>
      );
    }
    // Legacy history: no structured array survived the reload, just the
    // flat "Commands executed: ..." string. Headline only; the body
    // collapses behind expand so a reloaded orchestration turn does not
    // dump every delegated output inline.
    return (
      <TimelineRow
        icon={Cpu}
        tone="step"
        railTop={railTop}
        railBottom={railBottom}
        dataRole="system"
        dataKind="commands"
      >
        <StepHeadline label="Orchestration" />
        {text ? (
          <StepDetail summary="View orchestration detail">
            <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--text-body)]">
              {text}
            </p>
          </StepDetail>
        ) : null}
      </TimelineRow>
    );
  }

  return (
    <TimelineRow
      icon={Cpu}
      tone="muted"
      railTop={railTop}
      railBottom={railBottom}
      dataRole="system"
      dataKind="plain"
    >
      <p className="min-h-7 py-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
        {text}
      </p>
    </TimelineRow>
  );
}

// One executed <command> rendered as a single timeline node.
//  - agent_invoke → a handoff node: "Delegated to <head>" headline, the
//    task + the dept head's ACTUAL output collapsed behind expand, and a
//    "<from> is monitoring" footer.
//  - tool_call → a tool node with the Composio/MCP badge; the real
//    result content sits behind expand.
//  - routine_create → a routine node.
// Every node carries the ok/failed StatusDot.
function OrchestrationStep({
  cmd,
  railTop,
  railBottom,
}: {
  cmd: CommandResult;
  railTop: boolean;
  railBottom: boolean;
}) {
  const detail = (cmd.detail ?? {}) as Record<string, unknown>;

  if (cmd.type === "agent_invoke") {
    const to = sysStr(detail.assignee_name) || "another agent";
    const from = sysStr(detail.delegated_by_name) || "CEO";
    const task = sysStr(detail.task);
    const output = sysStr(detail.delegated_output);
    const status =
      sysStr(detail.delegated_status) || (cmd.ok ? "succeeded" : "failed");
    const delivered = status === "succeeded";
    return (
      <TimelineRow
        icon={ArrowRightLeft}
        tone={delivered ? "step" : "warn"}
        railTop={railTop}
        railBottom={railBottom}
        dataRole="system"
        dataKind="commands"
        dataCard="delegation"
      >
        <StepHeadline
          label={
            <span className="flex items-center gap-1">
              <span className="text-[var(--text-muted)]">Delegated</span>
              {from}
              <span className="text-[var(--text-muted)]">→</span>
              {to}
            </span>
          }
          status={<StatusDot ok={delivered} />}
        />
        {task ? (
          <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-muted)]">
            <span className="font-medium text-[var(--text-body)]">Task:</span>{" "}
            {task}
          </p>
        ) : null}
        {output ? (
          <StepDetail summary={`View ${to}'s output`}>
            <div className="mb-0.5 text-[9px] font-medium uppercase tracking-wide text-[var(--brand-primary)]">
              {to} delivered
            </div>
            <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--text-body)]">
              {output}
            </p>
          </StepDetail>
        ) : !delivered ? (
          <p className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-300">
            {sysStr(detail.delegated_error) || cmd.summary}
          </p>
        ) : null}
        <div className="mt-1 flex items-center gap-1 text-[9px] text-[var(--text-muted)]">
          <Eye className="size-2.5" /> {from} is monitoring this handoff
        </div>
      </TimelineRow>
    );
  }

  if (cmd.type === "tool_call") {
    const tool = sysStr(detail.tool);
    const app = sysStr(detail.app);
    const action = sysStr(detail.action);
    const isApify = tool.startsWith("apify");
    const label = isApify
      ? tool
      : app && action
        ? `${app} · ${action}`
        : "tool call";
    return (
      <TimelineRow
        icon={Wrench}
        tone={cmd.ok ? "step" : "warn"}
        railTop={railTop}
        railBottom={railBottom}
        dataRole="system"
        dataKind="commands"
        dataCard="tool"
      >
        <StepHeadline
          label={label}
          badge={
            <span className="rounded bg-[var(--brand-surface-2)] px-1.5 py-0.5 text-[9px] font-medium uppercase text-[var(--text-muted)]">
              {isApify ? "MCP" : "Composio"}
            </span>
          }
          status={<StatusDot ok={cmd.ok} />}
        />
        {cmd.summary ? (
          <StepDetail summary="View result">
            <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--text-body)]">
              {cmd.summary}
            </p>
          </StepDetail>
        ) : null}
      </TimelineRow>
    );
  }

  if (cmd.type === "routine_create") {
    return (
      <TimelineRow
        icon={ClipboardList}
        tone={cmd.ok ? "step" : "warn"}
        railTop={railTop}
        railBottom={railBottom}
        dataRole="system"
        dataKind="commands"
        dataCard="routine"
      >
        <StepHeadline label="Routine created" status={<StatusDot ok={cmd.ok} />} />
        {cmd.summary ? (
          <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-body)]">
            {cmd.summary}
          </p>
        ) : null}
      </TimelineRow>
    );
  }

  return (
    <TimelineRow
      icon={Cpu}
      tone={cmd.ok ? "step" : "warn"}
      railTop={railTop}
      railBottom={railBottom}
      dataRole="system"
      dataKind="commands"
      dataCard="generic"
    >
      <StepHeadline label={cmd.type} status={<StatusDot ok={cmd.ok} />} />
      {cmd.summary ? (
        <StepDetail summary="View result">
          <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--text-body)]">
            {cmd.summary}
          </p>
        </StepDetail>
      ) : null}
    </TimelineRow>
  );
}

