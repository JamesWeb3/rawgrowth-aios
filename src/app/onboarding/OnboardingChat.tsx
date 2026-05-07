"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { ArrowUp, Check, ChevronDown, AlertCircle, Upload, X, FileText, Image as ImageIcon, Paperclip, ArrowRight } from "lucide-react";
import Link from "next/link";

import { Response } from "@/components/ui/response";
import { Button, buttonVariants } from "@/components/ui/button";
import { BRAND_DOC_ZONES } from "@/lib/onboarding";
import { TelegramConnectorBlock } from "@/components/onboarding/TelegramConnectorBlock";
import { IntegrationConnectorBlock } from "@/components/onboarding/IntegrationConnectorBlock";

type IntegrationProvider = "slack" | "hubspot" | "google-drive" | "gmail";

const INTEGRATION_PROVIDERS: ReadonlySet<IntegrationProvider> = new Set([
  "slack",
  "hubspot",
  "google-drive",
  "gmail",
]);

function isIntegrationProvider(v: unknown): v is IntegrationProvider {
  return typeof v === "string" && INTEGRATION_PROVIDERS.has(v as IntegrationProvider);
}

const INTEGRATION_DISPLAY_NAME: Record<IntegrationProvider, string> = {
  slack: "Slack",
  hubspot: "HubSpot",
  "google-drive": "Google Drive",
  gmail: "Gmail",
};

type DocumentRecord = {
  id: string;
  type: string;
  storage_url: string;
  filename: string;
  size: number;
};

type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | {
      role: "reasoning";
      id: string;
      label: string;
      status: "thinking" | "done" | "error";
      fields?: Record<string, unknown>;
      error?: string;
    }
  | {
      role: "uploaded_file";
      id: string;
      filename: string;
      size: number;
      url: string;
      status: "uploading" | "ready" | "error";
      error?: string;
    }
  | { role: "brand_docs_uploader"; id: string }
  | { role: "telegram_connector"; id: string }
  | { role: "integration_connector"; id: string; provider: IntegrationProvider }
  | { role: "portal_button"; id: string };

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB - matches /api/onboarding/brand-docs/upload

// If the last message is an empty assistant placeholder, drop it. Used before
// inserting reasoning pills / inline widgets so the avatar doesn't render
// above an empty bubble.
function stripEmptyAssistant(prev: ChatMessage[]): ChatMessage[] {
  const last = prev[prev.length - 1];
  if (last && last.role === "assistant" && !last.content.trim()) {
    return prev.slice(0, -1);
  }
  return prev;
}

interface Progress {
  current: number;
  total: number;
  completed: string[];
}

interface OnboardingChatProps {
  firstName: string | null;
  initialProgress: Progress;
}

export default function OnboardingChat({
  firstName,
  initialProgress,
}: OnboardingChatProps) {
  const greetingName = firstName?.trim() || "there";
  const initialGreeting = useMemo(
    () =>
      `Hi ${greetingName}, welcome to Rawgrowth onboarding. Drop your brand assets right here, decks, brand guides, sales call transcripts, ad creatives, anything that already explains your business. I will read them and pre-fill what I can, then only ask about what is genuinely missing. You can also paste links (your site, IG, YouTube) and I will scrape the public pages. Ready when you are.`,
    [greetingName]
  );

  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: initialGreeting },
  ]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<Progress>(initialProgress);
  const [justSaved, setJustSaved] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOverChat, setDragOverChat] = useState(false);
  const dragCounter = useRef(0);

  // Auto-scroll to bottom on new content
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  // "Saved ✓" toast auto-hide
  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(null), 2200);
    return () => clearTimeout(t);
  }, [justSaved]);

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
      // Strip reasoning / uploader placeholder messages  -  OpenAI only
      // understands user/assistant roles, and the empty trailing assistant
      // placeholder we pushed for UX shouldn't go back out.
      const wireMessages = next
        .slice(0, -1)
        .filter(
          (m): m is { role: "user" | "assistant"; content: string } => {
            if (m.role !== "user" && m.role !== "assistant") return false;
            const content = (m as { content?: unknown }).content;
            return typeof content === "string" && content.trim().length > 0;
          }
        );
      const res = await fetch("/api/onboarding/chat", {
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
          // Streamed protocol from /api/onboarding/chat. Server emits
          // discriminated `type` events; structurally validate fields per
          // branch so unknown payloads don't crash the parser.
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
          } else if (event.type === "reasoning") {
            setMessages((prev) => {
              if (event.status === "thinking") {
                // Drop a trailing empty assistant placeholder so the avatar
                // doesn't render above this pill with nothing in the bubble.
                const trimmed = stripEmptyAssistant(prev);
                return [
                  ...trimmed,
                  {
                    role: "reasoning",
                    id: event.id,
                    label: event.label,
                    status: "thinking",
                  },
                ];
              }
              return prev.map((m) =>
                m.role === "reasoning" && m.id === event.id
                  ? {
                      ...m,
                      status: event.status,
                      label: event.label ?? m.label,
                      fields: event.fields,
                      error: event.error,
                    }
                  : m
              );
            });
          } else if (event.type === "progress") {
            setProgress({
              current: event.current,
              total: event.total,
              completed: event.completed || [],
            });
            if (event.label) setJustSaved(event.label);
          } else if (event.type === "brand_docs_uploader") {
            setMessages((prev) => [
              ...stripEmptyAssistant(prev),
              {
                role: "brand_docs_uploader",
                id:
                  (globalThis.crypto?.randomUUID?.() as string) ||
                  `uploader_${Date.now()}`,
              },
            ]);
          } else if (event.type === "telegram_connector") {
            setMessages((prev) => [
              ...stripEmptyAssistant(prev),
              {
                role: "telegram_connector",
                id:
                  (globalThis.crypto?.randomUUID?.() as string) ||
                  `tgconn_${Date.now()}`,
              },
            ]);
          } else if (event.type === "integration_connector") {
            // Server gates this event on a known provider, but the
            // wire payload is untrusted by definition  -  guard the
            // discriminator so the union stays narrowed downstream.
            if (isIntegrationProvider(event.provider)) {
              const provider = event.provider;
              setMessages((prev) => [
                ...stripEmptyAssistant(prev),
                {
                  role: "integration_connector",
                  id:
                    (globalThis.crypto?.randomUUID?.() as string) ||
                    `intconn_${Date.now()}`,
                  provider,
                },
              ]);
            }
          } else if (event.type === "portal_button") {
            setMessages((prev) => [
              ...stripEmptyAssistant(prev),
              {
                role: "portal_button",
                id:
                  (globalThis.crypto?.randomUUID?.() as string) ||
                  `portal_${Date.now()}`,
              },
            ]);
          } else if (event.type === "celebrate") {
            import("canvas-confetti").then(({ default: confetti }) => {
              confetti({
                particleCount: 120,
                spread: 75,
                origin: { y: 0.6 },
                colors: ["#0CBF6A", "#ffffff", "#0A9452"],
              });
              setTimeout(() => {
                confetti({
                  particleCount: 50,
                  angle: 60,
                  spread: 55,
                  origin: { x: 0 },
                  colors: ["#0CBF6A", "#ffffff"],
                });
                confetti({
                  particleCount: 50,
                  angle: 120,
                  spread: 55,
                  origin: { x: 1 },
                  colors: ["#0CBF6A", "#ffffff"],
                });
              }, 250);
            });
          } else if (event.type === "error") {
            setError(event.message || "Stream error");
          }
        }
      }

      // Drop trailing empty-assistant placeholder (e.g. tool call without follow-up text).
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && !last.content.trim()) {
          return prev.slice(0, -1);
        }
        return prev;
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setError(message);
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setStreaming(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // Chat-surface drag-drop. Dropped files upload to brand-docs (type='other')
  // and surface as an uploaded_file bubble; we then post a canned user line
  // so the AI sees the filename and can react in-conversation.
  // Upload one file. Returns the canned "I uploaded a file: ..." line on
  // success so the caller can batch a single user message to the AI when
  // multiple files are dropped at once. Returns null on failure (the
  // bubble is flipped to the error state in-line).
  async function uploadChatFile(file: File): Promise<string | null> {
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`"${file.name}" is over 25 MB - drop a smaller file.`);
      return null;
    }
    const id =
      (globalThis.crypto?.randomUUID?.() as string) || `up_${Date.now()}_${Math.random()}`;
    setMessages((prev) => [
      ...prev,
      {
        role: "uploaded_file",
        id,
        filename: file.name,
        size: file.size,
        url: "",
        status: "uploading",
      },
    ]);

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("type", "other");
      const res = await fetch("/api/onboarding/brand-docs/upload", {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);

      const url: string = data.document?.storage_url ?? "";
      setMessages((prev) =>
        prev.map((m) =>
          m.role === "uploaded_file" && m.id === id
            ? { ...m, status: "ready", url }
            : m
        )
      );

      return `I uploaded a file: ${file.name} (${formatBytes(file.size)}). It's saved at ${url || "[uploaded to brand-docs]"}.`;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setMessages((prev) =>
        prev.map((m) =>
          m.role === "uploaded_file" && m.id === id
            ? { ...m, status: "error", error: message }
            : m
        )
      );
      setError(message);
      return null;
    }
  }

  async function uploadFiles(files: FileList | File[]) {
    if (streaming) return;
    setError("");
    const arr = Array.from(files);
    // Upload sequentially to keep bubble order + share a single error
    // surface. We DO NOT gate each upload on `streaming` - the previous
    // implementation called sendMessage() inside uploadChatFile, which
    // flipped streaming=true and made the early `if (streaming) return`
    // silently drop every file after the first. Now we collect canned
    // lines and send ONE combined message to the AI at the end.
    const cannedLines: string[] = [];
    for (const f of arr) {
      const line = await uploadChatFile(f);
      if (line) cannedLines.push(line);
    }
    if (cannedLines.length > 0) {
      // Tell the AI everything that landed in one user turn so it can
      // fold the docs into onboarding extraction.
      sendMessage(cannedLines.join("\n"));
    }
  }

  function handleDragEnter(e: React.DragEvent) {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    dragCounter.current += 1;
    setDragOverChat(true);
  }
  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragOverChat(false);
  }
  function handleDragOver(e: React.DragEvent) {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOverChat(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) void uploadFiles(files);
  }

  const pct = Math.min(
    100,
    Math.round((progress.current / Math.max(progress.total, 1)) * 100)
  );

  return (
    <div
      className="relative flex h-full flex-col"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragOverChat && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-[rgba(6,11,8,0.78)] backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-[#0CBF6A]/60 bg-[rgba(12,191,106,0.06)] px-8 py-6 text-center">
            <Upload className="h-6 w-6 text-[#0CBF6A]" />
            <p className="text-sm font-medium text-foreground">Drop file to attach</p>
            <p className="text-[11px] text-muted-foreground/70">Up to 25 MB - PDFs, images, transcripts</p>
          </div>
        </div>
      )}
      {/* Progress bar */}
      <div className="rg-fade-in shrink-0 border-b border-[rgba(255,255,255,0.06)] bg-[#0A1210]/40">
        <div className="mx-auto flex max-w-2xl items-center gap-4 px-6 py-3 md:px-8">
          <div className="min-w-0 flex-1">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-[rgba(255,255,255,0.5)]">
              Onboarding progress
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
              <div
                className="h-full rounded-full bg-[#0CBF6A] transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          {justSaved && (
            <div className="rg-fade-in flex shrink-0 items-center gap-1.5 rounded-full bg-[rgba(12,191,106,0.12)] px-2.5 py-1 text-[11px] font-medium text-[#0CBF6A]">
              <Check className="h-3 w-3" />
              {justSaved}
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 md:px-8">
        <div className="mx-auto max-w-2xl space-y-6 py-8">
          {/* Hero drop zone, visible until the client uploads at least
              one file. Drop-first UX per Pedro: read assets before
              firing the long-form questionnaire. */}
          {!messages.some(
            (m) => m.role === "uploaded_file" && m.status !== "error",
          ) && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={streaming}
              className="group flex w-full flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-[rgba(12,191,106,0.35)] bg-[rgba(12,191,106,0.04)] px-6 py-10 text-center transition-colors hover:border-[#0CBF6A]/70 hover:bg-[rgba(12,191,106,0.08)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Upload className="h-7 w-7 text-[#0CBF6A]" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  Drop your brand assets here
                </p>
                <p className="text-[12px] text-muted-foreground/80">
                  Decks, brand guides, sales call transcripts, ad creatives, screenshots. I will read them and pre-fill what I can.
                </p>
                <p className="text-[11px] text-muted-foreground/60">
                  Click to browse, or drag files anywhere on this page. Up to 25 MB each.
                </p>
              </div>
            </button>
          )}
          {messages.map((msg, i) => (
            <MessageBubble
              key={i}
              message={msg}
              streaming={streaming && i === messages.length - 1}
              onFinishUploader={(canned) => sendMessage(canned)}
              onFinishTelegram={(canned) => sendMessage(canned)}
              onFinishIntegration={(canned) => sendMessage(canned)}
            />
          ))}
          {error && (
            <p className="rg-fade-in text-sm text-destructive">{error}</p>
          )}
        </div>
      </div>

      {/* Input bar */}
      <div className="shrink-0 border-t border-[rgba(255,255,255,0.06)] bg-[#060B08]/80 backdrop-blur">
        <div className="mx-auto max-w-2xl px-6 py-4 md:px-8">
          <div className="flex items-end gap-2 rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#0A1210] p-2 focus-within:border-[rgba(12,191,106,0.4)]">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={streaming}
              aria-label="Attach file"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground/70 transition-colors hover:bg-[rgba(255,255,255,0.04)] hover:text-foreground disabled:opacity-40"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  void uploadFiles(e.target.files);
                  e.target.value = "";
                }
              }}
            />
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="Type your answer or drop a file..."
              className="min-h-[40px] flex-1 resize-none bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none"
            />
            <Button
              type="button"
              size="icon"
              onClick={() => sendMessage()}
              disabled={!input.trim() || streaming}
              aria-label="Send message"
              className="h-9 w-9 shrink-0 rounded-xl"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground/50">
            Powered by Rawgrowth AI · Press Enter to send, Shift+Enter for newline · Drop files to attach
          </p>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  streaming,
  onFinishUploader,
  onFinishTelegram,
  onFinishIntegration,
}: {
  message: ChatMessage;
  streaming: boolean;
  onFinishUploader: (canned: string) => void;
  onFinishTelegram: (canned: string) => void;
  onFinishIntegration: (canned: string) => void;
}) {
  if (message.role === "reasoning") {
    return <ReasoningBubble message={message} />;
  }

  if (message.role === "uploaded_file") {
    return <UploadedFileBubble message={message} />;
  }

  if (message.role === "user") {
    return (
      <div className="rg-fade-in flex justify-end" data-role="user">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[rgba(12,191,106,0.12)] px-4 py-2.5 text-sm text-foreground">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.role === "brand_docs_uploader") {
    return <BrandDocsUploader onFinish={onFinishUploader} />;
  }

  if (message.role === "telegram_connector") {
    return (
      <TelegramConnectorBlock
        onFinish={({ connected, skipped }) => {
          if (connected.length > 0) {
            const list = connected.join(", ");
            const tail =
              skipped.length > 0
                ? ` Skipping ${skipped.join(", ")} for now.`
                : "";
            onFinishTelegram(
              `Connected Telegram for ${list}.${tail} Ready to continue.`,
            );
          } else {
            onFinishTelegram(
              "No Telegram bots connected yet - I'll wire them later from /agents.",
            );
          }
        }}
      />
    );
  }

  if (message.role === "integration_connector") {
    const provider = message.provider;
    const label = INTEGRATION_DISPLAY_NAME[provider] ?? provider;
    return (
      <IntegrationConnectorBlock
        provider={provider}
        onFinish={({ connected }) => {
          if (connected) {
            onFinishIntegration(`Connected ${label}. Continue.`);
          } else {
            onFinishIntegration(`Skipped ${label} for now. Continue.`);
          }
        }}
      />
    );
  }

  if (message.role === "portal_button") {
    return <PortalButton />;
  }

  return (
    <div className="rg-fade-in flex gap-3" data-role="assistant">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[rgba(12,191,106,0.08)]">
        <Image
          src="/rawgrowth.png"
          alt="Rawgrowth"
          width={20}
          height={20}
          className="h-5 w-5 object-contain"
        />
      </div>
      <div className="min-w-0 flex-1 pt-0.5 text-sm leading-relaxed text-[rgba(255,255,255,0.88)]">
        {message.content ? (
          <Response>{message.content}</Response>
        ) : streaming ? (
          <span className="inline-flex h-3 items-center gap-1 text-muted-foreground/60">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:.15s]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:.3s]" />
          </span>
        ) : null}
      </div>
    </div>
  );
}

type ReasoningMessage = Extract<ChatMessage, { role: "reasoning" }>;

function ReasoningBubble({ message }: { message: ReasoningMessage }) {
  const [expanded, setExpanded] = useState(false);
  const hasFields = message.fields && Object.keys(message.fields).length > 0;
  const fieldCount = hasFields ? Object.keys(message.fields!).length : 0;

  const isThinking = message.status === "thinking";
  const isError = message.status === "error";

  return (
    <div className="rg-fade-in">
      <button
        type="button"
        onClick={() => hasFields && setExpanded((e) => !e)}
        disabled={!hasFields}
        className={`relative flex w-full items-center gap-2.5 overflow-hidden rounded-lg border px-3 py-2 text-left text-[12px] transition-colors ${
          isError
            ? "border-destructive/30 bg-destructive/5 text-destructive"
            : "border-[rgba(12,191,106,0.18)] bg-[rgba(12,191,106,0.04)] text-[rgba(255,255,255,0.75)]"
        } ${hasFields ? "cursor-pointer hover:bg-[rgba(12,191,106,0.07)]" : "cursor-default"}`}
      >
        {isThinking && (
          <span className="pointer-events-none absolute inset-0 rg-shimmer" />
        )}

        {isError ? (
          <AlertCircle className="relative h-3.5 w-3.5 shrink-0" />
        ) : isThinking ? (
          <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
            <span className="h-2 w-2 rounded-full bg-[#0CBF6A] rg-pulse-dot" />
          </span>
        ) : (
          <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-[#0CBF6A]/20 text-[#0CBF6A]">
            <Check className="h-2.5 w-2.5" strokeWidth={3} />
          </span>
        )}

        <span className="relative flex-1 truncate font-medium">
          {message.label}
          {!isThinking && !isError && hasFields && (
            <span className="ml-1.5 text-[rgba(255,255,255,0.4)]">
              · {fieldCount} field{fieldCount === 1 ? "" : "s"}
            </span>
          )}
        </span>

        {hasFields && !isThinking && !isError && (
          <ChevronDown
            className={`relative h-3.5 w-3.5 shrink-0 transition-transform ${
              expanded ? "rotate-180" : ""
            } text-[rgba(255,255,255,0.4)]`}
          />
        )}
      </button>

      {expanded && hasFields && (
        <div className="rg-fade-in mt-1.5 rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#0A1210]/60 px-3 py-2">
          <dl className="grid gap-1.5 text-[11px]">
            {Object.entries(message.fields!).map(([key, value]) => (
              <div key={key} className="flex gap-2">
                <dt className="shrink-0 font-mono text-[rgba(12,191,106,0.8)]">
                  {key}
                </dt>
                <dd className="min-w-0 flex-1 text-[rgba(255,255,255,0.65)]">
                  {formatValue(value)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {isError && message.error && (
        <p className="mt-1 text-[11px] text-destructive/80">{message.error}</p>
      )}
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return " - ";
  if (typeof v === "string") return v || " - ";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let size = n;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i += 1;
  }
  return `${size.toFixed(size < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

type UploadedFileMessage = Extract<ChatMessage, { role: "uploaded_file" }>;

function UploadedFileBubble({ message }: { message: UploadedFileMessage }) {
  const isError = message.status === "error";
  const isUploading = message.status === "uploading";
  return (
    <div className="rg-fade-in flex justify-end" data-role="uploaded_file">
      <div
        className={`flex max-w-[85%] items-center gap-2.5 rounded-2xl rounded-br-md border px-3 py-2 text-sm ${
          isError
            ? "border-destructive/40 bg-destructive/10 text-destructive"
            : "border-[rgba(12,191,106,0.25)] bg-[rgba(12,191,106,0.08)] text-foreground"
        }`}
      >
        <FileText className="h-4 w-4 shrink-0 opacity-80" />
        <div className="min-w-0 flex-1">
          {message.url && message.status === "ready" ? (
            <a
              href={message.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate font-medium hover:underline"
            >
              {message.filename}
            </a>
          ) : (
            <p className="truncate font-medium">{message.filename}</p>
          )}
          <p className="text-[11px] text-muted-foreground/70">
            {isUploading
              ? `Uploading ${formatBytes(message.size)}…`
              : isError
                ? message.error || "Upload failed"
                : `Attached · ${formatBytes(message.size)}`}
          </p>
        </div>
      </div>
    </div>
  );
}

function BrandDocsUploader({
  onFinish,
}: {
  onFinish: (canned: string) => void;
}) {
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [uploadingZone, setUploadingZone] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch("/api/onboarding/brand-docs/upload")
      .then((r) => r.json())
      .then((data) => setDocs(data.documents ?? []))
      .catch(() => {});
  }, []);

  async function handleFiles(zoneId: string, files: FileList) {
    if (done) return;
    setUploadError(null);
    setUploadingZone(zoneId);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("type", zoneId);
        const res = await fetch("/api/onboarding/brand-docs/upload", {
          method: "POST",
          body: fd,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Upload failed");
        if (data.document) setDocs((prev) => [data.document, ...prev]);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setUploadError(message);
    } finally {
      setUploadingZone(null);
    }
  }

  async function handleDelete(id: string) {
    try {
      await fetch("/api/onboarding/brand-docs/upload", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setDocs((prev) => prev.filter((d) => d.id !== id));
    } catch {}
  }

  function handleContinue() {
    if (done) return;
    setDone(true);
    const n = docs.length;
    onFinish(
      n > 0
        ? `I've uploaded ${n} file${n === 1 ? "" : "s"}  -  done with brand docs.`
        : "Nothing to upload here  -  ready to continue."
    );
  }

  function handleSkip() {
    if (done) return;
    setDone(true);
    onFinish("Skipping brand docs for now.");
  }

  return (
    <div className="rg-fade-in rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#0A1210] p-4">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[rgba(12,191,106,0.12)]">
          <Upload className="h-3.5 w-3.5 text-[#0CBF6A]" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            Upload your brand assets
          </p>
          <p className="text-[11px] text-muted-foreground/70">
            Drag in files or pick them  -  up to 25 MB each
          </p>
        </div>
      </div>

      <div className="space-y-2.5">
        {BRAND_DOC_ZONES.map((zone) => {
          const zoneDocs = docs.filter((d) => d.type === zone.id);
          return (
            <DropZone
              key={zone.id}
              zone={zone}
              docs={zoneDocs}
              uploading={uploadingZone === zone.id}
              disabled={done}
              onFiles={(files) => handleFiles(zone.id, files)}
              onDelete={handleDelete}
            />
          );
        })}
      </div>

      {uploadError && (
        <p className="mt-3 text-[11px] text-destructive">{uploadError}</p>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleSkip}
          disabled={done}
          className="text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
        >
          Skip
        </button>
        <Button
          type="button"
          size="sm"
          onClick={handleContinue}
          disabled={done || uploadingZone !== null}
        >
          {done
            ? "Saved"
            : docs.length > 0
              ? `Continue with ${docs.length} file${docs.length === 1 ? "" : "s"}`
              : "Nothing to upload"}
        </Button>
      </div>
    </div>
  );
}

function DropZone({
  zone,
  docs,
  uploading,
  disabled,
  onFiles,
  onDelete,
}: {
  zone: (typeof BRAND_DOC_ZONES)[number];
  docs: DocumentRecord[];
  uploading: boolean;
  disabled: boolean;
  onFiles: (files: FileList) => void;
  onDelete: (id: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const Icon = zone.id === "logo" ? ImageIcon : zone.id === "guideline" ? FileText : Paperclip;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (disabled) return;
        if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files);
      }}
      className={`rounded-lg border border-dashed p-3 transition-colors ${
        dragOver
          ? "border-[#0CBF6A]/60 bg-[rgba(12,191,106,0.05)]"
          : "border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)]"
      }`}
    >
      <div className="flex items-center gap-3">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground/70" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-foreground">{zone.label}</p>
          <p className="text-[10px] text-muted-foreground/60">
            {zone.description}
          </p>
        </div>
        <button
          type="button"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
          className="rounded-md border border-[rgba(255,255,255,0.1)] px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:border-[rgba(12,191,106,0.3)] hover:text-foreground disabled:opacity-40"
        >
          {uploading ? "Uploading…" : "Choose file"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={zone.accept}
          multiple
          className="hidden"
          onChange={(e) => e.target.files && onFiles(e.target.files)}
        />
      </div>

      {docs.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-[rgba(255,255,255,0.04)] pt-2">
          {docs.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center gap-2 text-[11px] text-muted-foreground"
            >
              <Check className="h-3 w-3 shrink-0 text-[#0CBF6A]" />
              <a
                href={doc.storage_url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate hover:text-foreground"
              >
                {doc.filename}
              </a>
              <button
                type="button"
                onClick={() => onDelete(doc.id)}
                disabled={disabled}
                className="text-muted-foreground/50 transition-colors hover:text-destructive disabled:opacity-40"
                aria-label={`Remove ${doc.filename}`}
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PortalButton() {
  return (
    <div className="rg-fade-in rounded-xl border border-[rgba(12,191,106,0.18)] bg-[rgba(12,191,106,0.04)] p-5 text-center">
      <p className="mb-1 text-sm font-medium text-foreground">
        You&apos;re all set 🎉
      </p>
      <p className="mb-4 text-xs text-muted-foreground/80">
        Your AI department is standing up now. Head into your portal to watch
        the first deliverables land.
      </p>
      <Link
        href="/dashboard"
        className={`${buttonVariants({ size: "lg" })} w-full inline-flex items-center gap-2 sm:w-auto`}
      >
        Continue to Portal
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
