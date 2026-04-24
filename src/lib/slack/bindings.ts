import { supabaseAdmin } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type BindingRow = Database["public"]["Tables"]["rgaios_slack_bindings"]["Row"];
type BindingInsert =
  Database["public"]["Tables"]["rgaios_slack_bindings"]["Insert"];
type BindingUpdate =
  Database["public"]["Tables"]["rgaios_slack_bindings"]["Update"];

export type SlackBinding = BindingRow;

export async function listBindingsForOrg(
  organizationId: string,
): Promise<SlackBinding[]> {
  const { data, error } = await supabaseAdmin()
    .from("rgaios_slack_bindings")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listBindings: ${error.message}`);
  return data ?? [];
}

export async function listEnabledBindingsForChannel(input: {
  teamId: string;
  channelId: string;
}): Promise<SlackBinding[]> {
  const { data, error } = await supabaseAdmin()
    .from("rgaios_slack_bindings")
    .select("*")
    .eq("slack_team_id", input.teamId)
    .eq("slack_channel_id", input.channelId)
    .eq("enabled", true);
  if (error) throw new Error(`listBindingsForChannel: ${error.message}`);
  return data ?? [];
}

export async function createBinding(
  input: BindingInsert,
): Promise<SlackBinding> {
  const { data, error } = await supabaseAdmin()
    .from("rgaios_slack_bindings")
    .insert(input)
    .select("*")
    .single();
  if (error || !data) throw new Error(`createBinding: ${error?.message}`);
  return data;
}

export async function updateBinding(
  id: string,
  organizationId: string,
  patch: BindingUpdate,
): Promise<SlackBinding> {
  const { data, error } = await supabaseAdmin()
    .from("rgaios_slack_bindings")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", organizationId)
    .select("*")
    .single();
  if (error || !data) throw new Error(`updateBinding: ${error?.message}`);
  return data;
}

export async function deleteBinding(
  id: string,
  organizationId: string,
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("rgaios_slack_bindings")
    .delete()
    .eq("id", id)
    .eq("organization_id", organizationId);
  if (error) throw new Error(`deleteBinding: ${error.message}`);
}

export async function markFired(id: string): Promise<void> {
  await supabaseAdmin()
    .from("rgaios_slack_bindings")
    .update({ last_fired_at: new Date().toISOString() })
    .eq("id", id);
}
