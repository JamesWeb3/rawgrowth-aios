import { notFound, redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { getOrgContext } from "@/lib/auth/admin";
import { supabaseAdmin } from "@/lib/supabase/server";
import { isUuid } from "@/lib/utils";
import { TaskDetailClient } from "./TaskDetailClient";

export const dynamic = "force-dynamic";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");

  // Reject non-UUID + missing routines server-side so the URL renders
  // the proper not-found.tsx instead of the empty "Task" shell. Without
  // this guard, a stale link in the demo loaded the header + an empty
  // body which read as broken to Chris.
  if (!isUuid(id)) notFound();
  const { data: routine } = await supabaseAdmin()
    .from("rgaios_routines")
    .select("id")
    .eq("id", id)
    .eq("organization_id", ctx.activeOrgId)
    .maybeSingle();
  if (!routine) notFound();

  return (
    <PageShell title="Task" description="Routine + every run + agent output">
      <TaskDetailClient routineId={id} />
    </PageShell>
  );
}
