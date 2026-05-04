"use client";

import useSWR from "swr";
import Link from "next/link";
import { jsonFetcher } from "@/lib/swr";
import { AlertTriangle } from "lucide-react";

type Insight = {
  id: string;
  severity: string;
  title: string;
  status: string;
  loop_count?: number;
};

/**
 * Top-of-page red alarm bar. Visible whenever there's at least one
 * open critical or warning insight. Clicking jumps to the insights
 * panel anchor on the dashboard. Pulses subtly so it's hard to miss.
 */
export function AlarmBanner() {
  const { data } = useSWR<{ insights: Insight[] }>(
    "/api/insights",
    jsonFetcher,
    { refreshInterval: 30_000 },
  );
  const open = (data?.insights ?? []).filter(
    (i) => i.status === "open" && (i.severity === "critical" || i.severity === "warning"),
  );
  if (open.length === 0) return null;
  const critical = open.filter((i) => i.severity === "critical").length;
  const warning = open.length - critical;
  const tone = critical > 0
    ? "border-destructive/40 bg-destructive/10 text-destructive"
    : "border-amber-400/40 bg-amber-400/10 text-amber-200";
  return (
    <Link
      href="/#insights"
      className={
        "flex items-center justify-between gap-3 rounded-md border px-4 py-2.5 text-[12px] " +
        tone
      }
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 animate-pulse" strokeWidth={2} />
        <span className="font-semibold">
          {critical > 0
            ? `${critical} critical metric${critical === 1 ? "" : "s"} need attention`
            : `${warning} warning${warning === 1 ? "" : "s"} need review`}
        </span>
        {warning > 0 && critical > 0 && (
          <span className="opacity-70">+ {warning} warning</span>
        )}
      </div>
      <span className="text-[11px] opacity-80">View →</span>
    </Link>
  );
}
