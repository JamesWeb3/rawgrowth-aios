"use client";

import { useState } from "react";
import useSWR from "swr";
import { jsonFetcher } from "@/lib/swr";
import { Sparkles, ChevronRight } from "lucide-react";
import { InsightsPanel } from "./insights-panel";

type Insight = {
  id: string;
  severity: "critical" | "warning" | "info" | "positive";
  title: string;
  status: string;
  agent_name: string | null;
};

/**
 * Slim Atlas notification bar. Shows count of new analyses + a click
 * to expand the full InsightsPanel below. Pedro's spec: dashboard
 * starts with the GRAPHS (5-col board); the agent's drilldown lives
 * behind a one-line "Atlas has a new analysis" banner that expands.
 */
export function InsightsBanner() {
  const { data } = useSWR<{ insights: Insight[] }>(
    "/api/insights",
    jsonFetcher,
    { refreshInterval: 30_000 },
  );
  const [open, setOpen] = useState(false);

  const all = data?.insights ?? [];
  const live = all.filter(
    (i) =>
      i.status !== "resolved" &&
      i.status !== "rejected" &&
      i.status !== "dismissed",
  );
  const critical = live.filter((i) => i.severity === "critical").length;
  const warning = live.filter((i) => i.severity === "warning").length;
  const positive = live.filter((i) => i.severity === "positive").length;
  const exec = live.filter((i) => i.status === "executing").length;

  if (live.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-card/30 px-4 py-2.5 text-[12px] text-muted-foreground">
        <Sparkles className="size-3.5 text-primary/50" />
        Atlas is watching the metrics. No anomalies right now.
      </div>
    );
  }

  // Headline copy: pick the most relevant + cleanest sentence
  const headline = (() => {
    if (exec > 0) {
      return `Atlas is executing a plan${exec > 1 ? `s on ${exec} fronts` : ""} - watch progress`;
    }
    if (critical > 0) {
      return `Atlas has a new analysis - ${critical} critical metric${critical > 1 ? "s" : ""} need${critical > 1 ? "" : "s"} a decision`;
    }
    if (warning > 0) {
      return `Atlas has a new analysis - ${warning} warning${warning > 1 ? "s" : ""} to review`;
    }
    return `Atlas spotted ${positive} opportunit${positive > 1 ? "ies" : "y"}`;
  })();

  const tone =
    critical > 0
      ? "border-destructive/40 bg-destructive/5 text-destructive"
      : warning > 0
        ? "border-amber-400/40 bg-amber-400/5 text-amber-300"
        : exec > 0
          ? "border-primary/40 bg-primary/5 text-primary"
          : "border-emerald-400/40 bg-emerald-400/5 text-emerald-300";

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          "flex w-full items-center justify-between gap-3 rounded-md border border-border px-4 py-2.5 text-[12px] font-medium transition-colors " +
          tone +
          " hover:brightness-110"
        }
      >
        <span className="flex items-center gap-2.5">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-50" />
            <span className="relative inline-flex size-2 rounded-full bg-current" />
          </span>
          {headline}
        </span>
        <span className="flex items-center gap-1 text-[11px] opacity-80">
          {open ? "Hide" : "View"}
          <ChevronRight
            className={
              "size-3 transition-transform " + (open ? "rotate-90" : "")
            }
            strokeWidth={2}
          />
        </span>
      </button>

      {open && (
        <div className="mt-3">
          <InsightsPanel />
        </div>
      )}
    </div>
  );
}
