"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ListChecks, ArrowRight, ChevronDown, ChevronRight, CheckCircle2 } from "lucide-react";
import { jsonFetcher } from "@/lib/swr";

type Task = {
  routineId: string;
  title: string;
  description: string | null;
  kind: string;
  createdAt: string | null;
  assignee: { id: string; name: string; role: string | null } | null;
  runCount: number;
  latestStatus: string;
  latestRunAt: string | null;
  latestOutput: string | null;
  latestError: string | null;
  delivered: boolean;
  dedupedFrom: number;
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
  includeDelegations: boolean;
};

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-400/10 text-amber-300",
  running: "bg-primary/10 text-primary",
  succeeded: "bg-[#0f1a0d] text-[#aad08f]",
  failed: "bg-[#1a0b08] text-[#f4b27a]",
};

// Marti GAP #4: "delivered" is a stronger signal than "succeeded" -
// it means the run produced an actual non-empty output string the
// operator can read. The badge uses a brighter green than the
// succeeded badge so it pops on a scan-from-a-parallel-chat path.
const DELIVERED_STYLE =
  "bg-[#143818] text-[#7fe39e] ring-1 ring-inset ring-[#2a6b3a]";

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

// Marti GAP #4 filter tabs. "Delivered" is first AND default so the
// /tasks landing answers her literal "I don't know where to find this
// task now" - the first thing she sees IS the set of finished
// scrapes / runs that have an output payload to read.
type FilterKey = "delivered" | "all";
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "delivered", label: "Delivered" },
  { key: "all", label: "All" },
];

export function TasksClient() {
  // Delegation rows (kind='delegation') are one-shot agent_invoke /
  // chat-task churn - a busy org piles up ~200 and they bury the real
  // routines. Hidden by default; the toggle flips the SWR key so the
  // route opts them back in via ?include=delegations.
  const [showDelegations, setShowDelegations] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("delivered");
  const { data, isLoading } = useSWR<Resp>(
    showDelegations ? "/api/tasks?include=delegations" : "/api/tasks",
    jsonFetcher,
    {
      refreshInterval: 5_000,
      revalidateOnFocus: true,
    },
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const visibleTasks = useMemo(() => {
    if (!data) return [];
    if (filter === "delivered") return data.tasks.filter((t) => t.delivered);
    return data.tasks;
  }, [data, filter]);

  const deliveredCount = useMemo(() => {
    if (!data) return 0;
    return data.tasks.filter((t) => t.delivered).length;
  }, [data]);

  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <div className="h-20 animate-pulse rounded-md border border-border bg-card/40" />
        <div className="h-20 animate-pulse rounded-md border border-border bg-card/40" />
      </div>
    );
  }

  const { counts } = data;

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

      {/* Marti GAP #4 tab strip. role=tablist + arrow-key handling so
          the filters are keyboard reachable (constraint in the brief).
          Tab order: Delivered first (default), then All. The "Show
          delegation churn" toggle stays where it was - it's a separate
          axis (data-shape opt-in) not a filter. */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Filter tasks"
          className="inline-flex rounded-md border border-border bg-card/40 p-1"
          onKeyDown={(e) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            const idx = FILTERS.findIndex((f) => f.key === filter);
            const next =
              e.key === "ArrowRight"
                ? (idx + 1) % FILTERS.length
                : (idx - 1 + FILTERS.length) % FILTERS.length;
            setFilter(FILTERS[next].key);
            e.preventDefault();
          }}
        >
          {FILTERS.map((f) => {
            const active = filter === f.key;
            const count =
              f.key === "delivered" ? deliveredCount : counts.total;
            return (
              <button
                key={f.key}
                role="tab"
                type="button"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onClick={() => setFilter(f.key)}
                className={
                  "rounded-sm px-3 py-1 text-[11px] font-medium uppercase tracking-[1.5px] transition-colors " +
                  (active
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {f.label}
                <span className="ml-2 font-mono text-[10px] opacity-70">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setShowDelegations((v) => !v)}
          className="rounded-md border border-border bg-card/40 px-2 py-1 text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground hover:border-primary/50 hover:text-foreground"
        >
          {showDelegations
            ? "Hide delegation churn"
            : "Show delegation churn"}
        </button>
      </div>
      <div className="mt-2 text-right text-[11px] text-muted-foreground">
        Auto-refreshing every 5s
      </div>

      <div className="mt-6 space-y-3">
        {visibleTasks.length === 0 && (
          <div className="rounded-md border border-dashed border-border bg-card/40 p-5 text-center">
            <ListChecks className="mx-auto size-6 text-muted-foreground" strokeWidth={1.4} />
            <p className="mx-auto mt-3 max-w-md text-[13px] text-muted-foreground">
              {filter === "delivered"
                ? counts.total === 0
                  ? "No tasks yet. Open any agent and ask in chat to create one."
                  : "No delivered tasks yet. Switch to All to see queued or running runs."
                : "No tasks yet. Open any agent and ask in chat to create one."}
            </p>
          </div>
        )}

        {visibleTasks.map((t) => {
          // Delivered rows auto-open on first render so Marti can
          // see the output without an extra click. Once the user
          // touches the row toggle, expanded-set wins.
          const userOpen = expanded.has(t.routineId);
          const open = userOpen || (filter === "delivered" && t.delivered);
          return (
            <div
              key={t.routineId}
              className={
                "rounded-md border bg-card/40 " +
                (t.delivered ? "border-[#2a6b3a]/40" : "border-border")
              }
            >
              <button
                type="button"
                onClick={() => toggle(t.routineId)}
                aria-expanded={open}
                className="flex w-full items-start justify-between gap-3 p-5 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {t.delivered ? (
                      <span
                        className={
                          "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-[1.5px] " +
                          DELIVERED_STYLE
                        }
                      >
                        <CheckCircle2 className="size-3" strokeWidth={2.2} />
                        Delivered
                      </span>
                    ) : (
                      <span
                        className={
                          "inline-block rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-[1.5px] " +
                          (STATUS_STYLE[t.latestStatus] ??
                            "bg-muted text-muted-foreground")
                        }
                      >
                        {t.latestStatus}
                      </span>
                    )}
                    <h3 className="truncate text-[13px] font-medium text-foreground">
                      {t.title}
                    </h3>
                    {t.dedupedFrom > 0 && (
                      <span
                        title={`${t.dedupedFrom} near-duplicate task${t.dedupedFrom === 1 ? "" : "s"} collapsed`}
                        className="inline-block rounded bg-muted/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground"
                      >
                        +{t.dedupedFrom} similar
                      </span>
                    )}
                    {t.kind === "delegation" && (
                      <span className="inline-block rounded bg-muted/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground">
                        delegation
                      </span>
                    )}
                    {t.assignee && (
                      <Link
                        href={`/agents/${t.assignee.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 rounded-full bg-muted/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground hover:text-foreground"
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
                  <Link
                    href={`/tasks/${t.routineId}`}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded-md border border-border bg-card/40 px-2 py-1 text-[10px] font-medium uppercase tracking-[1.5px] text-primary hover:border-primary/50"
                  >
                    Open
                  </Link>
                  {open ? (
                    <ChevronDown className="size-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-4 text-muted-foreground" />
                  )}
                </div>
              </button>
              {open && (
                <div className="border-t border-border px-5 py-4">
                  {t.description && (
                    <div className="mb-3">
                      <p className="text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground">
                        Brief
                      </p>
                      <p className="mt-1 text-[12px] leading-relaxed text-foreground whitespace-pre-wrap">
                        {t.description}
                      </p>
                    </div>
                  )}
                  {t.latestOutput ? (
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-[1.5px] text-primary">
                        Latest output
                      </p>
                      <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-3 text-[12px] leading-relaxed text-foreground">
                        {t.latestOutput}
                      </pre>
                    </div>
                  ) : t.latestError ? (
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-[1.5px] text-[#f4b27a]">
                        Latest error
                      </p>
                      <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-[#3a1a10] bg-[#1a0b08] p-3 text-[12px] leading-relaxed text-[#f4b27a]">
                        {t.latestError}
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
    <div className="rounded-md border border-border bg-card/40 p-5">
      <div className="text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 font-serif text-2xl tracking-tight ${tone}`}>
        {value}
      </div>
    </div>
  );
}
