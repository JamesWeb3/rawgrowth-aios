import { supabaseAdmin } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type ConnectionRow =
  Database["public"]["Tables"]["rgaios_connections"]["Row"];

/**
 * Every query is scoped by organization_id — caller must pass it.
 * Callers currently use DEFAULT_ORGANIZATION_ID from supabase/constants
 * until auth is wired.
 */

export async function listConnectionsForOrg(
  organizationId: string,
): Promise<ConnectionRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("rgaios_connections")
    .select("*")
    .eq("organization_id", organizationId)
    .order("connected_at", { ascending: false });
  if (error) throw new Error(`listConnections: ${error.message}`);
  return data ?? [];
}

export async function getConnection(
  organizationId: string,
  providerConfigKey: string,
): Promise<ConnectionRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("rgaios_connections")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("provider_config_key", providerConfigKey)
    .maybeSingle();
  if (error) throw new Error(`getConnection: ${error.message}`);
  return data;
}

export async function upsertConnection(input: {
  organizationId: string;
  providerConfigKey: string;
  nangoConnectionId: string;
  displayName?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<ConnectionRow> {
  const { data, error } = await supabaseAdmin()
    .from("rgaios_connections")
    .upsert(
      {
        organization_id: input.organizationId,
        provider_config_key: input.providerConfigKey,
        nango_connection_id: input.nangoConnectionId,
        display_name: input.displayName ?? null,
        status: "connected",
        metadata: input.metadata ?? {},
      },
      { onConflict: "organization_id,provider_config_key" },
    )
    .select("*")
    .single();
  if (error) throw new Error(`upsertConnection: ${error.message}`);
  return data;
}

export async function deleteConnection(
  organizationId: string,
  providerConfigKey: string,
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("rgaios_connections")
    .delete()
    .eq("organization_id", organizationId)
    .eq("provider_config_key", providerConfigKey);
  if (error) throw new Error(`deleteConnection: ${error.message}`);
}
