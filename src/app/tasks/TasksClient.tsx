"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ListChecks, ArrowRight, ChevronDown, ChevronRight } from "lucide-react";
import { jsonFetcher } from "@/lib/swr";

type Task = {
  routineId: string;
  title: string;
  description: string | null;
  createdAt: string | null;
  assignee: { id: string; name: string; role: string | null } | null;
  runCount: number;
  latestStatus: string;
  latestRunAt: string | null;
  latestOutput: string | null;
};

type Resp = {
  counts: {
    total: number;
    pending: number;
    running: number;
    succeeded: number;
    failed: number;
  };
  tasks: Task[];
};

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-400/10 text-amber-300",
  running: "bg-primary/10 text-primary",
  succeeded: "bg-[#0f1a0d] text-[#aad08f]",
  failed: "bg-[#1a0b08] text-[#f4b27a]",
};

function fmtRelative(iso: string | null): string {
  if (!iso) return "-";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "-";
  const ms = Date.now() - t;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function TasksClient() {
  const { data, isLoading } = useSWR<Resp>("/api/tasks", jsonFetcher, {
    refreshInterval: 5_000,
    revalidateOnFocus: true,
  });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <div className="h-20 animate-pulse rounded-md border border-border bg-card/40" />
        <div className="h-20 animate-pulse rounded-md border border-border bg-card/40" />
      </div>
    );
  }

  const { counts, tasks } = data;

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Total tasks" value={counts.total} />
        <StatCard label="Pending" value={counts.pending} accent="amber" />
        <StatCard label="Running" value={counts.running} accent="sky" />
        <StatCard label="Succeeded" value={counts.succeeded} accent="green" />
        <StatCard label="Failed" value={counts.failed} accent="red" />
      </div>

      <div className="mt-2 text-right text-[11px] text-muted-foreground">
        Auto-refreshing every 5s
      </div>

      <div className="mt-6 space-y-3">
        {counts.total === 0 && (
          <div className="rounded-md border border-dashed border-border bg-card/30 p-10 text-center">
            <ListChecks className="mx-auto size-8 text-primary/60" strokeWidth={1.4} />
            <p className="mt-3 text-sm font-medium text-foreground">No tasks yet</p>
            <p className="mx-auto mt-1 max-w-md text-[12px] text-muted-foreground">
              Open any agent → Chat tab → ask them to create a task. The agent
              emits a &lt;task&gt; block, the system creates a routine + run,
              and it lands here.
            </p>
          </div>
        )}

        {tasks.map((t) => {
          const open = expanded.has(t.routineId);
          return (
            <div
              key={t.routineId}
              className="rounded-md border border-border bg-card/40"
            >
              <button
                type="button"
                onClick={() => toggle(t.routineId)}
                className="flex w-full items-start justify-between gap-3 p-4 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={
                        "inline-block rounded px-2 py-0.5 text-[10px] uppercase tracking-widest " +
                        (STATUS_STYLE[t.latestStatus] ??
                          "bg-muted text-muted-foreground")
                      }
                    >
                      {t.latestStatus}
                    </span>
                    <h3 className="truncate text-[14px] font-medium text-foreground">
                      {t.title}
                    </h3>
                    {t.assignee && (
                      <Link
                        href={`/agents/${t.assignee.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 rounded-full bg-muted/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
                      >
                        {t.assignee.name}
                        <ArrowRight className="size-2.5" strokeWidth={2} />
                      </Link>
                    )}
                  </div>
                  {t.description && !open && (
                    <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground line-clamp-2">
                      {t.description}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="text-right text-[10px] text-muted-foreground">
                    <div>{fmtRelative(t.createdAt)}</div>
                    <div className="mt-0.5 font-mono">
                      {t.runCount} run{t.runCount === 1 ? "" : "s"}
                    </div>
                  </div>
                  {open ? (
                    <ChevronDown className="size-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-4 text-muted-foreground" />
                  )}
                </div>
              </button>
              {open && (
                <div className="border-t border-border px-4 py-3">
                  {t.description && (
                    <div className="mb-3">
                      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Brief
                      </p>
                      <p className="mt-1 text-[12px] leading-relaxed text-foreground whitespace-pre-wrap">
                        {t.description}
                      </p>
                    </div>
                  )}
                  {t.latestOutput ? (
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-wider text-primary">
                        Latest output
                      </p>
                      <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-3 text-[12px] leading-relaxed text-foreground">
                        {t.latestOutput}
                      </pre>
                    </div>
                  ) : (
                    <p className="text-[12px] text-muted-foreground">
                      {t.latestStatus === "running"
                        ? "Agent working - output will appear when done."
                        : t.latestStatus === "pending"
                          ? "Queued - will start in next ~10s."
                          : "No output recorded."}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "amber" | "sky" | "green" | "red";
}) {
  const tone =
    accent === "amber"
      ? "text-amber-300"
      : accent === "sky"
        ? "text-primary"
        : accent === "green"
          ? "text-[#aad08f]"
          : accent === "red"
            ? "text-[#f4b27a]"
            : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-card/40 p-4">
      <div className="text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 font-serif text-2xl tracking-tight ${tone}`}>
        {value}
      </div>
    </div>
  );
}
