import { Settings2 } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

export const metadata = { title: "General — Rawgrowth" };

export default function GeneralPage() {
  return (
    <EmptyState
      icon={Settings2}
      title="General settings coming soon"
      description="Company name, mission, branding, and defaults will live here."
    />
  );
}
