"use client";

import useSWR from "swr";
import { jsonFetcher } from "@/lib/swr";

export type RunSummary = {
  id: string;
  organization_id: string;
  routine_id: string;
  trigger_id: string | null;
  source: string;
  status:
    | "pending"
    | "running"
    | "awaiting_approval"
    | "succeeded"
    | "failed";
  input_payload: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  routine: { id: string; title: string } | null;
  agent: {
    id: string;
    name: string;
    role: string;
    title: string | null;
  } | null;
};

export type AuditEvent = {
  id: string;
  ts: string;
  kind: string;
  actor_type: string | null;
  actor_id: string | null;
  detail: Record<string, unknown>;
};

export type RunDetail = {
  run: RunSummary;
  routine: {
    id: string;
    title: string;
    description: string | null;
  } | null;
  agent: RunSummary["agent"];
  events: AuditEvent[];
};

/**
 * Poll faster while any run is still running — so the UI feels live while
 * nothing is happening we don't spam the API.
 */
export function useRuns() {
  const { data, isLoading, mutate } = useSWR<{ runs: RunSummary[] }>(
    "/api/runs",
    jsonFetcher,
    {
      refreshInterval: (latest) => {
        const hasLive = latest?.runs?.some(
          (r) => r.status === "running" || r.status === "pending",
        );
        return hasLive ? 2000 : 15000;
      },
      revalidateOnFocus: true,
    },
  );

  return {
    runs: data?.runs ?? [],
    loaded: !isLoading,
    refresh: mutate,
  };
}

export function useRunDetail(id: string | null) {
  const { data, isLoading, mutate } = useSWR<RunDetail>(
    id ? `/api/runs/${id}` : null,
    jsonFetcher,
    {
      refreshInterval: (latest) => {
        const s = latest?.run?.status;
        return s === "running" || s === "pending" ? 2000 : 0;
      },
    },
  );

  return {
    detail: data,
    loaded: !!data && !isLoading,
    refresh: mutate,
  };
}
