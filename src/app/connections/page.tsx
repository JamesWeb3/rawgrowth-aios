import { PageShell } from "@/components/page-shell";
import { ConnectionsView } from "@/components/connections-view";

export const metadata = {
  title: "Connections  -  Rawgrowth",
};

export default function ConnectionsPage() {
  return (
    <PageShell
      title="Connections"
      description="Your Claude Max, the Rawgrowth MCP, messaging channels, and analytics sources  -  all the external links this workspace owns."
    >
      <ConnectionsView />
    </PageShell>
  );
}
