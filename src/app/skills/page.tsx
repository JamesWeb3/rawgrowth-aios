import { PageShell } from "@/components/page-shell";
import { SkillsMarketplaceView } from "@/components/skills/skills-marketplace-view";

export const metadata = { title: "Skills - Rawgrowth" };

export default function SkillsPage() {
  return (
    <PageShell
      title="Skills marketplace"
      description="Curated capabilities your agents can draw on. Pick skills, assign them to agents, install with one command."
    >
      <SkillsMarketplaceView />
    </PageShell>
  );
}
