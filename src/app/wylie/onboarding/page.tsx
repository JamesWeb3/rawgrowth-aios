import { Users } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { assertClientAccess } from "@/clients/guard";

export const metadata = { title: "Onboarding — Wylie Hawkins X-Ray" };

export default async function WylieOnboardingPage() {
  await assertClientAccess("/wylie/onboarding");
  return (
    <PageShell
      title="Onboarding"
      description="4-week new-hire track with manager sign-off gating dialer access."
    >
      <EmptyState
        icon={Users}
        title="Onboarding flow coming soon"
        description="Graduation gates block dialer access until week 4. Manager sign-off required at each stage."
      />
    </PageShell>
  );
}
