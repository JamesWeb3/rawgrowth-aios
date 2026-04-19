import { Sparkles } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

export const metadata = { title: "Skills — Rawgrowth" };

export default function SkillsPage() {
  return (
    <EmptyState
      icon={Sparkles}
      title="Skills coming soon"
      description="Reusable capabilities your agents can draw on — prompt presets, playbooks, and task templates."
    />
  );
}
