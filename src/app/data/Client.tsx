"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  FileText,
  Loader2,
  Mail,
  MessageSquare,
  Receipt,
  Upload,
  User,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { jsonFetcher } from "@/lib/swr";

type SourceTag = {
  value: string;
  label: string;
  Icon: typeof User;
  hint: string;
};

const TAGS: SourceTag[] = [
  { value: "note", label: "Note", Icon: FileText, hint: "Internal note, decision, policy" },
  { value: "crm_contact", label: "Contact", Icon: User, hint: "Person, account, lead" },
  { value: "crm_deal", label: "Deal", Icon: Receipt, hint: "Pipeline, opportunity, quote" },
  { value: "email_thread", label: "Email", Icon: Mail, hint: "Email thread / important reply" },
  { value: "meeting_notes", label: "Meeting", Icon: MessageSquare, hint: "Sync notes, action items" },
];

const PLACEHOLDER =
  "Paste anything you want every agent to remember and cite.\n\nE.g. a CRM contact, deal status, meeting notes, internal decision, email thread - or drop a file below.";

type RecentEntry = {
  kind: "paste" | "file";
  id: string;
  label: string;
  source: string;
  chunks?: number;
  tokens?: number;
  size_bytes?: number | null;
  created_at: string;
};

export function DataEntryClient() {
  const [tag, setTag] = useState<string>(TAGS[0].value);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const { data: recentData, mutate: mutateRecent } = useSWR<{
    entries: RecentEntry[];
  }>("/api/data/recent", jsonFetcher, { refreshInterval: 30_000 });
  const recent = recentData?.entries ?? [];

  async function handleFiles(picked: FileList | File[]) {
    const arr = Array.from(picked);
    if (arr.length === 0) return;
    setUploading(true);
    let totalChunks = 0;
    let okCount = 0;
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
        totalChunks += j.chunks ?? 0;
        okCount += 1;
      }
      if (okCount > 0) {
        toast.success(
          `Indexed ${okCount} file${okCount === 1 ? "" : "s"} - ${totalChunks} chunks. Searchable by every agent.`,
        );
        await mutateRecent();
      }
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    const trimmed = text.trim();
    if (trimmed.length < 10) {
      toast.error("Add at least a couple sentences before saving.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/data/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: tag,
          label: TAGS.find((t) => t.value === tag)?.label ?? "note",
          text: trimmed,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        chunks?: number;
        tokens?: number;
        error?: string;
      };
      if (!res.ok || !body.ok) throw new Error(body.error || "ingest failed");
      toast.success(
        `Saved - ${body.chunks ?? 0} chunk${body.chunks === 1 ? "" : "s"} indexed. Every agent can find it now.`,
      );
      setText("");
      await mutateRecent();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
      {/* Main pane: tags + textarea + upload */}
      <div className="space-y-4">
        {/* Tag pills */}
        <div className="flex flex-wrap gap-2">
          {TAGS.map((t) => {
            const Icon = t.Icon;
            const active = tag === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setTag(t.value)}
                title={t.hint}
                className={
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] transition-colors " +
                  (active
                    ? "border-primary/50 bg-primary/15 text-primary"
                    : "border-border bg-card/40 text-muted-foreground hover:border-primary/30 hover:text-foreground")
                }
              >
                <Icon className="size-3.5" strokeWidth={1.6} />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Drop + paste combined */}
        <div
          className="rounded-lg border border-dashed border-border bg-card/30"
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDrop={async (e) => {
            e.preventDefault();
            if (e.dataTransfer.files?.length) await handleFiles(e.dataTransfer.files);
          }}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            placeholder={PLACEHOLDER}
            className="w-full resize-y rounded-lg bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 px-3 py-2">
            <span className="text-[11px] text-muted-foreground">
              {text.length > 0
                ? `${text.length} chars - chunked + embedded into the company corpus`
                : "Type / paste above, or drop a file (PDF, DOCX, MD, CSV, JSON, TXT, audio, image)"}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                title="Upload file"
              >
                {uploading ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Uploading
                  </>
                ) : (
                  <>
                    <Upload className="size-3.5" />
                    Upload file
                  </>
                )}
              </Button>
              <Button
                size="sm"
                onClick={submit}
                disabled={busy || text.trim().length < 10}
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    Indexing
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          </div>
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

        <p className="text-[11px] text-muted-foreground">
          Connections page wires HubSpot + Pipedrive for daily auto-sync.
          Salesforce on the roadmap. Until then, paste exports or drop CSVs here.
        </p>
      </div>

      {/* Right rail: recently indexed */}
      <aside className="space-y-3">
        <div className="flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-primary" strokeWidth={1.8} />
          <p className="text-[10px] font-semibold uppercase tracking-[1.5px] text-muted-foreground">
            Recently indexed
          </p>
        </div>
        {recent.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-card/20 p-4 text-[11px] text-muted-foreground">
            Nothing yet. Drop a file or paste a note - every agent will pick it up.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {recent.map((r) => (
              <li
                key={`${r.kind}-${r.id}`}
                className="rounded-md border border-border bg-card/40 px-2.5 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12px] font-medium text-foreground">
                    {r.label}
                  </span>
                  <span className="shrink-0 rounded-sm bg-muted/40 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                    {r.kind === "file" ? "file" : (r.source.replace("crm_", "").replace("_", " "))}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>{new Date(r.created_at).toLocaleDateString()}</span>
                  {r.kind === "paste" && r.chunks != null && (
                    <>
                      <span>·</span>
                      <span>{r.chunks} chunk{r.chunks === 1 ? "" : "s"}</span>
                    </>
                  )}
                  {r.kind === "file" && r.size_bytes != null && (
                    <>
                      <span>·</span>
                      <span>{fmtSize(r.size_bytes)}</span>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
