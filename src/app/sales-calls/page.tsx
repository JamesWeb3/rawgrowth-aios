import { redirect } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { getOrgContext } from "@/lib/auth/admin";
import { SalesCallsClient } from "./SalesCallsClient";

export const dynamic = "force-dynamic";

export default async function SalesCallsPage() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");

  return (
    <PageShell
      title="Sales calls"
      description="Drop call recordings or paste Loom, Fireflies, or Gong transcripts. Each gets transcribed, chunked, and added to the company corpus so every agent can reference real objections and closes."
    >
      <SalesCallsClient />
    </PageShell>
  );
}
