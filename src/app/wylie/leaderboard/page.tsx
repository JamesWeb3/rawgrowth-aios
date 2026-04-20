import { Trophy } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { assertClientAccess } from "@/clients/guard";

export const metadata = { title: "Leaderboard — Wylie Hawkins X-Ray" };

export default async function WylieLeaderboardPage() {
  await assertClientAccess("/wylie/leaderboard");
  return (
    <PageShell
      title="Leaderboard"
      description="Live monthly issued-premium rankings across all three offices."
    >
      <EmptyState
        icon={Trophy}
        title="Leaderboard coming online"
        description="Agents, offices, and policies tables ship in the next migration. Once the carrier CSV import runs, this board goes live."
      />
    </PageShell>
  );
}
