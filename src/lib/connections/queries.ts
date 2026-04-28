import { supabaseAdmin } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type ConnectionRow =
  Database["public"]["Tables"]["rgaios_connections"]["Row"];

/**
 * Every query is scoped by organization_id  -  caller must pass it.
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
  agentId?: string | null;
}): Promise<ConnectionRow> {
  const db = supabaseAdmin();
  const agentId = input.agentId ?? null;
  const row = {
    organization_id: input.organizationId,
    provider_config_key: input.providerConfigKey,
    nango_connection_id: input.nangoConnectionId,
    display_name: input.displayName ?? null,
    status: "connected",
    metadata: input.metadata ?? {},
    agent_id: agentId,
  };

  // Migration 0024 dropped the original (org, provider) unique and
  // replaced it with a COALESCE-based partial that supabase-js .upsert
  // can't target. Migration 0032 added a plain (org, agent_id, provider)
  // unique that DOES work for non-null agent_id rows. NULL agent_id rows
  // (org-wide integrations like Claude Max, Gmail, org-level Slack)
  // can't use ON CONFLICT because Postgres treats NULLs as distinct, so
  // we do a select-then-update-or-insert for those.
  if (agentId !== null) {
    const { data, error } = await db
      .from("rgaios_connections")
      .upsert(row, {
        onConflict: "organization_id,agent_id,provider_config_key",
      })
      .select("*")
      .single();
    if (error) throw new Error(`upsertConnection: ${error.message}`);
    return data;
  }

  // Org-wide path: lookup-then-update-or-insert, scoped to NULL agent_id.
  const existing = await db
    .from("rgaios_connections")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("provider_config_key", input.providerConfigKey)
    .is("agent_id", null)
    .maybeSingle();
  if (existing.error) throw new Error(`upsertConnection: ${existing.error.message}`);

  if (existing.data) {
    const { data, error } = await db
      .from("rgaios_connections")
      .update(row)
      .eq("id", existing.data.id)
      .select("*")
      .single();
    if (error) throw new Error(`upsertConnection: ${error.message}`);
    return data;
  }

  const { data, error } = await db
    .from("rgaios_connections")
    .insert(row)
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
