import { redirect } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { AgentSheet } from "@/components/agent-sheet";
import { AgentsByDeptView } from "@/components/agents-by-dept-view";
import { getOrgContext } from "@/lib/auth/admin";
import { listAgentsForOrg } from "@/lib/agents/queries";
import {
  getAllowedDepartments,
  filterAgentsByDept,
} from "@/lib/auth/dept-acl";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId || !ctx.userId) redirect("/auth/signin");
  const agents = await listAgentsForOrg(ctx.activeOrgId);
  // Same ACL the /api/agents endpoint applies. Without this server-side
  // pass a marketing-only invitee would see every agent listed on the
  // /agents page even though /api/agents (used by SWR elsewhere)
  // already filters them out.
  const allowed = await getAllowedDepartments({
    userId: ctx.userId,
    organizationId: ctx.activeOrgId,
    isAdmin: ctx.isAdmin,
  });
  const scoped = filterAgentsByDept(agents, allowed);

  return (
    <PageShell
      title="Agents"
      description="Your AI employees, grouped by department. Atlas runs the show. Press Hire to add anyone underneath."
      actions={<AgentSheet triggerLabel="+ Hire agent" triggerSize="sm" />}
    >
      <AgentsByDeptView agents={scoped} />
    </PageShell>
  );
}
