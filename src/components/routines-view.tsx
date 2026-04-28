"use client";

import { useMemo, useState } from "react";
import {
  CalendarClock,
  Hand,
  MessageCircle,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Repeat,
  Webhook,
  Zap,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/empty-state";
import { RoutineSheet } from "@/components/routine-sheet";

import { useAgents } from "@/lib/agents/use-agents";
import {
  describeTrigger,
  type RoutineTrigger,
} from "@/lib/routines/constants";
import { useRoutines } from "@/lib/routines/use-routines";
import type { Routine } from "@/lib/routines/dto";

const triggerIcon: Record<RoutineTrigger["kind"], typeof Zap> = {
  schedule: CalendarClock,
  webhook: Webhook,
  integration: Zap,
  manual: Hand,
  telegram: MessageCircle,
};

function formatRelative(iso: string | null) {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.round(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export function RoutinesView() {
  const { routines, hasHydrated, toggleStatus, runNow } = useRoutines();
  const { agents } = useAgents();

  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = useMemo(
    () => routines.find((r) => r.id === editingId) ?? null,
    [routines, editingId],
  );

  const agentById = useMemo(
    () => new Map(agents.map((a) => [a.id, a])),
    [agents],
  );

  const activeCount = routines.filter((r) => r.status === "active").length;

  if (!hasHydrated) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-30 animate-pulse rounded-xl border border-border bg-card/30"
          />
        ))}
      </div>
    );
  }

  if (routines.length === 0) {
    return (
      <EmptyState
        icon={Repeat}
        title="No routines yet"
        description="Build automated workflows  -  trigger on a schedule, webhook, or integration event; let an agent execute the playbook you write."
        action={
          <RoutineSheet triggerSize="lg" triggerLabel="Create first routine" />
        }
      />
    );
  }

  return (
    <>
      {/* Toolbar */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground">
              {routines.length}
            </span>{" "}
            routine{routines.length === 1 ? "" : "s"}
          </span>
          <span className="text-border">•</span>
          <span>
            <span className="font-semibold text-foreground">{activeCount}</span>{" "}
            active
          </span>
        </div>
        <RoutineSheet />
      </div>

      {/* List */}
      <div className="flex flex-col gap-3">
        {routines.map((r) => {
          const assignee = r.assigneeAgentId
            ? agentById.get(r.assigneeAgentId)
            : null;
          const isActive = r.status === "active";
          const isPaused = r.status === "paused";
          const enabledTriggers = r.triggers.filter((t) => t.enabled);

          return (
            <RoutineRow
              key={r.id}
              routine={r}
              assigneeLabel={
                assignee
                  ? `${assignee.name}${assignee.title ? `  -  ${assignee.title}` : ""}`
                  : "Unassigned"
              }
              isActive={isActive}
              isPaused={isPaused}
              enabledTriggers={enabledTriggers}
              onEdit={() => setEditingId(r.id)}
              onToggle={() => void toggleStatus(r.id)}
              onRun={() => void runNow(r.id)}
            />
          );
        })}
      </div>

      {editing && (
        <RoutineSheet
          mode="edit"
          routine={editing}
          open={!!editing}
          onOpenChange={(o) => {
            if (!o) setEditingId(null);
          }}
        />
      )}
    </>
  );
}

function RoutineRow({
  routine,
  assigneeLabel,
  isActive,
  isPaused,
  enabledTriggers,
  onEdit,
  onToggle,
  onRun,
}: {
  routine: Routine;
  assigneeLabel: string;
  isActive: boolean;
  isPaused: boolean;
  enabledTriggers: RoutineTrigger[];
  onEdit: () => void;
  onToggle: () => void;
  onRun: () => void;
}) {
  return (
    <div className="group rounded-xl border border-border bg-card/50 transition-colors hover:border-primary/30 hover:bg-card">
      <div className="flex items-stretch">
        {/* Main content  -  click to edit */}
        <button
          type="button"
          onClick={onEdit}
          className="flex-1 text-left"
        >
          <div className="flex flex-col gap-2 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-[14px] font-semibold text-foreground">
                    {routine.title || "Untitled routine"}
                  </h3>
                  <Badge
                    variant="secondary"
                    className={cn(
                      "gap-1",
                      isActive && "bg-primary/15 text-primary",
                      isPaused && "bg-muted/40 text-muted-foreground",
                      !isActive && !isPaused && "bg-white/5 text-muted-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        isActive && "bg-primary shadow-[0_0_6px_rgba(12,191,106,.6)]",
                        isPaused && "bg-muted-foreground/80",
                        !isActive && !isPaused && "bg-muted-foreground/60",
                      )}
                    />
                    {isActive ? "Active" : isPaused ? "Paused" : "Archived"}
                  </Badge>
                </div>
                {routine.description && (
                  <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
                    {routine.description}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {enabledTriggers.length === 0 && (
                <Badge
                  variant="secondary"
                  className="bg-muted/30 text-[10px] text-muted-foreground"
                >
                  No active triggers
                </Badge>
              )}
              {enabledTriggers.map((t) => {
                const Icon = triggerIcon[t.kind];
                return (
                  <Badge
                    key={t.id}
                    variant="secondary"
                    className="gap-1 bg-white/5 text-[10px] text-muted-foreground"
                  >
                    <Icon className="size-3" />
                    {describeTrigger(t)}
                  </Badge>
                );
              })}
            </div>
          </div>
        </button>

        {/* Right rail */}
        <div className="flex flex-col items-end justify-between gap-2 border-l border-border px-4 py-3 text-right">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onRun}
              title="Run now"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary/15 hover:text-primary"
            >
              <Play className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={onToggle}
              title={isActive ? "Pause" : "Activate"}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {isActive ? (
                <Pause className="size-3.5" />
              ) : (
                <Play className="size-3.5" />
              )}
            </button>
            <Popover>
              <PopoverTrigger className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">
                <MoreHorizontal className="size-3.5" />
              </PopoverTrigger>
              <PopoverContent
                side="bottom"
                align="end"
                sideOffset={6}
                className="w-44 border-border bg-popover p-1 text-foreground"
              >
                <button
                  type="button"
                  onClick={onEdit}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Pencil className="size-3.5" /> Edit routine
                </button>
                <Separator className="my-1" />
                <button
                  type="button"
                  onClick={onRun}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-primary transition-colors hover:bg-primary/10"
                >
                  <Play className="size-3.5" /> Run now
                </button>
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
            <span className="truncate">
              <span className="text-foreground">{assigneeLabel}</span>
            </span>
            <span>Last run: {formatRelative(routine.lastRunAt)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
