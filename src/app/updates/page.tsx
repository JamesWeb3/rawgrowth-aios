import { redirect } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { getOrgContext } from "@/lib/auth/admin";
import { UpdatesView } from "./Client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Updates - Rawgrowth",
};

export default async function UpdatesPage() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");

  return (
    <PageShell
      title="Updates"
      description="Everything your agents are doing right now, plus the questions they need YOU to answer. One feed - no chasing."
    >
      <UpdatesView />
    </PageShell>
  );
}
