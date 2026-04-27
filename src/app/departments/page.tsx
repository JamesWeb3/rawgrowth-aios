import { PageShell } from "@/components/page-shell";
import { DepartmentsView } from "@/components/departments/departments-view";

export const metadata = {
  title: "Departments  -  Rawgrowth",
};

export default function DepartmentsPage() {
  return (
    <PageShell
      title="Departments"
      description="Organize your agents by business pillar. Use the seeded departments  -  Marketing, Sales, Fulfilment, Finance, Development  -  or spin up your own from Add department. Every agent can stay unassigned."
    >
      <DepartmentsView />
    </PageShell>
  );
}
