import { PageShell } from "@/components/page-shell";
import { KnowledgeView } from "@/components/knowledge-view";
import { listAgentsForOrg } from "@/lib/agents/queries";
import { currentOrganizationId } from "@/lib/supabase/constants";

export const metadata = {
  title: "Knowledge — Rawgrowth",
};

export default async function KnowledgePage() {
  // Pulled server-side so the per-agent filter dropdown (brief §7) has its
  // option set ready on first paint. Failure is non-fatal — the view falls
  // back to "All / Unassigned" only.
  let agents: { id: string; name: string }[] = [];
  try {
    const orgId = await currentOrganizationId();
    const list = await listAgentsForOrg(orgId);
    agents = list.map((a) => ({ id: a.id, name: a.name }));
  } catch {
    agents = [];
  }

  return (
    <PageShell
      title="Knowledge"
      description="Markdown playbooks, SOPs, and brand docs. Tag them so your agents can pull the right context at runtime."
    >
      <KnowledgeView agents={agents} />
    </PageShell>
  );
}
