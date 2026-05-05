import { Bot } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { CompanyAutonomousView } from "@/components/company/autonomous-view";
import { getOrgContext } from "@/lib/auth/admin";
import { getAutonomousSettings } from "@/lib/organizations/autonomous";
import { supabaseAdmin } from "@/lib/supabase/server";

export const metadata = { title: "Autonomous mode  -  Rawgrowth" };

export default async function AutonomousPage() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId || !ctx.userId) {
    return (
      <EmptyState
        icon={Bot}
        title="No organization yet"
        description="Sign in and provision an org to configure autonomous mode."
      />
    );
  }

  const settings = await getAutonomousSettings(ctx.activeOrgId);

  // Owner / admin gate (matches POST handler). Admin operator org can
  // always edit so they can drive a client demo.
  let canEdit = ctx.isAdmin;
  if (!canEdit) {
    const { data: caller } = await supabaseAdmin()
      .from("rgaios_users")
      .select("role")
      .eq("id", ctx.userId)
      .eq("organization_id", ctx.activeOrgId)
      .maybeSingle();
    const role = (caller as { role?: string } | null)?.role ?? null;
    canEdit = role === "owner" || role === "admin";
  }

  return <CompanyAutonomousView initial={settings} canEdit={canEdit} />;
}
