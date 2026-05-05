import { PageShell } from "@/components/page-shell";
import { RoutinesView } from "@/components/routines-view";

export default function RoutinesPage() {
  return (
    <PageShell
      title="Routines"
      description="Automated workflows. A trigger fires, an agent runs the playbook. Schedules, webhooks, and integration events all supported."
    >
      <RoutinesView />
    </PageShell>
  );
}
