"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  ArrowUp,
  ArrowRightLeft,
  Bot,
  Brain,
  Check,
  ClipboardList,
  Code,
  Cpu,
  Crown,
  Eye,
  Megaphone,
  Palette,
  Paperclip,
  PhoneCall,
  Plug,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";

import { Response } from "@/components/ui/response";
import { Button } from "@/components/ui/button";
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

interface AgentChatTabProps {
  agentId: string;
  agentName?: string;
  agentRole?: string | null;
  agentTitle?: string;
  // SSR-loaded thread so the panel renders existing messages on first
  // paint instead of waiting on a useEffect fetch. Eliminates the
  // hydration race where Playwright reads bodyText before the client
  // GET completes under load.
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
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    initialMessages
      .filter(
        (m): m is { role: ChatMessage["role"]; content: string } =>
          (m.role === "user" || m.role === "assistant" || m.role === "system") &&
          typeof m.content === "string",
      )
      .map((m) => ({ role: m.role, content: m.content })),
  );
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
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

  // SSR seeds initialMessages on first paint. Skip the client GET when
  // we already have rows, otherwise we'd burn a round-trip and overwrite
  // the SSR-seeded state with the same data.
  // AbortController on cleanup so fast page navigations (chat picker,
  // /agents/tree) actually CANCEL the in-flight history fetch instead
  // of letting it leak a stale 404 toast after unmount. Without abort,
  // navigating off mid-flight surfaces the prior page's 404 in console
  // (bug W8 #9).
  useEffect(() => {
    if (initialMessages.length > 0) return;
    const ctrl = new AbortController();
    let cancelled = false;
    fetch(`/api/agents/${agentId}/chat`, { signal: ctrl.signal })
      .then(async (r) => {
        if (r.ok) {
          return r.json().catch(() => ({ messages: [] }));
        }
        if (!cancelled) {
          setError(
            r.status === 404
              ? "This agent is in a different workspace. Switch org from the sidebar."
              : `Chat history fetch failed (${r.status})`,
          );
        }
        return { messages: [] };
      })
      .then((data: { messages?: HistoryRow[] }) => {
        if (cancelled) return;
        const rows = Array.isArray(data.messages) ? data.messages : [];
        setMessages(
          rows.map((m) => ({ role: m.role, content: m.content })),
        );
        setHydrated(true);
      })
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
    // initialMessages reference is stable per agent (set from SSR prop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  async function sendMessage(override?: string) {
    const text = (override ?? input).trim();
    if (!text || streaming) return;
    setError("");
    if (override === undefined) setInput("");

    const next: ChatMessage[] = [
      ...messages,
      { role: "user", content: text },
      { role: "assistant", content: THINKING_FRAMES[0] },
    ];
    setMessages(next);
    setStreaming(true);

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
      setMessages((prev) => {
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
        body: JSON.stringify({ messages: wireMessages }),
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
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last && last.role === "assistant") {
                copy[copy.length - 1] = {
                  role: "assistant",
                  content: (isFirst ? "" : last.content) + event.delta,
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
            setMessages((prev) => {
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
            setMessages((prev) => {
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
            setMessages((prev) => {
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
            setMessages((prev) => [
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
            setMessages((prev) => [
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
      setMessages((prev) => {
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
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      clearInterval(thinkingTimer);
      setStreaming(false);
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

      {/* Chat header strip - thread controls */}
      {hydrated && (
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--line)] bg-[var(--brand-surface)]/40 px-4 py-2">
          <span className="text-[11px] uppercase tracking-[1.5px] text-[var(--text-muted)]">
            {messages.length === 0
              ? "New chat"
              : `${messages.length} message${messages.length === 1 ? "" : "s"} in this thread`}
          </span>
          <div className="flex items-center gap-2">
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
                  };
                  setHistoryRows(j.messages ?? []);
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
                    await fetch(`/api/agents/${agentId}/chat`, { method: "DELETE" });
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
                  Ask {displayName} anything
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Or drop a file to add it to memory.
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
          {messages.map((msg, i) => (
            <Bubble
              key={i}
              message={msg}
              streaming={streaming && i === messages.length - 1}
              RoleIcon={RoleIcon}
            />
          ))}
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
          <p
            role="note"
            aria-label="Secret-paste safety notice"
            className="mb-2 text-center text-[11px] text-amber-600 dark:text-amber-300"
          >
            ⚠ Don&apos;t paste passwords, API keys, or SSH credentials. Agents
            can&apos;t SSH or run shell - use{" "}
            <a href="/connections" className="underline hover:opacity-80">
              /connections
            </a>{" "}
            for OAuth.
          </p>
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
                uploading ? "Uploading file..." : "Talk to this agent..."
              }
              disabled={streaming || uploading}
              className="min-h-[40px] flex-1 resize-none bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-[var(--text-muted)] outline-none disabled:opacity-60"
            />
            <Button
              type="button"
              size="icon"
              onClick={() => sendMessage()}
              disabled={!input.trim() || streaming || uploading}
              aria-label="Send message"
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
}: {
  message: ChatMessage;
  streaming: boolean;
  RoleIcon: LucideIcon;
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
    return <SystemBlock message={message} />;
  }

  return (
    <div className="flex gap-3" data-role="assistant">
      <div
        className={
          "flex size-7 shrink-0 items-center justify-center rounded-full border " +
          "border-[var(--brand-primary)]/40 bg-[var(--brand-primary)]/10 text-[var(--brand-primary)]"
        }
        aria-hidden
      >
        <RoleIcon className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1 rounded-xl rounded-bl-sm border border-[var(--line)] bg-[var(--brand-surface-2)] px-4 py-2.5 text-sm leading-relaxed text-[var(--text-body)]">
        {message.content ? (
          <>
            <Response>{message.content}</Response>
            {/* Inline action panel for proactive anomaly messages */}
            {/Heads up.*flagged.*anomaly|Drafted plan.*approval needed in Updates/i.test(
              message.content,
            ) && (
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
    </div>
  );
}

// ── Orchestration display ─────────────────────────────────────────────
// System messages used to render as a single flat pill. Now each variant
// is a structured card so the operator can SEE the agent reasoning, the
// tool calls (with their actual result content - emails listed, posts
// scraped), and the CEO → dept-head delegation handoffs. "Orchestration,
// visible" - the Anthropic Managed Agents / Nous Hermes pattern.

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
// string prefix so old threads still render as cards (best-effort - no
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

function SystemBlock({ message }: { message: ChatMessage }) {
  const { kind, text, commands } = classifySystem(message);

  if (kind === "thinking") {
    return (
      <div
        className="flex justify-center"
        data-role="system"
        data-kind="thinking"
      >
        <div
          aria-label="Agent reasoning"
          className="w-full max-w-[88%] rounded-lg border-l-2 border-[var(--brand-primary)]/45 bg-[var(--brand-surface)]/40 px-3 py-2"
        >
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--brand-primary)]">
            <Brain className="size-3" /> Reasoning
          </div>
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--text-muted)]">
            {text}
          </p>
        </div>
      </div>
    );
  }

  if (kind === "running") {
    return (
      <div
        className="flex justify-center"
        data-role="system"
        data-kind="running"
      >
        <div className="inline-flex items-center gap-1.5 rounded-full border border-[var(--brand-primary)]/30 bg-[var(--brand-primary)]/5 px-3 py-1 text-[11px] text-[var(--brand-primary)]">
          <span className="size-1.5 animate-pulse rounded-full bg-current" />
          {text}…
        </div>
      </div>
    );
  }

  if (kind === "secret") {
    return (
      <div className="flex justify-center" data-role="system" data-kind="secret">
        <div
          aria-label="Secret redacted warning"
          className="rounded-full border border-amber-500/50 bg-amber-500/10 px-3 py-1 text-[11px] text-amber-600 dark:text-amber-300"
        >
          {text}
        </div>
      </div>
    );
  }

  if (kind === "tasks") {
    return (
      <div className="flex justify-center" data-role="system" data-kind="tasks">
        <div className="w-full max-w-[88%] rounded-lg border border-[var(--line)] bg-[var(--brand-surface)]/60 px-3 py-2">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
            <ClipboardList className="size-3" /> Tasks
          </div>
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--text-body)]">
            {text}
          </p>
        </div>
      </div>
    );
  }

  if (kind === "delegation") {
    return (
      <div
        className="flex justify-center"
        data-role="system"
        data-kind="delegation"
      >
        <div className="w-full max-w-[92%] rounded-lg border border-[var(--brand-primary)]/30 bg-[var(--brand-surface)]/60 px-3 py-2">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--brand-primary)]">
            <ArrowRightLeft className="size-3" /> Delegation
          </div>
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--text-body)]">
            {text}
          </p>
        </div>
      </div>
    );
  }

  if (kind === "commands") {
    if (commands && commands.length > 0) {
      return (
        <div
          className="flex justify-center"
          data-role="system"
          data-kind="commands"
        >
          <div className="w-full max-w-[92%] space-y-1.5">
            {commands.map((cmd, i) => (
              <OrchestrationCard key={i} cmd={cmd} />
            ))}
          </div>
        </div>
      );
    }
    // Legacy history: no structured array, render the text block.
    return (
      <div
        className="flex justify-center"
        data-role="system"
        data-kind="commands"
      >
        <div className="w-full max-w-[92%] rounded-lg border border-[var(--line)] bg-[var(--brand-surface)]/60 px-3 py-2">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
            <Cpu className="size-3" /> Orchestration
          </div>
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--text-body)]">
            {text}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-center" data-role="system" data-kind="plain">
      <div className="rounded-full border border-[var(--line)] bg-[var(--brand-surface)]/60 px-3 py-1 text-[11px] text-[var(--text-muted)]">
        {text}
      </div>
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

// One executed <command> rendered as a card. agent_invoke → a handoff
// card showing CEO → dept head, the task, the dept head's ACTUAL output,
// and a "CEO is monitoring" footer. tool_call → a tool card with the
// Composio/MCP badge + the real result content (emails, posts).
function OrchestrationCard({ cmd }: { cmd: CommandResult }) {
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
      <div
        className="rounded-lg border border-[var(--brand-primary)]/30 bg-[var(--brand-surface)]/60 px-3 py-2.5"
        data-card="delegation"
      >
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="size-3.5 text-[var(--brand-primary)]" />
          <span className="flex items-center gap-1 text-[11px] font-medium text-[var(--text-body)]">
            {from}
            <span className="text-[var(--text-muted)]">→</span>
            {to}
          </span>
          <span className="ml-auto">
            <StatusDot ok={delivered} />
          </span>
        </div>
        {task ? (
          <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-muted)]">
            <span className="font-medium text-[var(--text-body)]">Task:</span>{" "}
            {task}
          </p>
        ) : null}
        {output ? (
          <div className="mt-1.5 rounded-md border border-[var(--line)] bg-[var(--brand-surface-2)] px-2.5 py-1.5">
            <div className="mb-0.5 text-[9px] font-medium uppercase tracking-wide text-[var(--brand-primary)]">
              {to} delivered
            </div>
            <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--text-body)]">
              {output}
            </p>
          </div>
        ) : !delivered ? (
          <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-300">
            {sysStr(detail.delegated_error) || cmd.summary}
          </p>
        ) : null}
        <div className="mt-1.5 flex items-center gap-1 border-t border-[var(--line)] pt-1.5 text-[9px] text-[var(--text-muted)]">
          <Eye className="size-2.5" /> {from} is monitoring this handoff
        </div>
      </div>
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
      <div
        className="rounded-lg border border-[var(--line)] bg-[var(--brand-surface)]/60 px-3 py-2.5"
        data-card="tool"
      >
        <div className="flex items-center gap-2">
          <Wrench className="size-3.5 text-[var(--brand-primary)]" />
          <span className="text-[11px] font-medium text-[var(--text-body)]">
            {label}
          </span>
          <span className="rounded bg-[var(--brand-surface-2)] px-1.5 py-0.5 text-[9px] font-medium uppercase text-[var(--text-muted)]">
            {isApify ? "MCP" : "Composio"}
          </span>
          <span className="ml-auto">
            <StatusDot ok={cmd.ok} />
          </span>
        </div>
        <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--text-body)]">
          {cmd.summary}
        </p>
      </div>
    );
  }

  if (cmd.type === "routine_create") {
    return (
      <div
        className="rounded-lg border border-[var(--line)] bg-[var(--brand-surface)]/60 px-3 py-2.5"
        data-card="routine"
      >
        <div className="flex items-center gap-2">
          <ClipboardList className="size-3.5 text-[var(--brand-primary)]" />
          <span className="text-[11px] font-medium text-[var(--text-body)]">
            Routine created
          </span>
          <span className="ml-auto">
            <StatusDot ok={cmd.ok} />
          </span>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-body)]">
          {cmd.summary}
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border border-[var(--line)] bg-[var(--brand-surface)]/60 px-3 py-2.5"
      data-card="generic"
    >
      <div className="flex items-center gap-2">
        <Cpu className="size-3.5 text-[var(--brand-primary)]" />
        <span className="text-[11px] font-medium text-[var(--text-body)]">
          {cmd.type}
        </span>
        <span className="ml-auto">
          <StatusDot ok={cmd.ok} />
        </span>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--text-body)]">
        {cmd.summary}
      </p>
    </div>
  );
}

