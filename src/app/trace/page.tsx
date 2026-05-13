import { redirect } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { TraceClient } from "./TraceClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Trace - Rawgrowth",
};

export default async function TracePage() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");

  // Seed agent dropdown server-side so the chip is populated on first paint.
  const { data: agents } = await supabaseAdmin()
    .from("rgaios_agents")
    .select("id, name")
    .eq("organization_id", ctx.activeOrgId)
    .order("name", { ascending: true });

  const agentOptions = ((agents ?? []) as Array<{ id: string; name: string }>).map(
    (a) => ({ id: a.id, name: a.name }),
  );

  return (
    <PageShell
      title="Trace"
      description="Unified orchestration timeline: every routine, audit row, and approval as one stream."
    >
      <TraceClient agents={agentOptions} />
    </PageShell>
  );
}
