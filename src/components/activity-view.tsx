"use client";

import { useState } from "react";
import {
  Activity as ActivityIcon,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Hand,
  Loader2,
  MessageCircle,
  PauseCircle,
  XCircle,
  Webhook,
  Zap,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { useRuns, type RunSummary } from "@/lib/runs/use-runs";
import { RunDetailSheet } from "@/components/run-detail-sheet";

const sourceIcon: Record<string, typeof MessageCircle> = {
  telegram: MessageCircle,
  manual: Hand,
  webhook: Webhook,
  schedule: CalendarClock,
  integration: Zap,
};

type StatusMeta = {
  label: string;
  chipClass: string;
  dotClass: string;
  Icon: typeof CheckCircle2;
};

const statusMeta: Record<RunSummary["status"], StatusMeta> = {
  pending: {
    label: "Pending",
    chipClass: "bg-white/5 text-muted-foreground",
    dotClass: "bg-muted-foreground/60",
    Icon: Clock3,
  },
  running: {
    label: "Running",
    chipClass: "bg-primary/15 text-primary",
    dotClass: "bg-primary animate-pulse shadow-[0_0_6px_rgba(12,191,106,.6)]",
    Icon: Loader2,
  },
  awaiting_approval: {
    label: "Awaiting approval",
    chipClass: "bg-amber-500/15 text-amber-400",
    dotClass: "bg-amber-400",
    Icon: PauseCircle,
  },
  succeeded: {
    label: "Succeeded",
    chipClass: "bg-primary/10 text-primary",
    dotClass: "bg-primary shadow-[0_0_6px_rgba(12,191,106,.5)]",
    Icon: CheckCircle2,
  },
  failed: {
    label: "Failed",
    chipClass: "bg-destructive/15 text-destructive",
    dotClass: "bg-destructive",
    Icon: XCircle,
  },
};

function formatRelative(iso: string | null) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.max(0, Math.round(diff / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function formatDuration(
  started: string | null,
  completed: string | null,
): string {
  if (!started) return "—";
  const end = completed ? new Date(completed).getTime() : Date.now();
  const ms = end - new Date(started).getTime();
  if (ms < 1000) return `${ms}ms`;
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const mins = Math.floor(secs / 60);
  const rem = Math.round(secs % 60);
  return `${mins}m ${rem}s`;
}

export function ActivityView() {
  const { runs, loaded } = useRuns();
  const [viewingId, setViewingId] = useState<string | null>(null);

  if (!loaded) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-xl border border-border bg-card/30"
          />
        ))}
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <EmptyState
        icon={ActivityIcon}
        title="No runs yet"
        description="When your routines fire — manually, via Telegram, on a schedule, or from an integration event — they'll show up here live as they execute."
      />
    );
  }

  const liveCount = runs.filter(
    (r) => r.status === "running" || r.status === "pending",
  ).length;

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3 text-[12px] text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>
            <span className="font-semibold text-foreground">{runs.length}</span>{" "}
            run{runs.length === 1 ? "" : "s"}
          </span>
          {liveCount > 0 && (
            <Badge
              variant="secondary"
              className="gap-1 bg-primary/15 text-[10px] text-primary"
            >
              <span className="size-1.5 animate-pulse rounded-full bg-primary shadow-[0_0_6px_rgba(12,191,106,.6)]" />
              {liveCount} live
            </Badge>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground/70">
          Auto-refreshes every 2s while runs are in flight
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {runs.map((r) => (
          <RunRow key={r.id} run={r} onOpen={() => setViewingId(r.id)} />
        ))}
      </div>

      {viewingId && (
        <RunDetailSheet
          runId={viewingId}
          open={!!viewingId}
          onOpenChange={(o) => {
            if (!o) setViewingId(null);
          }}
        />
      )}
    </>
  );
}

function RunRow({ run, onOpen }: { run: RunSummary; onOpen: () => void }) {
  const status = statusMeta[run.status];
  const StatusIcon = status.Icon;
  const SourceIcon = sourceIcon[run.source] ?? Hand;

  const output = run.output as { text?: string; toolCalls?: string[] } | null;
  const textPreview = output?.text?.slice(0, 140) ?? "";
  const toolCount = output?.toolCalls?.length ?? 0;

  const isSpinning = run.status === "running";

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-stretch rounded-xl border border-border bg-card/50 text-left transition-colors hover:border-primary/30 hover:bg-card"
    >
      {/* Left: status bar */}
      <div
        className={cn(
          "flex w-10 shrink-0 items-center justify-center border-r border-border",
          run.status === "running" && "bg-primary/5",
        )}
      >
        <StatusIcon
          className={cn(
            "size-4",
            run.status === "succeeded" && "text-primary",
            run.status === "failed" && "text-destructive",
            run.status === "running" && "animate-spin text-primary",
            run.status === "awaiting_approval" && "text-amber-400",
            run.status === "pending" && "text-muted-foreground",
          )}
        />
      </div>

      {/* Middle: content */}
      <div className="flex-1 p-3">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-[13px] font-semibold text-foreground">
            {run.routine?.title ?? "(routine deleted)"}
          </h3>
          <Badge variant="secondary" className={cn("gap-1", status.chipClass)}>
            <span className={cn("size-1.5 rounded-full", status.dotClass)} />
            {status.label}
          </Badge>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <SourceIcon className="size-3" />
            {run.source}
          </span>
          {run.agent && (
            <span>
              Agent: <span className="text-foreground">{run.agent.name}</span>
            </span>
          )}
          <span>
            Started{" "}
            <span className="text-foreground">
              {formatRelative(run.started_at ?? run.created_at)}
            </span>
          </span>
          {(run.started_at || run.completed_at) && (
            <span>
              Duration:{" "}
              <span
                className={cn(
                  "text-foreground",
                  isSpinning && "text-primary",
                )}
              >
                {formatDuration(run.started_at, run.completed_at)}
              </span>
            </span>
          )}
          {toolCount > 0 && (
            <span>
              <span className="text-foreground">{toolCount}</span> tool call
              {toolCount === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {(textPreview || run.error) && (
          <p
            className={cn(
              "mt-2 line-clamp-2 text-[12px] leading-relaxed",
              run.error ? "text-destructive/90" : "text-muted-foreground",
            )}
          >
            {run.error ?? textPreview}
          </p>
        )}
      </div>
    </button>
  );
}
