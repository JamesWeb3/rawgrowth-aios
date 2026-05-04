import { redirect } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { getOrgContext } from "@/lib/auth/admin";
import { listAgentsForOrg } from "@/lib/agents/queries";
import {
  filterAgentsByDept,
  getAllowedDepartments,
} from "@/lib/auth/dept-acl";
import { ChatPicker } from "./ChatPicker";

export const dynamic = "force-dynamic";

export default async function ChatHubPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string }>;
}) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId || !ctx.userId) redirect("/auth/signin");

  const agents = await listAgentsForOrg(ctx.activeOrgId);
  const allowed = await getAllowedDepartments({
    userId: ctx.userId,
    organizationId: ctx.activeOrgId,
    isAdmin: ctx.isAdmin,
  });
  const scoped = filterAgentsByDept(agents, allowed);
  const params = await searchParams;

  // Default to Atlas (CEO) so the user lands on the coordinator who
  // can route to others. Falls back to the first agent if no CEO
  // exists.
  const defaultAgent =
    scoped.find((a) => a.role === "ceo") ?? scoped[0] ?? null;
  const initialAgentId = params.agent ?? defaultAgent?.id ?? null;

  return (
    <PageShell
      title="Chat"
      description="Talk to any agent. Atlas coordinates - tell it what you want and it can delegate to the right department head."
    >
      <ChatPicker
        agents={scoped.map((a) => ({
          id: a.id,
          name: a.name,
          role: a.role,
          title: a.title,
          department: a.department,
          isDepartmentHead: a.isDepartmentHead ?? false,
        }))}
        initialAgentId={initialAgentId}
      />
    </PageShell>
  );
}
