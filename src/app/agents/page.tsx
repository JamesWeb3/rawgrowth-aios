import { PageShell } from "@/components/page-shell";
import { OrgChart } from "@/components/org-chart";

export default function AgentsPage() {
  return (
    <PageShell
      title="Agents"
      description="Your AI employees, arranged as an org chart. Select an agent to inspect or edit."
    >
      <OrgChart />
    </PageShell>
  );
}
