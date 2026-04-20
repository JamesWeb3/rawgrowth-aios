import { PageShell } from "@/components/page-shell";
import { ChannelsView } from "@/components/channels-view";

export const metadata = {
  title: "Channels — Rawgrowth",
};

export default function ChannelsPage() {
  return (
    <PageShell
      title="Channels"
      description="Messaging surfaces your agents listen on, plus analytics sources that feed the Dashboard. All other tools live in your Claude subscription."
    >
      <ChannelsView />
    </PageShell>
  );
}
