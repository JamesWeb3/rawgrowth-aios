import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { ProvisioningClient } from "./Client";

export const dynamic = "force-dynamic";

export default async function AdminProvisioningPage() {
  const ctx = await getOrgContext();
  if (!ctx?.isAdmin) redirect("/auth/signin");

  const { data: queue } = await supabaseAdmin()
    .from("rgaios_provisioning_queue")
    .select(
      "id, owner_email, owner_name, plan_name, status, vps_url, dashboard_url, error, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <PageShell
      title="Provisioning"
      description="New buyer queue. Each row spins a VPS, seeds the org, sends the welcome email. Manual override for urgent buyers."
    >
      <ProvisioningClient initial={queue ?? []} />
    </PageShell>
  );
}
