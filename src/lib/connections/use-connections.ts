"use client";

import { useCallback, useEffect, useState } from "react";
import { providerConfigKeyFor } from "@/lib/nango/providers";

export type ConnectionRow = {
  id: string;
  organization_id: string;
  provider_config_key: string;
  nango_connection_id: string;
  display_name: string | null;
  status: "connected" | "error" | "disconnected";
  metadata: Record<string, unknown>;
  connected_at: string;
  updated_at: string;
};

/**
 * Source-of-truth client hook for integration connections.
 * Reads from /api/connections, exposes refresh + disconnect helpers,
 * and a helper `isConnected(integrationId)` for components that think
 * in product-catalog ids.
 */
export function useConnections() {
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/connections");
      const body = (await res.json()) as { connections?: ConnectionRow[] };
      setConnections(body.connections ?? []);
    } finally {
      setLoaded(true);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const disconnect = useCallback(
    async (providerConfigKey: string) => {
      await fetch(
        `/api/connections/${encodeURIComponent(providerConfigKey)}`,
        { method: "DELETE" },
      );
      await refresh();
    },
    [refresh],
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
    loading,
    refresh,
    disconnect,
    byIntegrationId,
    isConnected,
  };
}
