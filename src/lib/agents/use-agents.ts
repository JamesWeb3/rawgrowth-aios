"use client";

import { useCallback } from "react";
import useSWR from "swr";
import { jsonFetcher } from "@/lib/swr";
import type { Agent, AgentCreateInput, AgentUpdateInput } from "./dto";

const AGENTS_KEY = "/api/agents";

/**
 * Client hook for agent CRUD. Backed by SWR so every component that
 * calls useAgents() shares the same cache  -  a hire in one component
 * is visible to every listener immediately.
 */
export function useAgents() {
  const { data, isLoading, mutate } = useSWR<{ agents: Agent[] }>(
    AGENTS_KEY,
    jsonFetcher,
    { revalidateOnFocus: false },
  );

  const agents = data?.agents ?? [];
  const hasHydrated = !isLoading;

  const hireAgent = useCallback(
    async (input: AgentCreateInput): Promise<Agent> => {
      const res = await fetch(AGENTS_KEY, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const { error } = (await res.json()) as { error?: string };
        throw new Error(error ?? "hireAgent failed");
      }
      const { agent } = (await res.json()) as { agent: Agent };
      // Optimistic update across every subscribed instance, then revalidate.
      await mutate(
        (prev) => ({ agents: [...(prev?.agents ?? []), agent] }),
        { revalidate: true },
      );
      return agent;
    },
    [mutate],
  );

  const updateAgent = useCallback(
    async (id: string, patch: AgentUpdateInput): Promise<Agent | null> => {
      const res = await fetch(`${AGENTS_KEY}/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) return null;
      const { agent } = (await res.json()) as { agent: Agent };
      await mutate(
        (prev) => ({
          agents: (prev?.agents ?? []).map((a) => (a.id === id ? agent : a)),
        }),
        { revalidate: false },
      );
      return agent;
    },
    [mutate],
  );

  const removeAgent = useCallback(
    async (id: string) => {
      await fetch(`${AGENTS_KEY}/${id}`, { method: "DELETE" });
      await mutate(
        (prev) => ({
          agents: (prev?.agents ?? [])
            .filter((a) => a.id !== id)
            .map((a) => (a.reportsTo === id ? { ...a, reportsTo: null } : a)),
        }),
        { revalidate: true },
      );
    },
    [mutate],
  );

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  return {
    agents,
    hasHydrated,
    refresh,
    hireAgent,
    updateAgent,
    removeAgent,
  };
}
