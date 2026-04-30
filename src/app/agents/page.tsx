import { PageShell } from "@/components/page-shell";
import { OrgChart } from "@/components/org-chart";
import { AgentSheet } from "@/components/agent-sheet";

export default function AgentsPage() {
  return (
    <PageShell
      title="Agents"
      description="Your AI employees, arranged as an org chart. Atlas runs the show; press Hire to add anyone underneath."
      actions={<AgentSheet triggerLabel="+ Hire agent" triggerSize="sm" />}
    >
      <OrgChart />
    </PageShell>
  );
}
