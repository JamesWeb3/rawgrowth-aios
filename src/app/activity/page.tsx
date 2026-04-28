import { redirect } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { ActivityView } from "@/components/activity-view";
import { LiveActivityFeed } from "@/components/activity/live-feed";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";

export const metadata = {
  title: "Activity  -  Rawgrowth",
};

export default async function ActivityPage() {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");

  // Plan §D9: Realtime feed on rgaios_audit_log replaces polling.
  // Seed with the last 50 events so the panel isn't blank pre-INSERT.
  const { data: initialRows } = await supabaseAdmin()
    .from("rgaios_audit_log")
    .select("id, ts, kind, actor_type, actor_id, detail")
    .eq("organization_id", ctx.activeOrgId)
    .order("ts", { ascending: false })
    .limit(50);

  return (
    <PageShell
      title="Activity"
      description="Every routine run, live. Open any row for the full chain of tool calls, inputs, and outputs."
    >
      <div className="space-y-6">
        <ActivityView />
        <section className="rounded-md border border-[var(--line)] bg-[var(--brand-surface)] p-4">
          <h3 className="mb-3 text-xs uppercase tracking-widest text-primary">
            Live audit log
          </h3>
          <LiveActivityFeed
            initialRows={(initialRows ?? []) as Parameters<typeof LiveActivityFeed>[0]["initialRows"]}
            organizationId={ctx.activeOrgId}
          />
        </section>
      </div>
    </PageShell>
  );
}
