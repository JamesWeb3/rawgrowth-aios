import { PageShell } from "@/components/page-shell";
import { ActivityView } from "@/components/activity-view";

export const metadata = {
  title: "Activity — Rawgrowth",
};

export default function ActivityPage() {
  return (
    <PageShell
      title="Activity"
      description="Every routine run — live. Click any row to see the full chain of tool calls, inputs, and outputs."
    >
      <ActivityView />
    </PageShell>
  );
}
