"use client";

import { useRef, useState, type DragEvent } from "react";

import { Button } from "@/components/ui/button";
import { TgProvisionModal } from "@/components/tg-provision-modal";
import { AGENT_RUNTIMES } from "@/lib/agents/constants";

function runtimeLabel(value: string | null): string {
  if (!value) return "Default";
  const meta = AGENT_RUNTIMES.find((r) => r.value === value);
  return meta ? meta.label : value;
}

type Agent = {
  id: string;
  name: string;
  title: string;
  role: string | null;
  description: string | null;
  department: string | null;
  runtime: string | null;
  reports_to: string | null;
};

type MemoryEntry = {
  id: string;
  ts: string;
  kind: string;
  actor_type: string | null;
  actor_id: string | null;
  detail: Record<string, unknown> | null;
};

type Task = {
  id: string;
  status: string;
  source: string | null;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  routine_id: string | null;
};

type Telegram = {
  status: string;
  display_name: string | null;
  metadata: Record<string, unknown> | null;
} | null;

type AgentFile = {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
};

type Tab = "overview" | "memory" | "files" | "tasks" | "settings";

export function AgentPanelClient({
  agent,
  memory,
  tasks,
  telegram,
  files,
}: {
  agent: Agent;
  memory: MemoryEntry[];
  tasks: Task[];
  telegram: Telegram;
  files: AgentFile[];
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [fileList, setFileList] = useState<AgentFile[]>(files);
  const [uploading, setUploading] = useState(false);
  const [uploadFlash, setUploadFlash] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [draftDescription, setDraftDescription] = useState(
    agent.description ?? "",
  );
  const [draftRuntime, setDraftRuntime] = useState(agent.runtime ?? "");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [tgOpen, setTgOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function uploadFiles(picked: FileList | File[]) {
    const arr = Array.from(picked);
    if (arr.length === 0) return;
    setUploading(true);
    setUploadFlash(null);
    let okCount = 0;
    let totalChunks = 0;
    const errs: string[] = [];
    const fresh: AgentFile[] = [];
    for (const f of arr) {
      try {
        const fd = new FormData();
        fd.append("file", f);
        fd.append("agent_id", agent.id);
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
        if (j.file_id) {
          fresh.push({
            id: j.file_id,
            filename: f.name,
            mime_type: f.type || "application/octet-stream",
            size_bytes: f.size,
            uploaded_at: new Date().toISOString(),
          });
        }
      } catch (err) {
        errs.push(`${f.name}: ${(err as Error).message}`);
      }
    }
    setFileList((prev) => [...fresh, ...prev]);
    const okMsg = okCount > 0 ? `${okCount} file(s) . ${totalChunks} chunks` : "";
    const errMsg = errs.length > 0 ? errs.join("; ") : "";
    setUploadFlash([okMsg, errMsg].filter(Boolean).join(" / ") || null);
    setUploading(false);
  }

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  async function savePersona() {
    setSaving(true);
    setSavedFlash(null);
    try {
      const res = await fetch(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description: draftDescription,
          runtime: draftRuntime,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Update failed");
      }
      setSavedFlash("Saved");
    } catch (err) {
      setSavedFlash((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-screen flex-col bg-[var(--brand-bg)]">
      <header className="shrink-0 border-b border-[var(--line)] px-6 py-5">
        <h1 className="font-serif text-3xl font-normal tracking-tight text-foreground">
          {agent.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {agent.title}
          {agent.department ? ` · ${agent.department}` : ""}
        </p>
      </header>

      <nav className="shrink-0 border-b border-[var(--line)] px-6">
        <div className="flex gap-6 text-sm">
          {(["overview", "memory", "files", "tasks", "settings"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={
                "py-3 uppercase tracking-widest " +
                (tab === t
                  ? "text-primary border-b-2 border-primary"
                  : "text-[var(--text-muted)] hover:text-[var(--text-strong)]")
              }
            >
              {t}
            </button>
          ))}
        </div>
      </nav>

      <main className="min-h-0 flex-1 overflow-auto px-6 py-6">
        {tab === "overview" && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <section className="rounded-md border border-[var(--line)] bg-[var(--brand-surface)] p-4">
              <h3 className="text-xs uppercase tracking-widest text-primary">
                Job description
              </h3>
              <p className="mt-2 text-sm text-[var(--text-body)]">
                {agent.description?.trim() || (
                  <span className="text-[var(--text-muted)]">
                    No description set. Edit in Settings tab.
                  </span>
                )}
              </p>
            </section>

            <section className="rounded-md border border-[var(--line)] bg-[var(--brand-surface)] p-4">
              <h3 className="text-xs uppercase tracking-widest text-primary">
                Telegram
              </h3>
              {telegram?.status === "connected" ? (
                <p className="mt-2 text-sm text-[var(--text-body)]">
                  Connected as{" "}
                  <span className="font-mono text-primary">
                    {telegram.display_name}
                  </span>
                </p>
              ) : (
                <p className="mt-2 text-sm text-[var(--text-muted)]">
                  {telegram?.status === "pending_token"
                    ? "Pending. Paste a BotFather token to go live."
                    : "Not configured."}
                </p>
              )}
              <Button
                className="mt-3"
                onClick={() => setTgOpen(true)}
                variant={telegram?.status === "connected" ? "ghost" : "default"}
              >
                {telegram?.status === "connected"
                  ? "Replace token"
                  : "Add to Telegram"}
              </Button>
            </section>

            <section className="rounded-md border border-[var(--line)] bg-[var(--brand-surface)] p-4">
              <h3 className="text-xs uppercase tracking-widest text-primary">
                Runtime
              </h3>
              <p className="mt-2 text-sm text-[var(--text-body)]">
                {runtimeLabel(agent.runtime)}
              </p>
            </section>

            <section className="rounded-md border border-[var(--line)] bg-[var(--brand-surface)] p-4">
              <h3 className="text-xs uppercase tracking-widest text-primary">
                Recent activity
              </h3>
              <p className="mt-2 text-sm text-[var(--text-body)]">
                {memory.length} memory entries · {tasks.length} routine runs
              </p>
            </section>
          </div>
        )}

        {tab === "memory" && (
          <ul className="space-y-2">
            {memory.length === 0 && (
              <li className="rounded-md border border-dashed border-[var(--line)] bg-[var(--brand-surface)]/40 p-6 text-center text-sm text-[var(--text-muted)]">
                No memory yet. As this agent runs, decisions and learnings appear here.
              </li>
            )}
            {memory.map((m) => (
              <li
                key={m.id}
                className="rounded-md border border-[var(--line)] bg-[var(--brand-surface)] p-3"
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-[11px] uppercase text-primary">
                    {m.kind}
                  </span>
                  <time className="text-[11px] text-[var(--text-muted)]">
                    {new Date(m.ts).toLocaleString()}
                  </time>
                </div>
                <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs text-[var(--text-body)]">
                  {JSON.stringify(m.detail, null, 2)}
                </pre>
              </li>
            ))}
          </ul>
        )}

        {tab === "files" && (
          <div className="space-y-4">
            <div
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
              onClick={() => fileInputRef.current?.click()}
              className={
                "flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-6 py-8 text-center transition-colors " +
                (dragActive
                  ? "border-primary bg-[var(--brand-surface-2)]"
                  : "border-[var(--line-strong)] bg-[var(--brand-surface)] hover:border-primary")
              }
            >
              <p className="text-sm text-[var(--text-strong)]">
                {uploading
                  ? "Uploading..."
                  : "Drop files here, or click to browse"}
              </p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                PDF / DOCX / MD / TXT / CSV / image · up to 100 MB
              </p>
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
            </div>

            {uploadFlash && (
              <div className="rounded-md border border-[var(--line)] bg-[var(--brand-surface)] px-3 py-2 text-xs text-[var(--text-muted)]">
                {uploadFlash}
              </div>
            )}

            {fileList.length === 0 ? (
              <p className="rounded-md border border-[var(--line)] bg-[var(--brand-surface)] p-4 text-sm text-[var(--text-muted)]">
                No files attached. Drop a PDF/DOCX/MD/TXT/CSV/image to give this
                agent context.
              </p>
            ) : (
              <ul className="space-y-2">
                {fileList.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center justify-between rounded-md border border-[var(--line)] bg-[var(--brand-surface)] p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-[var(--text-strong)]">
                        {f.filename}
                      </p>
                      <p className="font-mono text-[11px] text-[var(--text-muted)]">
                        {f.mime_type} · {formatSize(f.size_bytes)}
                      </p>
                    </div>
                    <time className="ml-3 shrink-0 text-[11px] text-[var(--text-muted)]">
                      {new Date(f.uploaded_at).toLocaleString()}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === "tasks" && (
          <ul className="space-y-2">
            {tasks.length === 0 && (
              <li className="rounded-md border border-dashed border-[var(--line)] bg-[var(--brand-surface)]/40 p-6 text-center text-sm text-[var(--text-muted)]">
                No routines assigned. Wire this agent into a routine on the Routines page.
              </li>
            )}
            {tasks.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between rounded-md border border-[var(--line)] bg-[var(--brand-surface)] p-3"
              >
                <div>
                  <span
                    className={
                      "inline-block rounded px-2 py-0.5 text-[11px] uppercase tracking-widest " +
                      (t.status === "succeeded"
                        ? "bg-[#0f1a0d] text-[#aad08f]"
                        : t.status === "failed"
                          ? "bg-[#1a0b08] text-[#f4b27a]"
                          : "bg-[var(--brand-surface-2)] text-primary")
                    }
                  >
                    {t.status}
                  </span>
                  <span className="ml-3 font-mono text-xs text-[var(--text-muted)]">
                    {t.source ?? " - "}
                  </span>
                </div>
                <time className="text-[11px] text-[var(--text-muted)]">
                  {t.started_at
                    ? new Date(t.started_at).toLocaleString()
                    : " - "}
                </time>
              </li>
            ))}
          </ul>
        )}

        {tab === "settings" && (
          <div className="max-w-2xl space-y-4">
            <div>
              <label className="block text-xs uppercase tracking-widest text-primary">
                Job description
              </label>
              <textarea
                rows={6}
                value={draftDescription}
                onChange={(e) => setDraftDescription(e.target.value)}
                className="mt-1 w-full rounded-md border border-[var(--line-strong)] bg-[var(--brand-surface-2)] px-3 py-2 text-sm text-[var(--text-strong)]"
              />
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                Doubles as the agent's system prompt  -  Claude reads this at the
                start of every run.
              </p>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-widest text-primary">
                Model
              </label>
              <select
                value={draftRuntime}
                onChange={(e) => setDraftRuntime(e.target.value)}
                className="mt-1 w-full rounded-md border border-[var(--line-strong)] bg-[var(--brand-surface-2)] px-3 py-2 text-sm text-[var(--text-strong)]"
              >
                <option value="">default</option>
                <option value="claude-opus-4-7">Opus 4.7 (managers)</option>
                <option value="claude-sonnet-4-6">
                  Sonnet 4.6 (sub-agents)
                </option>
                <option value="claude-haiku-4-5">Haiku 4.5 (high-volume)</option>
              </select>
            </div>

            <div className="flex items-center gap-3">
              <Button onClick={savePersona} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              {savedFlash && (
                <span className="text-sm text-[var(--text-muted)]">
                  {savedFlash}
                </span>
              )}
            </div>
          </div>
        )}
      </main>

      {tgOpen && (
        <TgProvisionModal
          agentId={agent.id}
          agentName={agent.name}
          agentRole={agent.reports_to ? "sub-agent" : "manager"}
          onClose={() => setTgOpen(false)}
          onConnected={() => {
            setTgOpen(false);
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}
