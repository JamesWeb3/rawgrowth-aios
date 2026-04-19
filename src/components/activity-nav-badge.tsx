"use client";

import { useRuns } from "@/lib/runs/use-runs";

/**
 * Lives inside the Activity sidebar item — shows a pulsing green pill
 * with a count whenever any routine run is running or pending. SWR's
 * smart polling in useRuns() already ticks every 2s while live, 15s
 * otherwise, so this updates in near-real-time without extra plumbing.
 */
export function ActivityNavBadge() {
  const { runs } = useRuns();
  const liveCount = runs.filter(
    (r) => r.status === "running" || r.status === "pending",
  ).length;

  if (liveCount === 0) return null;

  return (
    <span
      aria-label={`${liveCount} run${liveCount === 1 ? "" : "s"} in flight`}
      className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary group-data-[collapsible=icon]:hidden"
    >
      <span className="size-1.5 animate-pulse rounded-full bg-primary shadow-[0_0_6px_rgba(12,191,106,.7)]" />
      {liveCount}
    </span>
  );
}
