import { redirect } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { getOrgContext } from "@/lib/auth/admin";
import { DataEntryClient } from "./Client";

export const dynamic = "force-dynamic";

export default async function DataEntryPage() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");

  return (
    <PageShell
      title="Data entry"
      description="Paste CRM contacts, deals, notes, or anything else you want every agent to be able to search and cite. Goes straight into the company corpus."
    >
      <DataEntryClient />
    </PageShell>
  );
}
