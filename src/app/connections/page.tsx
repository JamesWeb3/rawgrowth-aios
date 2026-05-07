import { PageShell } from "@/components/page-shell";
import { ConnectionsView } from "@/components/connections-view";

export const metadata = {
  title: "Connections - Rawgrowth",
};

export default function ConnectionsPage() {
  return (
    <PageShell
      title="Connections"
      description="Claude Max, messaging channels, and analytics sources. Every external link this workspace owns."
    >
      <ConnectionsView />
    </PageShell>
  );
}
