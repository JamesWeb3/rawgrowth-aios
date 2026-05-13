"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  Activity,
  Bot,
  ChevronDown,
  ChevronRight,
  CircleDot,
  GitBranch,
  Hand,
  MessageCircle,
  PauseCircle,
  ShieldCheck,
  Wrench,
} from "lucide-react";

import { jsonFetcher } from "@/lib/swr";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";

type Kind =
  | "routine_triggered"
  | "routine_completed"
  | "agent_spawned_task"
  | "tool_call_queued"
  | "tool_call_executed"
  | "approval_reviewed"
  | "telegram_inbound"
  | "chat_message"
  | "audit";

type Actor = { type: "agent" | "user" | "system"; id: string | null; name: string };
type Tool = { name: string; app: string | null; action: string | null } | null;
type Routine = { id: string; title: string | null } | null;

type Item = {
  ts: string;
  kind: Kind;
  actor: Actor;
  routine: Routine;
  tool: Tool;
  detail: Record<string, unknown> | string | null;
  sourceId: string;
};

type Resp = { items: Item[]; fetchedAt: string; windowMinutes: number };

const KIND_META: Record<
  Kind,
  { label: string; Icon: typeof Activity; chip: string }
> = {
  routine_triggered: {
    label: "Routine triggered",
    Icon: GitBranch,
    chip: "bg-primary/15 text-primary",
  },
  routine_completed: {
    label: "Routine completed",
    Icon: CircleDot,
    chip: "bg-primary/10 text-primary",
  },
  agent_spawned_task: {
    label: "Agent spawned task",
    Icon: Bot,
    chip: "bg-violet-500/15 text-violet-300",
  },
  tool_call_queued: {
    label: "Tool call queued",
    Icon: PauseCircle,
    chip: "bg-amber-500/15 text-amber-300",
  },
  tool_call_executed: {
    label: "Tool call executed",
    Icon: Wrench,
    chip: "bg-sky-500/15 text-sky-300",
  },
  approval_reviewed: {
    label: "Approval reviewed",
    Icon: ShieldCheck,
    chip: "bg-emerald-500/15 text-emerald-300",
  },
  telegram_inbound: {
    label: "Telegram inbound",
    Icon: MessageCircle,
    chip: "bg-blue-500/15 text-blue-300",
  },
  chat_message: {
    label: "Chat message",
    Icon: MessageCircle,
    chip: "bg-blue-500/10 text-blue-300",
  },
  audit: {
    label: "Audit",
    Icon: Activity,
    chip: "bg-white/5 text-muted-foreground",
  },
};

const WINDOW_OPTIONS = [5, 15, 30, 60] as const;
const KIND_OPTIONS: { value: "all" | Kind; label: string }[] = [
  { value: "all", label: "All kinds" },
  { value: "routine_triggered", label: "Routine triggered" },
  { value: "routine_completed", label: "Routine completed" },
  { value: "agent_spawned_task", label: "Spawned task" },
  { value: "tool_call_queued", label: "Tool queued" },
  { value: "tool_call_executed", label: "Tool executed" },
  { value: "approval_reviewed", label: "Approval reviewed" },
  { value: "telegram_inbound", label: "Telegram" },
  { value: "chat_message", label: "Chat" },
  { value: "audit", label: "Audit" },
];

function formatRelative(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return "-";
  const s = Math.max(0, Math.round(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function detailSummary(detail: Item["detail"]): string {
  if (detail == null) return "";
  if (typeof detail === "string") return detail.replace(/\s+/g, " ").slice(0, 160);
  try {
    const json = JSON.stringify(detail);
    return json.replace(/\s+/g, " ").slice(0, 160);
  } catch {
    return "";
  }
}

export function TraceClient({
  agents,
}: {
  agents: Array<{ id: string; name: string }>;
}) {
  const [windowMinutes, setWindowMinutes] = useState<number>(30);
  const [agentId, setAgentId] = useState<string>("");
  const [kindFilter, setKindFilter] = useState<"all" | Kind>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const qs = new URLSearchParams();
  qs.set("window_minutes", String(windowMinutes));
  if (agentId) qs.set("agent_id", agentId);
  const swrKey = `/api/orchestration/trace?${qs.toString()}`;

  const { data, isLoading } = useSWR<Resp>(swrKey, jsonFetcher, {
    refreshInterval: 5_000,
    revalidateOnFocus: true,
  });

  const items = useMemo(() => {
    const all = data?.items ?? [];
    if (kindFilter === "all") return all;
    return all.filter((i) => i.kind === kindFilter);
  }, [data, kindFilter]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
          Window
        </span>
        {WINDOW_OPTIONS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => setWindowMinutes(w)}
            className={cn(
              "rounded-full border px-3 py-1 text-[11px] transition-colors",
              w === windowMinutes
                ? "border-primary/40 bg-primary/15 text-primary"
                : "border-border bg-card/40 text-muted-foreground hover:text-foreground",
            )}
          >
            {w}m
          </button>
        ))}

        <span className="ml-3 text-[11px] uppercase tracking-widest text-muted-foreground">
          Agent
        </span>
        <select
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          className="rounded-md border border-border bg-card/40 px-2 py-1 text-[12px] text-foreground"
        >
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        <span className="ml-3 text-[11px] uppercase tracking-widest text-muted-foreground">
          Kind
        </span>
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as "all" | Kind)}
          className="rounded-md border border-border bg-card/40 px-2 py-1 text-[12px] text-foreground"
        >
          {KIND_OPTIONS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>

        <span className="ml-auto text-[11px] text-muted-foreground/70">
          Auto-refresh 5s
        </span>
      </div>

      {/* Timeline */}
      {isLoading && !data && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-md border border-border bg-card/40"
            />
          ))}
        </div>
      )}

      {!isLoading && items.length === 0 && (
        <EmptyState
          icon={Activity}
          title="No activity in window"
          description="Widen the window or trigger a routine to see events stream in."
        />
      )}

      <ol className="relative space-y-2">
        {items.map((it) => {
          const meta = KIND_META[it.kind];
          const Icon = meta.Icon;
          const isOpen = expanded.has(it.sourceId);
          const summary = detailSummary(it.detail);
          return (
            <li
              key={it.sourceId}
              className="rounded-md border border-border bg-card/40 transition-colors hover:border-primary/30"
            >
              <button
                type="button"
                onClick={() => toggle(it.sourceId)}
                className="flex w-full items-start gap-3 p-3 text-left"
              >
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-card/60">
                  <Icon className="size-3.5" strokeWidth={1.5} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge variant="secondary" className={cn("gap-1", meta.chip)}>
                      {meta.label}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">
                      {formatRelative(it.ts)}
                    </span>
                    <span className="text-[11px] text-muted-foreground/70">
                      <Hand className="mr-1 inline size-3" />
                      {it.actor.name}
                    </span>
                    {it.routine && (
                      <Link
                        href={`/routines/${it.routine.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-[11px] text-primary hover:underline"
                      >
                        {it.routine.title ?? it.routine.id.slice(0, 8)}
                      </Link>
                    )}
                    {it.tool && (
                      <Badge
                        variant="secondary"
                        className="gap-1 bg-white/5 text-[10px] text-muted-foreground"
                      >
                        <Wrench className="size-3" />
                        {it.tool.name}
                      </Badge>
                    )}
                    <span className="ml-auto text-muted-foreground">
                      {isOpen ? (
                        <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronRight className="size-3.5" />
                      )}
                    </span>
                  </div>
                  {summary && !isOpen && (
                    <p className="mt-1 line-clamp-1 text-[12px] text-muted-foreground">
                      {summary}
                    </p>
                  )}
                </div>
              </button>
              {isOpen && (
                <pre className="overflow-x-auto border-t border-border bg-background/40 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
                  {typeof it.detail === "string"
                    ? it.detail
                    : JSON.stringify(it.detail, null, 2)}
                </pre>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
