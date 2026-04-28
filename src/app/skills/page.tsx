import { PageShell } from "@/components/page-shell";
import { SkillsMarketplaceView } from "@/components/skills/skills-marketplace-view";

export const metadata = { title: "Skills  -  Rawgrowth" };

export default function SkillsPage() {
  return (
    <PageShell
      title="Skills marketplace"
      description="Curated RawClaw capabilities your agents can draw on. Pick the skills that fit your team, assign them to the agents who need them, and install with one command in Claude Code."
    >
      <SkillsMarketplaceView />
    </PageShell>
  );
}
