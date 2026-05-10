"use client";

import { useRef, useState, type DragEvent } from "react";
import { useSearchParams } from "next/navigation";
import {
  Bot,
  Brain,
  ClipboardList,
  Code,
  Cpu,
  Crown,
  Eye,
  FileText,
  ListChecks,
  Megaphone,
  MessageSquare,
  Palette,
  PhoneCall,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ClientTime } from "@/components/client-time";
import { TgProvisionModal } from "@/components/tg-provision-modal";
import AgentChatTab from "@/components/agents/AgentChatTab";
import { AGENT_RUNTIMES, AGENT_ROLES } from "@/lib/agents/constants";

function runtimeLabel(value: string | null): string {
  if (!value) return "Default";
  const meta = AGENT_RUNTIMES.find((r) => r.value === value);
  return meta ? meta.label : value;
}

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


// Department palette - mint for active dept (marketing/sales/development),
// muted for support functions (fulfilment/finance). Custom slugs fall
// back to the muted neutral.
const DEPT_STYLE: Record<string, { label: string; tone: string }> = {
  marketing: {
    label: "Marketing",
    tone: "border-[var(--brand-primary)]/40 bg-[var(--brand-primary)]/12 text-[var(--brand-primary)]",
  },
  sales: {
    label: "Sales",
    tone: "border-[var(--brand-primary)]/40 bg-[var(--brand-primary)]/12 text-[var(--brand-primary)]",
  },
  development: {
    label: "Development",
    tone: "border-[var(--brand-primary)]/30 bg-[var(--brand-primary)]/8 text-[var(--brand-primary)]",
  },
  fulfilment: {
    label: "Fulfilment",
    tone: "border-[var(--line-strong)] bg-white/5 text-[var(--text-body)]",
  },
  finance: {
    label: "Finance",
    tone: "border-[var(--line-strong)] bg-white/5 text-[var(--text-body)]",
  },
};

function deptStyle(dept: string | null) {
  if (!dept) return null;
  if (DEPT_STYLE[dept]) return DEPT_STYLE[dept];
  return {
    label: dept.charAt(0).toUpperCase() + dept.slice(1).replace(/_/g, " "),
    tone: "border-[var(--line-strong)] bg-white/5 text-[var(--text-body)]",
  };
}

type AgentStatus = "idle" | "running" | "paused" | "error";

const STATUS_STYLE: Record<
  AgentStatus,
  { label: string; dot: string; text: string; pulse: boolean }
> = {
  idle: {
    label: "Idle",
    dot: "bg-[var(--text-muted)]",
    text: "text-[var(--text-muted)]",
    pulse: false,
  },
  running: {
    label: "Running",
    dot: "bg-[var(--brand-primary)] shadow-[0_0_8px_rgba(51,202,127,.7)]",
    text: "text-[var(--brand-primary)]",
    pulse: true,
  },
  paused: {
    label: "Paused",
    dot: "bg-amber-400",
    text: "text-amber-300",
    pulse: false,
  },
  error: {
    label: "Error",
    dot: "bg-[var(--destructive)]",
    text: "text-[var(--destructive)]",
    pulse: false,
  },
};

type Agent = {
  id: string;
  name: string;
  title: string;
  role: string | null;
  description: string | null;
  department: string | null;
  runtime: string | null;
  reports_to: string | null;
  status?: AgentStatus | null;
  is_department_head?: boolean | null;
  system_prompt?: string | null;
  budget_monthly_usd?: number | null;
  spent_monthly_usd?: number | null;
  updated_at?: string | null;
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
  routine_title?: string | null;
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

type Tab = "chat" | "vision" | "memory" | "files" | "tasks" | "settings";

type SkillLite = { id: string; name: string; category: string; tagline: string };
type DirectReport = {
  id: string;
  name: string;
  role: string;
  department: string | null;
};
type ParentAgent = { id: string; name: string; role: string };
type ConnectorLite = { providerConfigKey: string; displayName: string };

export function AgentPanelClient({
  agent,
  memory,
  tasks,
  telegram,
  files,
  skills = [],
  directReports = [],
  reportsToAgent = null,
  connectors = [],
  initialChatMessages = [],
}: {
  agent: Agent;
  memory: MemoryEntry[];
  tasks: Task[];
  telegram: Telegram;
  files: AgentFile[];
  skills?: SkillLite[];
  directReports?: DirectReport[];
  reportsToAgent?: ParentAgent | null;
  connectors?: ConnectorLite[];
  initialChatMessages?: Array<{ role: string; content: string }>;
}) {
  // Honor `?tab=<name>` so the post-hire toast deep-link
  // (`/agents/<id>?tab=files`) lands the operator on Files tab.
  const searchParams = useSearchParams();
  const initialTab: Tab = (() => {
    const t = searchParams?.get("tab");
    const valid: Tab[] = ["chat", "vision", "memory", "files", "tasks", "settings"];
    return (valid as string[]).includes(t ?? "") ? (t as Tab) : "chat";
  })();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [draftSystemPrompt, setDraftSystemPrompt] = useState(agent.system_prompt ?? "");
  const [draftBudget, setDraftBudget] = useState(String(agent.budget_monthly_usd ?? 500));
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
          systemPrompt: draftSystemPrompt,
          budgetMonthlyUsd: Number(draftBudget) || 0,
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

  const _roleMeta =
    AGENT_ROLES.find((r) => r.value === agent.role) ??
    AGENT_ROLES[AGENT_ROLES.length - 1];
  const RoleIcon = ROLE_ICON_MAP[_roleMeta.icon as RoleIconKey] ?? Bot;
  const dept = deptStyle(agent.department);
  const status = STATUS_STYLE[(agent.status ?? "idle") as AgentStatus];
  const isCeo = agent.role === "ceo";
  const reportsToLabel = agent.reports_to ? "reports up the org" : "top of org";

  const tabMeta: Record<Tab, { label: string; Icon: LucideIcon }> = {
    chat: { label: "Chat", Icon: MessageSquare },
    vision: { label: "Vision", Icon: Eye },
    memory: { label: "Memory", Icon: Brain },
    files: { label: "Files", Icon: FileText },
    tasks: { label: "Tasks", Icon: ListChecks },
    settings: { label: "Settings", Icon: SettingsIcon },
  };

  return (
    <div className="flex h-screen flex-col bg-[var(--brand-bg)]">
      <header className="shrink-0 border-b border-[var(--line)] px-6 py-5">
        <div className="flex items-start gap-4">
          <div
            className={
              "flex size-11 shrink-0 items-center justify-center rounded-xl border " +
              "border-[var(--brand-primary)]/40 bg-[var(--brand-primary)]/10 text-[var(--brand-primary)]"
            }
            aria-hidden
          >
            <RoleIcon className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-serif text-3xl font-normal tracking-tight text-foreground">
                {agent.name}
              </h1>
              {dept && (
                <span
                  className={
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest " +
                    dept.tone
                  }
                >
                  {dept.label}
                </span>
              )}
              <span
                className={
                  "inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2 py-0.5 text-[11px] " +
                  status.text
                }
                title={`Status: ${status.label}`}
              >
                <span
                  className={
                    "size-1.5 rounded-full " +
                    status.dot +
                    (status.pulse ? " animate-pulse" : "")
                  }
                />
                {status.label}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {agent.title}
            </p>
            {isCeo && (
              <p className="mt-0.5 text-xs italic text-[var(--brand-primary)]/85">
                Commands all departments
              </p>
            )}
            <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
              <span>{agent.department ?? "no department"}</span>
              <span className="mx-1.5 text-border">·</span>
              <span>{reportsToLabel}</span>
              <span className="mx-1.5 text-border">·</span>
              <span>
                last activity{" "}
                <ClientTime
                  iso={agent.updated_at}
                  fallback="no activity yet"
                />
              </span>
            </p>
          </div>
        </div>
      </header>

      <nav className="shrink-0 border-b border-[var(--line)] px-6">
        <div className="flex gap-1 text-sm">
          {(["chat", "vision", "memory", "files", "tasks", "settings"] as Tab[]).map((t) => {
            const { label, Icon } = tabMeta[t];
            const active = tab === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={
                  // eslint-disable-next-line rawgrowth-brand/banned-tailwind-defaults -- transition target names box-shadow as the explicit property; arbitrary shadow value is an intentional brand accent
                  "group inline-flex items-center gap-1.5 px-3 py-3 text-[12px] uppercase tracking-widest transition-[color,box-shadow,background-color] " +
                  (active
                    ? "text-primary border-b-2 border-primary"
                    : "text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:bg-[var(--brand-primary)]/8 hover:shadow-[inset_0_-2px_0_rgba(51,202,127,.25)]")
                }
              >
                <Icon className="size-3.5" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <main className="relative min-h-0 flex-1 overflow-auto">
        {tab === "chat" && (
          <div className="h-full">
            <AgentChatTab
              agentId={agent.id}
              agentName={agent.name}
              agentRole={agent.role}
              agentTitle={agent.title}
              initialMessages={initialChatMessages}
            />
          </div>
        )}

        <div className={tab === "chat" ? "hidden" : "px-6 py-6"}>
        {tab === "vision" && (
          <div className="space-y-6">
            <p className="text-xs uppercase tracking-widest text-[var(--text-muted)]">
              What {agent.name} sees and can do
            </p>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <section className="rounded-md border border-[var(--line)] bg-[var(--brand-surface)] p-4">
                <h3 className="text-xs uppercase tracking-widest text-primary">
                  Job description
                </h3>
                <p className="mt-2 text-sm text-[var(--text-body)]">
                  {agent.description?.trim() || (
                    <span className="text-[var(--text-muted)]">
                      No description set. Edit in Settings.
                    </span>
                  )}
                </p>
              </section>

              <section className="rounded-md border border-[var(--line)] bg-[var(--brand-surface)] p-4">
                <h3 className="text-xs uppercase tracking-widest text-primary">
                  System prompt
                </h3>
                {agent.system_prompt?.trim() ? (
                  <p className="mt-2 line-clamp-4 text-sm text-[var(--text-body)]">
                    {agent.system_prompt}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-[var(--text-muted)]">
                    No custom prompt. Falls back to role default.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setTab("settings")}
                  className="mt-2 text-xs text-primary hover:underline"
                >
                  Edit in Settings -&gt;
                </button>
              </section>

              <section className="rounded-md border border-[var(--line)] bg-[var(--brand-surface)] p-4">
                <h3 className="text-xs uppercase tracking-widest text-primary">
                  Org place
                </h3>
                <p className="mt-2 text-sm text-[var(--text-body)]">
                  {reportsToAgent ? (
                    <>
                      Reports to{" "}
                      <a
                        href={`/agents/${reportsToAgent.id}`}
                        className="text-primary hover:underline"
                      >
                        {reportsToAgent.name}
                      </a>
                    </>
                  ) : isCeo ? (
                    "Top of org - reports to no one"
                  ) : (
                    "Independent - reports to no one"
                  )}
                </p>
                <p className="mt-1 text-sm text-[var(--text-body)]">
                  Direct reports: {directReports.length}
                </p>
                {directReports.length > 0 && (
                  <ul className="mt-2 space-y-1 text-[12px] text-[var(--text-muted)]">
                    {directReports.slice(0, 6).map((d) => (
                      <li key={d.id}>
                        <a
                          href={`/agents/${d.id}`}
                          className="hover:text-primary hover:underline"
                        >
                          {d.name}
                        </a>
                        {d.department && (
                          <span className="ml-2 text-[10px] uppercase tracking-wider opacity-60">
                            {d.department}
                          </span>
                        )}
                      </li>
                    ))}
                    {directReports.length > 6 && (
                      <li className="text-[10px] text-[var(--text-muted)]">
                        ...+{directReports.length - 6} more
                      </li>
                    )}
                  </ul>
                )}
              </section>

              <section className="rounded-md border border-[var(--line)] bg-[var(--brand-surface)] p-4">
                <h3 className="text-xs uppercase tracking-widest text-primary">
                  Telegram bot
                </h3>
                {telegram?.status === "connected" ? (
                  <p className="mt-2 text-sm text-[var(--text-body)]">
                    Connected as{" "}
                    <span className="font-mono text-primary">{telegram.display_name}</span>
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
                  size="sm"
                >
                  {telegram?.status === "connected" ? "Replace token" : "Add to Telegram"}
                </Button>
              </section>
            </div>

            <section className="rounded-md border border-[var(--line)] bg-[var(--brand-surface)] p-4">
              <h3 className="text-xs uppercase tracking-widest text-primary">
                Skills attached ({skills.length})
              </h3>
              {skills.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--text-muted)]">
                  No skills wired. Hire-flow auto-attaches role-default skills; tweak
                  in Skills page.
                </p>
              ) : (
                <ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                  {skills.map((s) => (
                    <li
                      key={s.id}
                      className="rounded border border-[var(--line)] bg-[var(--brand-surface-2)] p-2.5"
                    >
                      <div className="flex items-baseline justify-between">
                        <span className="text-sm font-medium text-[var(--text-strong)]">
                          {s.name}
                        </span>
                        <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                          {s.category}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                        {s.tagline}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <section className="rounded-md border border-[var(--line)] bg-[var(--brand-surface)] p-4">
                <h3 className="text-xs uppercase tracking-widest text-primary">
                  Knowledge access
                </h3>
                <ul className="mt-2 space-y-1.5 text-sm text-[var(--text-body)]">
                  <li>
                    <span className="text-primary">{fileList.length}</span> files in
                    private memory (RAG-retrieved per chat)
                  </li>
                  <li>
                    <span className="text-primary">{memory.length}</span> audit-log
                    entries
                  </li>
                  <li>
                    Company corpus -{" "}
                    <span className="text-primary">company_query</span> MCP tool (org-wide)
                  </li>
                  <li>
                    Brand voice filter on outbound -{" "}
                    <span className="text-primary">always on</span>
                  </li>
                </ul>
              </section>

              <section className="rounded-md border border-[var(--line)] bg-[var(--brand-surface)] p-4">
                <h3 className="text-xs uppercase tracking-widest text-primary">
                  Org connectors visible
                </h3>
                {connectors.length === 0 ? (
                  <p className="mt-2 text-sm text-[var(--text-muted)]">
                    Nothing connected yet. See{" "}
                    <a href="/connections" className="text-primary hover:underline">
                      Connections
                    </a>
                    .
                  </p>
                ) : (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {connectors.map((c) => (
                      <li
                        key={c.providerConfigKey}
                        className="rounded-full bg-[var(--brand-surface-2)] px-2.5 py-1 text-[11px] text-[var(--text-body)]"
                      >
                        {c.displayName}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                  Connectors are org-wide. Per-agent scoping coming.
                </p>
              </section>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <StatTile label="Model" value={runtimeLabel(agent.runtime)} />
              <StatTile
                label="Monthly budget"
                value={`$${agent.budget_monthly_usd ?? 0}`}
                detail={`spent $${(agent.spent_monthly_usd ?? 0).toFixed(2)}`}
              />
              <StatTile label="Status" value={status.label} accent={status.text} />
            </div>
          </div>
        )}

        {tab === "memory" && (
          <ul className="space-y-2">
            {memory.length === 0 && (
              <li className="rounded-md border border-dashed border-[var(--line)] bg-[var(--brand-surface)]/40 p-10 text-center">
                <Brain className="mx-auto size-8 text-[var(--brand-primary)]/60" strokeWidth={1.4} />
                <p className="mt-3 text-sm font-medium text-[var(--text-strong)]">
                  No memory yet
                </p>
                <p className="mt-1 mx-auto max-w-md text-[12px] text-[var(--text-muted)]">
                  Every chat reply, routine run, and approval decision lands
                  here as a structured audit entry. Send {agent.name} a
                  message in the Chat tab to seed the first one.
                </p>
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
                    <ClientTime iso={m.ts} />
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
                      <ClientTime iso={f.uploaded_at} />
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
              <li className="rounded-md border border-dashed border-[var(--line)] bg-[var(--brand-surface)]/40 p-10 text-center">
                <ListChecks className="mx-auto size-8 text-[var(--brand-primary)]/60" strokeWidth={1.4} />
                <p className="mt-3 text-sm font-medium text-[var(--text-strong)]">
                  No routines assigned
                </p>
                <p className="mt-1 mx-auto max-w-md text-[12px] text-[var(--text-muted)]">
                  Wire {agent.name} into a routine on the{" "}
                  <a href="/routines" className="text-primary hover:underline">
                    Routines page
                  </a>
                  . Each scheduled run lands here with its status and timing.
                </p>
              </li>
            )}
            {tasks.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between rounded-md border border-[var(--line)] bg-[var(--brand-surface)] p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        "inline-block rounded px-2 py-0.5 text-[11px] uppercase tracking-widest " +
                        (t.status === "succeeded"
                          ? "bg-[#0f1a0d] text-[#aad08f]"
                          : t.status === "failed"
                            ? "bg-[#1a0b08] text-[#f4b27a]"
                            : t.status === "pending"
                              ? "bg-amber-400/10 text-amber-300"
                              : "bg-[var(--brand-surface-2)] text-primary")
                      }
                    >
                      {t.status === "pending" ? "scheduled" : t.status}
                    </span>
                    <span className="truncate text-sm text-[var(--text-strong)]">
                      {t.routine_title ?? "Routine run"}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-[var(--text-muted)]">
                    via {t.source ?? "manual"}
                  </div>
                </div>
                <time className="ml-3 shrink-0 text-[11px] text-[var(--text-muted)]">
                  <ClientTime iso={t.started_at} fallback="Never run" />
                </time>
              </li>
            ))}
          </ul>
        )}

        {tab === "settings" && (
          <div className="max-w-3xl space-y-6">
            <p className="text-xs uppercase tracking-widest text-[var(--text-muted)]">
              Configuration for {agent.name}
            </p>

            <section className="rounded-md border border-[var(--line)] bg-[var(--brand-surface)] p-4">
              <h3 className="text-xs uppercase tracking-widest text-primary">
                Identity
              </h3>
              <div className="mt-3 space-y-3">
                <div>
                  <label className="block text-[11px] uppercase tracking-widest text-[var(--text-muted)]">
                    Job description (1-3 sentences, public-facing)
                  </label>
                  <textarea
                    rows={3}
                    value={draftDescription}
                    onChange={(e) => setDraftDescription(e.target.value)}
                    className="mt-1 w-full rounded-md border border-[var(--line-strong)] bg-[var(--brand-surface-2)] px-3 py-2 text-sm text-[var(--text-strong)]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-widest text-[var(--text-muted)]">
                    System prompt (full instructions Claude sees at run start)
                  </label>
                  <textarea
                    rows={10}
                    value={draftSystemPrompt}
                    onChange={(e) => setDraftSystemPrompt(e.target.value)}
                    placeholder="You are the marketing manager. Write copy in our brand voice. When asked to draft an ad, prefer AIDA. Cite sources from your files when possible."
                    className="mt-1 w-full rounded-md border border-[var(--line-strong)] bg-[var(--brand-surface-2)] px-3 py-2 font-mono text-[12px] text-[var(--text-strong)]"
                  />
                  <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                    Auto-set from role template on hire. Edit to specialize.
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-md border border-[var(--line)] bg-[var(--brand-surface)] p-4">
              <h3 className="text-xs uppercase tracking-widest text-primary">
                Runtime
              </h3>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="block text-[11px] uppercase tracking-widest text-[var(--text-muted)]">
                    Model
                  </label>
                  <select
                    value={draftRuntime}
                    onChange={(e) => setDraftRuntime(e.target.value)}
                    className="mt-1 w-full rounded-md border border-[var(--line-strong)] bg-[var(--brand-surface-2)] px-3 py-2 text-sm text-[var(--text-strong)]"
                  >
                    <option value="">default</option>
                    <option value="claude-opus-4-7">Opus 4.7 (managers)</option>
                    <option value="claude-sonnet-4-6">Sonnet 4.6 (sub-agents)</option>
                    <option value="claude-haiku-4-5">Haiku 4.5 (high-volume)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-widest text-[var(--text-muted)]">
                    Monthly budget (USD)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={draftBudget}
                    onChange={(e) => setDraftBudget(e.target.value)}
                    className="mt-1 w-full rounded-md border border-[var(--line-strong)] bg-[var(--brand-surface-2)] px-3 py-2 text-sm text-[var(--text-strong)]"
                  />
                  <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                    Spent: ${(agent.spent_monthly_usd ?? 0).toFixed(2)} this month
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-md border border-[var(--line)] bg-[var(--brand-surface)] p-4">
              <h3 className="text-xs uppercase tracking-widest text-primary">
                Hooks (read-only)
              </h3>
              <ul className="mt-3 space-y-1.5 text-sm text-[var(--text-body)]">
                <li>
                  Brand-voice filter on outbound -{" "}
                  <span className="text-primary">enforced</span>
                </li>
                <li>
                  11 banned-word eslint rule on internal prompts -{" "}
                  <span className="text-primary">enforced</span>
                </li>
                <li>
                  Per-agent RAG over Files tab -{" "}
                  <span className="text-primary">{fileList.length} docs indexed</span>
                </li>
              </ul>
            </section>

            <div className="flex items-center gap-3">
              <Button onClick={savePersona} disabled={saving}>
                {saving ? "Saving..." : "Save changes"}
              </Button>
              {savedFlash && (
                <span className="text-sm text-[var(--text-muted)]">{savedFlash}</span>
              )}
            </div>
          </div>
        )}
        </div>
      </main>

      {/* end main */}

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

function StatTile({
  label,
  value,
  detail,
  accent,
}: {
  label: string;
  value: string;
  detail?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--brand-surface)] p-3">
      <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </div>
      <div className={"mt-1 font-serif text-lg tracking-tight " + (accent ?? "text-foreground")}>
        {value}
      </div>
      {detail && (
        <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{detail}</div>
      )}
    </div>
  );
}
