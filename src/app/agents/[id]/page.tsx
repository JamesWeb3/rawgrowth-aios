import { notFound, redirect } from "next/navigation";

import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { AgentPanelClient } from "./AgentPanelClient";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");
  const orgId = ctx.activeOrgId;
  const db = supabaseAdmin();

  const { data: agent } = await db
    .from("rgaios_agents")
    .select("*")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!agent) notFound();

  // Memory: last 20 entries from audit_log keyed by detail->>'agent_id'.
  const { data: memory } = await db
    .from("rgaios_audit_log")
    .select("id, ts, kind, actor_type, actor_id, detail")
    .eq("organization_id", orgId)
    .filter("detail->>agent_id", "eq", id)
    .order("ts", { ascending: false })
    .limit(20);

  // Tasks: last 50 routine runs whose routine assigned this agent.
  const { data: tasks } = await db
    .from("rgaios_routine_runs")
    .select("id, status, source, started_at, completed_at, error, routine_id")
    .eq("organization_id", orgId)
    .in("routine_id", (
      await db
        .from("rgaios_routines")
        .select("id")
        .eq("organization_id", orgId)
        .eq("assignee_agent_id", id)
    ).data?.map((r) => (r as { id: string }).id) ?? [])
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(50);

  // Telegram connection status for this agent.
  const { data: telegram } = await db
    .from("rgaios_connections")
    .select("status, display_name, metadata")
    .eq("organization_id", orgId)
    .eq("agent_id", id)
    .eq("provider_config_key", "telegram")
    .maybeSingle();

  // Files attached to this agent (brief §7 per-agent panel).
  const { data: files } = await db
    .from("rgaios_agent_files")
    .select("id, filename, mime_type, size_bytes, uploaded_at")
    .eq("organization_id", orgId)
    .eq("agent_id", id)
    .order("uploaded_at", { ascending: false })
    .limit(100);

  return (
    <AgentPanelClient
      agent={agent as unknown as Parameters<typeof AgentPanelClient>[0]["agent"]}
      memory={memory ?? []}
      tasks={tasks ?? []}
      telegram={
        (telegram as unknown as Parameters<typeof AgentPanelClient>[0]["telegram"]) ?? null
      }
      files={files ?? []}
    />
  );
}
