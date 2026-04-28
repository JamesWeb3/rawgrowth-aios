import { redirect } from "next/navigation";

import { getOrgContext } from "@/lib/auth/admin";
import { listAgentsForOrg } from "@/lib/agents/queries";
import { supabaseAdmin } from "@/lib/supabase/server";
import { AgentTreeClient } from "./AgentTreeClient";

export default async function AgentTreePage() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");

  const [agents, { data: telegramConnections }] = await Promise.all([
    listAgentsForOrg(ctx.activeOrgId),
    supabaseAdmin()
      .from("rgaios_connections")
      .select("agent_id, status")
      .eq("organization_id", ctx.activeOrgId)
      .eq("provider_config_key", "telegram"),
  ]);

  const telegramByAgent = new Map<string, string>();
  for (const row of (telegramConnections ?? []) as Array<{
    agent_id: string | null;
    status: string;
  }>) {
    if (row.agent_id) telegramByAgent.set(row.agent_id, row.status);
  }

  const nodes = agents.map((a) => ({
    id: a.id,
    name: a.name,
    title: a.title,
    role: a.role,
    department: a.department ?? null,
    reportsTo: a.reportsTo ?? null,
    telegramStatus: telegramByAgent.get(a.id) ?? null,
  }));

  return (
    <div className="flex h-screen flex-col bg-[var(--brand-bg)]">
      <header className="shrink-0 border-b border-[var(--line)] px-6 py-5">
        <h1 className="font-serif text-3xl font-normal tracking-tight text-foreground">
          Agent tree
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your org chart. Use the + sub-agent button on any node to add a report.
        </p>
      </header>
      <div className="min-h-0 flex-1">
        <AgentTreeClient initialNodes={nodes} />
      </div>
    </div>
  );
}
