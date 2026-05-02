"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  ArrowUp,
  Bot,
  ClipboardList,
  Code,
  Cpu,
  Crown,
  Megaphone,
  Palette,
  Paperclip,
  PhoneCall,
  type LucideIcon,
} from "lucide-react";

import { Response } from "@/components/ui/response";
import { Button } from "@/components/ui/button";
import { AGENT_ROLES } from "@/lib/agents/constants";

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

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
}: AgentChatTabProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);
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

  // Hydrate prior conversation from server. Failures are non-fatal -
  // a fresh thread just starts empty.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/agents/${agentId}/chat`)
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((data: { messages?: HistoryRow[] }) => {
        if (cancelled) return;
        const rows = Array.isArray(data.messages) ? data.messages : [];
        setMessages(
          rows.map((m) => ({ role: m.role, content: m.content })),
        );
        setHydrated(true);
      })
      .catch(() => {
        if (cancelled) return;
        setHydrated(true);
      });
    return () => {
      cancelled = true;
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

  async function sendMessage(override?: string) {
    const text = (override ?? input).trim();
    if (!text || streaming) return;
    setError("");
    if (override === undefined) setInput("");

    const next: ChatMessage[] = [
      ...messages,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ];
    setMessages(next);
    setStreaming(true);

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
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last && last.role === "assistant") {
                copy[copy.length - 1] = {
                  role: "assistant",
                  content: last.content + event.delta,
                };
              } else {
                copy.push({ role: "assistant", content: event.delta });
              }
              return copy;
            });
          } else if (event.type === "error") {
            setError(event.message || "Stream error");
          }
          // event.type === "done" is implicit; the reader exits when
          // the server closes the stream.
        }
      }

      // Drop trailing empty placeholder if the server closed without
      // text (rare; e.g. brand-voice hard fail with no visible reply).
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && !last.content.trim()) {
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
                  const j = await r.json();
                  setHistoryRows(j.messages ?? []);
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
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>
      </div>

      {/* Input bar */}
      <div className="shrink-0 border-t border-[var(--line)] bg-[var(--brand-bg)]/80 backdrop-blur">
        <div className="mx-auto max-w-2xl px-4 py-3">
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
    return (
      <div className="flex justify-center" data-role="system">
        <div className="rounded-full border border-[var(--line)] bg-[var(--brand-surface)]/60 px-3 py-1 text-[11px] text-[var(--text-muted)]">
          {message.content}
        </div>
      </div>
    );
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
          <Response>{message.content}</Response>
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

