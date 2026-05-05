"use client";

import useSWR from "swr";
import { jsonFetcher } from "@/lib/swr";
import { X, Activity, CheckCircle2, AlertTriangle, RotateCcw, Sparkles, ListTree, ArrowRight } from "lucide-react";
import { useEffect } from "react";

type TraceEvent = {
  ts: string;
  kind: string;
  label: string;
  detail: string;
  actor: string | null;
  routineId?: string;
  output?: string;
  runStatus?: string;
};

type TraceResponse = {
  insight: { id: string; title: string; severity: string; status: string };
  timeline: TraceEvent[];
  counts: { tasks: number; runs: number; succeeded: number; failed: number };
};

const KIND_ICON: Record<string, { Icon: typeof Activity; tone: string }> = {
  insight_created: { Icon: AlertTriangle, tone: "text-destructive" },
  task_spawned: { Icon: ListTree, tone: "text-primary" },
  task_done: { Icon: CheckCircle2, tone: "text-emerald-400" },
  task_failed: { Icon: AlertTriangle, tone: "text-destructive" },
  task_progress: { Icon: Activity, tone: "text-amber-300" },
  retry: { Icon: RotateCcw, tone: "text-amber-300" },
  resolved: { Icon: Sparkles, tone: "text-emerald-400" },
};

function fmtTs(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TraceDrawer({
  insightId,
  onClose,
}: {
  insightId: string | null;
  onClose: () => void;
}) {
  const { data, isLoading } = useSWR<TraceResponse>(
    insightId ? `/api/insights/${insightId}/trace` : null,
    jsonFetcher,
    { refreshInterval: 10_000 },
  );

  useEffect(() => {
    if (!insightId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [insightId, onClose]);

  if (!insightId) return null;

  const timeline = data?.timeline ?? [];
  const counts = data?.counts;

  return (
    <div className="fixed inset-0 z-50 flex">
      <button
        type="button"
        aria-label="Close trace"
        className="flex-1 bg-black/50"
        onClick={onClose}
      />
      <aside className="flex w-full max-w-2xl flex-col bg-card shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Insight trace
            </p>
            <h2 className="mt-0.5 truncate text-[15px] font-semibold text-foreground">
              {data?.insight?.title ?? "Loading..."}
            </h2>
            {counts && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {counts.tasks} task{counts.tasks === 1 ? "" : "s"} spawned
                {" · "}
                {counts.succeeded}/{counts.runs} runs succeeded
                {counts.failed > 0 ? ` · ${counts.failed} failed` : ""}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-4" strokeWidth={1.6} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          {isLoading && (
            <div className="space-y-3">
              <div className="h-16 animate-pulse rounded-md bg-muted/20" />
              <div className="h-16 animate-pulse rounded-md bg-muted/20" />
            </div>
          )}
          {!isLoading && timeline.length === 0 && (
            <p className="text-center text-[12px] text-muted-foreground">
              No trace events yet. The agent may still be drilling.
            </p>
          )}
          <ol className="relative space-y-4">
            {timeline.map((ev, idx) => {
              const meta = KIND_ICON[ev.kind] ?? {
                Icon: Activity,
                tone: "text-muted-foreground",
              };
              const Icon = meta.Icon;
              const isLast = idx === timeline.length - 1;
              return (
                <li key={`${ev.ts}-${idx}`} className="relative flex gap-3">
                  <div className="relative flex flex-col items-center">
                    <div
                      className={
                        "flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-card " +
                        meta.tone
                      }
                    >
                      <Icon className="size-3.5" strokeWidth={1.8} />
                    </div>
                    {!isLast && (
                      <span className="mt-1 w-px flex-1 bg-border" aria-hidden />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 pb-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-[12px] font-medium text-foreground">
                        {ev.label}
                      </p>
                      <time className="shrink-0 text-[10px] text-muted-foreground">
                        {fmtTs(ev.ts)}
                      </time>
                    </div>
                    {ev.actor && (
                      <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                        <ArrowRight className="size-2.5" strokeWidth={1.8} />
                        {ev.actor}
                      </p>
                    )}
                    {ev.detail && (
                      <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
                        {ev.detail.length > 240
                          ? ev.detail.slice(0, 240) + "..."
                          : ev.detail}
                      </p>
                    )}
                    {ev.output && (
                      <details className="mt-1.5 rounded-md border border-border/40 bg-muted/10 p-2">
                        <summary className="cursor-pointer text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          Output
                        </summary>
                        <p className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-foreground">
                          {ev.output}
                        </p>
                      </details>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </aside>
    </div>
  );
}
