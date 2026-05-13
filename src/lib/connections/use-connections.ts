"use client";

import { useCallback, useMemo } from "react";
import useSWR from "swr";
import { jsonFetcher } from "@/lib/swr";
import { providerConfigKeyFor } from "@/lib/connections/providers";

export type ConnectionRow = {
  id: string;
  organization_id: string;
  provider_config_key: string;
  nango_connection_id: string;
  display_name: string | null;
  status: "connected" | "error" | "disconnected" | "pending_token";
  metadata: Record<string, unknown>;
  connected_at: string;
  updated_at: string;
};

const CONNECTIONS_KEY = "/api/connections";

export function useConnections() {
  // Composio OAuth path lands the operator on Composio's static
  // "Successfully connected" page and never redirects back. Even with
  // the new popup-window flow + server-side sync-pending poll, the
  // main tab needs a kick to revalidate. Enable revalidateOnFocus so
  // any tab focus (or popup-close → return to main) refreshes the
  // connections list and the badges flip without operator action.
  const { data, isLoading, mutate } = useSWR<{ connections: ConnectionRow[] }>(
    CONNECTIONS_KEY,
    jsonFetcher,
    { revalidateOnFocus: true, refreshInterval: 10_000 },
  );

  // Stable reference so dependent useCallback hooks don't re-create on every
  // render when SWR returns the same data shape.
  const connections = useMemo(() => data?.connections ?? [], [data?.connections]);
  const loaded = !isLoading;

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  const disconnect = useCallback(
    async (providerConfigKey: string) => {
      await fetch(
        `${CONNECTIONS_KEY}/${encodeURIComponent(providerConfigKey)}`,
        { method: "DELETE" },
      );
      await mutate(
        (prev) => ({
          connections: (prev?.connections ?? []).filter(
            (c) => c.provider_config_key !== providerConfigKey,
          ),
        }),
        { revalidate: true },
      );
    },
    [mutate],
  );

  const byIntegrationId = useCallback(
    (integrationId: string): ConnectionRow | undefined => {
      const key = providerConfigKeyFor(integrationId);
      if (!key) return undefined;
      return connections.find((c) => c.provider_config_key === key);
    },
    [connections],
  );

  const isConnected = useCallback(
    (integrationId: string): boolean => !!byIntegrationId(integrationId),
    [byIntegrationId],
  );

  return {
    connections,
    loaded,
    loading: isLoading,
    refresh,
    disconnect,
    byIntegrationId,
    isConnected,
  };
}
