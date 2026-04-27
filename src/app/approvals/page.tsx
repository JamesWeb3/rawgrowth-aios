import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/auth/admin";
import { PageShell } from "@/components/page-shell";
import { ApprovalsView } from "@/components/approvals/approvals-view";

export const metadata = {
  title: "Approvals  -  Rawgrowth",
};

export default async function ApprovalsPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/auth/signin");

  return (
    <PageShell
      title="Approvals"
      description="Human-in-the-loop decisions. Review what your agents want to do, then approve or reject."
    >
      <ApprovalsView />
    </PageShell>
  );
}
