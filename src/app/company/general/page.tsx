import { Settings2 } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { CompanyGeneralView } from "@/components/company/general-view";
import { getOrgOverview } from "@/lib/organizations/overview";
import { DEPLOY_MODE } from "@/lib/deploy-mode";

export const metadata = { title: "General — Rawgrowth" };

export default async function GeneralPage() {
  const org = await getOrgOverview();
  if (!org) {
    return (
      <EmptyState
        icon={Settings2}
        title="No organization yet"
        description="Sign in and provision an org to see its details here."
      />
    );
  }

  const domain = (process.env.NEXTAUTH_URL ?? "http://localhost")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");

  return <CompanyGeneralView org={org} domain={domain} deployMode={DEPLOY_MODE} />;
}
