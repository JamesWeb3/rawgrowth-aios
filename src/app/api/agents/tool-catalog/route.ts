import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { listTools } from "@/lib/mcp/registry";
import { listConnectionsForOrg } from "@/lib/connections/queries";
import { providerConfigKeyFor } from "@/lib/connections/providers";
import { getIntegration } from "@/lib/integrations-catalog";

// Force tool registration on cold start.
import "@/lib/mcp/tools";

export const runtime = "nodejs";

type WorkspaceTool = {
  name: string;
  description: string;
  isWrite: boolean;
};

type IntegrationEntry = {
  id: string;
  name: string;
  connected: boolean;
  hasWriteTools: boolean;
  toolCount: number;
};

type Response = {
  integrations: IntegrationEntry[];
  workspace: WorkspaceTool[];
};

export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allTools = listTools({ organizationId: ctx.activeOrgId });
  const connections = await listConnectionsForOrg(ctx.activeOrgId);
  const connectedKeys = new Set(
    connections
      .filter((c) => c.status === "connected")
      .map((c) => c.provider_config_key),
  );

  const byIntegration = new Map<
    string,
    { count: number; hasWrite: boolean }
  >();
  const workspace: WorkspaceTool[] = [];

  for (const t of allTools) {
    if (t.requiresIntegration) {
      const prev = byIntegration.get(t.requiresIntegration) ?? {
        count: 0,
        hasWrite: false,
      };
      prev.count += 1;
      if (t.isWrite) prev.hasWrite = true;
      byIntegration.set(t.requiresIntegration, prev);
    } else {
      workspace.push({
        name: t.name,
        description: t.description,
        isWrite: Boolean(t.isWrite),
      });
    }
  }

  const integrations: IntegrationEntry[] = [];
  for (const [integrationId, stats] of byIntegration) {
    const catalog = getIntegration(integrationId);
    const providerKey = providerConfigKeyFor(integrationId);
    integrations.push({
      id: integrationId,
      name: catalog?.name ?? integrationId,
      connected: providerKey ? connectedKeys.has(providerKey) : false,
      hasWriteTools: stats.hasWrite,
      toolCount: stats.count,
    });
  }

  integrations.sort((a, b) => {
    if (a.connected !== b.connected) return a.connected ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const payload: Response = { integrations, workspace };
  return NextResponse.json(payload);
}
