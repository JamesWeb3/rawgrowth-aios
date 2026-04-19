"use client";

import useSWR from "swr";
import { jsonFetcher } from "@/lib/swr";

type Approval = { id: string; status: "pending" | "approved" | "rejected" };
type ListResponse = { approvals: Approval[] };

/**
 * Amber pulsing pill shown on the Approvals sidebar item whenever any
 * approvals are pending. Polls every 10s — same cadence as the inbox.
 */
export function ApprovalsNavBadge() {
  const { data } = useSWR<ListResponse>(
    "/api/approvals?status=pending",
    jsonFetcher,
    { refreshInterval: 10_000 },
  );

  const pendingCount = data?.approvals.length ?? 0;
  if (pendingCount === 0) return null;

  return (
    <span
      aria-label={`${pendingCount} approval${pendingCount === 1 ? "" : "s"} pending`}
      className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-400 group-data-[collapsible=icon]:hidden"
    >
      <span className="size-1.5 animate-pulse rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,.7)]" />
      {pendingCount}
    </span>
  );
}
