import { notFound, redirect } from "next/navigation";

import { getOrgContext } from "@/lib/auth/admin";
import { isDepartmentAllowed } from "@/lib/auth/dept-acl";
import { supabaseAdmin } from "@/lib/supabase/server";
import { listConnectionsForOrg } from "@/lib/connections/queries";
import { SKILLS_CATALOG } from "@/lib/skills/catalog";
import { AgentPanelClient } from "./AgentPanelClient";

export default async function AgentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  // chat is the default landing tab. Skip the chat-history preload when
  // the URL deep-links to another tab so we don't burn a supabase
  // round-trip + ship 50 messages of payload that the user never sees.
  const tabIsChat = !sp.tab || sp.tab === "chat";

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

  // ACL: marketing-only invitee that types /agents/<sales-agent-id>
  // sees a 404 instead of leaking the agent. Admins + unrestricted
  // members pass through.
  if (ctx.userId) {
    const dept = (agent as { department: string | null }).department;
    const allowed = await isDepartmentAllowed(
      {
        userId: ctx.userId,
        organizationId: orgId,
        isAdmin: ctx.isAdmin,
      },
      dept,
    );
    if (!allowed) notFound();
  }

  // Independent queries fan out together. Memory, assigned routines,
  // telegram, files, skills, direct reports, and chat (if needed) all
  // gate on agent existence above but not on each other - serializing
  // them just inflates TTFB. Parent-agent fetch + run enrichment depend
  // on the routines payload so they stay sequential after this batch.
  const reportsToId = (agent as { reports_to: string | null }).reports_to;
  const [
    { data: memory },
    { data: assignedRoutines },
    { data: telegram },
    { data: files },
    { data: skillRows },
    { data: directReportsRaw },
    { data: parent },
    { data: chatRows },
    orgConnections,
  ] = await Promise.all([
    db
      .from("rgaios_audit_log")
      .select("id, ts, kind, actor_type, actor_id, detail")
      .eq("organization_id", orgId)
      .filter("detail->>agent_id", "eq", id)
      .order("ts", { ascending: false })
      .limit(20),
    db
      .from("rgaios_routines")
      .select("id, title, status")
      .eq("organization_id", orgId)
      .eq("assignee_agent_id", id),
    db
      .from("rgaios_connections")
      .select("status, display_name, metadata")
      .eq("organization_id", orgId)
      .eq("agent_id", id)
      .eq("provider_config_key", "telegram")
      .maybeSingle(),
    db
      .from("rgaios_agent_files")
      .select("id, filename, mime_type, size_bytes, uploaded_at")
      .eq("organization_id", orgId)
      .eq("agent_id", id)
      .order("uploaded_at", { ascending: false })
      .limit(100),
    db
      .from("rgaios_agent_skills")
      .select("skill_id")
      .eq("organization_id", orgId)
      .eq("agent_id", id),
    db
      .from("rgaios_agents")
      .select("id, name, role, department")
      .eq("organization_id", orgId)
      .eq("reports_to", id)
      .order("name", { ascending: true }),
    reportsToId
      ? db
          .from("rgaios_agents")
          .select("id, name, role")
          .eq("id", reportsToId)
          .eq("organization_id", orgId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    tabIsChat
      ? db
          .from("rgaios_agent_chat_messages")
          .select("role, content")
          .eq("organization_id", orgId)
          .eq("agent_id", id)
          .or("metadata->>archived.is.null,metadata->>archived.eq.false")
          .order("created_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [] as Array<{ role: string; content: string }> }),
    listConnectionsForOrg(orgId),
  ]);

  const routineIds =
    (assignedRoutines ?? []).map((r) => (r as { id: string }).id) ?? [];
  const titleById = new Map<string, string>();
  for (const r of (assignedRoutines ?? []) as Array<{ id: string; title: string }>) {
    titleById.set(r.id, r.title);
  }
  const { data: runs } = await db
    .from("rgaios_routine_runs")
    .select("id, status, source, started_at, completed_at, error, routine_id")
    .eq("organization_id", orgId)
    .in("routine_id", routineIds.length > 0 ? routineIds : ["00000000-0000-0000-0000-000000000000"])
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(50);
  // Tag each run with its routine title; surface unfired routines as
  // synthetic placeholder rows so the panel renders something.
  const taggedRuns = (runs ?? []).map((r) => ({
    ...(r as Record<string, unknown>),
    routine_title: titleById.get((r as { routine_id: string }).routine_id) ?? null,
  }));
  const fired = new Set(taggedRuns.map((r) => (r as { routine_id: string }).routine_id));
  const placeholders = (assignedRoutines ?? [])
    .filter((r) => !fired.has((r as { id: string }).id))
    .map((r) => ({
      id: `pending-${(r as { id: string }).id}`,
      status: "pending",
      source: "schedule",
      started_at: null,
      completed_at: null,
      error: null,
      routine_id: (r as { id: string }).id,
      routine_title: (r as { title: string }).title,
    }));
  const tasks = [...taggedRuns, ...placeholders];

  const skills = (skillRows ?? [])
    .map((r) => SKILLS_CATALOG.find((s) => s.id === (r as { skill_id: string }).skill_id))
    .filter((s): s is (typeof SKILLS_CATALOG)[number] => !!s)
    .map((s) => ({ id: s.id, name: s.name, category: s.category, tagline: s.tagline }));

  const directReports = (directReportsRaw ?? []).map((r) => ({
    id: (r as { id: string }).id,
    name: (r as { name: string }).name,
    role: (r as { role: string }).role,
    department: (r as { department: string | null }).department,
  }));

  const reportsToAgent: { id: string; name: string; role: string } | null = parent
    ? {
        id: (parent as { id: string }).id,
        name: (parent as { name: string }).name,
        role: (parent as { role: string }).role,
      }
    : null;

  const initialChatMessages = (chatRows ?? [])
    .map((r) => r as { role: string; content: string })
    .reverse();
  const connectors = orgConnections
    .filter((c) => c.status === "connected")
    .map((c) => ({
      providerConfigKey: c.provider_config_key,
      displayName: c.display_name ?? c.provider_config_key,
    }));

  return (
    <AgentPanelClient
      agent={agent as unknown as Parameters<typeof AgentPanelClient>[0]["agent"]}
      memory={memory ?? []}
      tasks={tasks ?? []}
      telegram={
        (telegram as unknown as Parameters<typeof AgentPanelClient>[0]["telegram"]) ?? null
      }
      files={files ?? []}
      skills={skills}
      directReports={directReports}
      reportsToAgent={reportsToAgent}
      connectors={connectors}
      initialChatMessages={initialChatMessages}
    />
  );
}
