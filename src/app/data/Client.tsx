"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  Database,
  FileText,
  Loader2,
  Mail,
  MessageSquare,
  Paperclip,
  Receipt,
  Upload,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const SOURCES = [
  {
    value: "crm_contact",
    label: "CRM Contact",
    Icon: User,
    placeholder:
      "Acme Corp - Maria Silva, VP Sales, maria@acme.com\n+55 11 99999-0001\nLast touch: 2026-04-28 (demo call) - very interested, said budget approved\nUses Pipedrive, sales cycle 45-60 days, ICP fit: 9/10",
  },
  {
    value: "crm_deal",
    label: "CRM Deal / Pipeline",
    Icon: Receipt,
    placeholder:
      "Acme Corp - $48k ARR opportunity, Stage: Proposal\nNext step: send updated SOW by Friday\nDecision maker: Maria (VP Sales) + Jorge (CFO)\nLast objection: integration with legacy ERP - we said yes via Zapier\nClose probability: 60%",
  },
  {
    value: "note",
    label: "Internal Note",
    Icon: FileText,
    placeholder:
      "Engineering decided to deprecate v1 webhook by 2026-06-30. All clients on v1 must migrate. Comms to client list scheduled for May 15.",
  },
  {
    value: "email_thread",
    label: "Email Thread",
    Icon: Mail,
    placeholder:
      "Subject: Re: Pricing question\nFrom: chris@chrisco.com\n>>> They asked about volume discount above 10k MAU. We offered 15% off list price tier 2. Awaiting response.",
  },
  {
    value: "meeting_notes",
    label: "Meeting Notes",
    Icon: MessageSquare,
    placeholder:
      "Weekly leadership sync 2026-05-04\nAttendees: Chris, Pedro, Scan\nDecisions:\n- Push autonomous mode default to ON for paying clients\n- Hire 2 more SDRs by end Q2\n- Cut WooCommerce integration scope, focus Shopify",
  },
  {
    value: "other",
    label: "Other / Free-form",
    Icon: Database,
    placeholder: "Anything else you want every agent to be able to search and cite.",
  },
];

export function DataEntryClient() {
  const [source, setSource] = useState(SOURCES[0].value);
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<{
    chunks: number;
    tokens: number;
  } | null>(null);

  const active = SOURCES.find((s) => s.value === source) ?? SOURCES[0];
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [recentUploads, setRecentUploads] = useState<
    Array<{ name: string; chunks: number }>
  >([]);

  async function handleFiles(picked: FileList | File[]) {
    const arr = Array.from(picked);
    if (arr.length === 0) return;
    setUploading(true);
    const results: Array<{ name: string; chunks: number }> = [];
    try {
      for (const f of arr) {
        const fd = new FormData();
        fd.append("file", f);
        fd.append("bucket", "other");
        const res = await fetch("/api/files/upload", { method: "POST", body: fd });
        const j = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          chunks?: number;
          error?: string;
        };
        if (!res.ok || !j.ok) {
          toast.error(`${f.name}: ${j.error ?? "upload failed"}`);
          continue;
        }
        results.push({ name: f.name, chunks: j.chunks ?? 0 });
      }
      setRecentUploads((prev) => [...results, ...prev].slice(0, 8));
      if (results.length > 0) {
        const total = results.reduce((s, r) => s + r.chunks, 0);
        toast.success(
          `Indexed ${results.length} file${results.length === 1 ? "" : "s"} - ${total} chunks. Searchable by every agent now.`,
        );
      }
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (text.trim().length < 10) {
      toast.error("Add at least a couple sentences before saving.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/data/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source, label: label || active.label, text }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        chunks?: number;
        tokens?: number;
        error?: string;
      };
      if (!res.ok || !body.ok) throw new Error(body.error || "ingest failed");
      setLastResult({ chunks: body.chunks ?? 0, tokens: body.tokens ?? 0 });
      toast.success(
        `Saved - ${body.chunks ?? 0} chunk${body.chunks === 1 ? "" : "s"} indexed (~${body.tokens ?? 0} tokens). Every agent can find it now.`,
      );
      setText("");
      setLabel("");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
      {/* Source picker rail */}
      <aside className="space-y-1.5 rounded-md border border-border bg-card/30 p-3">
        <p className="px-2 text-[10px] font-semibold uppercase tracking-[1.5px] text-muted-foreground">
          Type
        </p>
        {SOURCES.map((s) => {
          const Icon = s.Icon;
          const isActive = source === s.value;
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => setSource(s.value)}
              className={
                "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[12px] transition-colors " +
                (isActive
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-muted/30 hover:text-foreground")
              }
            >
              <Icon className="size-3.5 shrink-0" strokeWidth={1.6} />
              {s.label}
            </button>
          );
        })}
      </aside>

      {/* Form pane */}
      <div className="space-y-4">
        <div>
          <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Label (optional)
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={`e.g. ${active.label} - ${
              source === "crm_contact" ? "Acme Corp" : "May sync"
            }`}
            className="mt-1 w-full rounded-md border border-border bg-card/40 px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
          />
        </div>

        <div>
          <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Content
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={14}
            placeholder={active.placeholder}
            className="mt-1 w-full resize-y rounded-md border border-border bg-card/40 px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {text.length} chars · gets chunked, embedded, and indexed in the
            company corpus. Searchable by every agent (Atlas + dept heads + sub-agents).
          </p>
        </div>

        <div className="flex items-center justify-between">
          <Button onClick={submit} disabled={busy || text.trim().length < 10}>
            {busy ? (
              <>
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                Indexing...
              </>
            ) : (
              "Save to corpus"
            )}
          </Button>
          {lastResult && (
            <p className="text-[11px] text-primary">
              Last save: {lastResult.chunks} chunk{lastResult.chunks === 1 ? "" : "s"} · {lastResult.tokens} tokens
            </p>
          )}
        </div>

        {/* File upload zone - PDF, DOCX, MD, TXT, CSV, JSON, audio (transcribed), images */}
        <div
          className="rounded-md border border-dashed border-border bg-muted/10 p-5"
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={async (e) => {
            e.preventDefault();
            if (e.dataTransfer.files?.length) await handleFiles(e.dataTransfer.files);
          }}
        >
          <div className="flex items-center gap-3">
            <Upload className="size-5 text-primary/70" strokeWidth={1.5} />
            <div className="flex-1">
              <p className="text-[12px] font-medium text-foreground">
                Drop files here or click to upload
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                PDF, DOCX, MD, TXT, CSV, JSON, audio (auto-transcribed), images. Up to 10MB each.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Uploading
                </>
              ) : (
                <>
                  <Paperclip className="size-3.5" />
                  Choose files
                </>
              )}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.md,.markdown,.txt,.csv,.json,.mp3,.m4a,.wav,.webm,image/*,application/pdf,application/json,text/*"
              hidden
              onChange={(e) => {
                if (e.target.files?.length) {
                  void handleFiles(e.target.files);
                }
                e.target.value = "";
              }}
            />
          </div>
          {recentUploads.length > 0 && (
            <div className="mt-3 border-t border-border/40 pt-3 space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground">
                Recently indexed
              </p>
              {recentUploads.map((u, i) => (
                <p key={i} className="font-mono text-[11px] text-foreground">
                  ✓ {u.name} <span className="text-muted-foreground">- {u.chunks} chunks</span>
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-md border border-border bg-card/40 p-4">
          <p className="text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground">
            CRM sync
          </p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
            HubSpot + Pipedrive: drop the API key under{" "}
            <a href="/connections" className="text-primary hover:underline">
              Connections
            </a>
            . The daily cron mirrors the last 24h of contacts + deals into this corpus. Salesforce on the roadmap. Until then, paste exports or drop files here.
          </p>
        </div>
      </div>
    </div>
  );
}
