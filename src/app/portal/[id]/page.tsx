import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";
import { PortalStatusClient, type QueueStatus } from "./PortalStatusClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /portal/[id]
 *
 * Lightweight buyer-facing status page for the auto-deploy scaffold
 * (P2 #9, plan wiggly-hugging-sutherland §9). The id is the queue row
 * id, treated as a share-link secret - whoever has it sees the status.
 *
 * Server-renders the initial state, then PortalStatusClient polls the
 * /api/provisioning/status/[id] route every 5s while status is not
 * 'ready'. Once ready, we link the buyer to /auth/signin on their VPS.
 */
export default async function PortalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!id || !/^[0-9a-f-]{32,40}$/i.test(id)) {
    notFound();
  }

  const { data: row } = await supabaseAdmin()
    .from("rgaios_provisioning_queue")
    .select("id, status, dashboard_url, error, plan_name, owner_name")
    .eq("id", id)
    .maybeSingle();

  if (!row) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-xl">
        <header className="mb-10">
          <p className="text-xs uppercase tracking-widest text-white/40">
            Raw Claw
          </p>
          <h1 className="mt-2 text-3xl font-semibold">
            {row.owner_name
              ? `Welcome, ${row.owner_name}.`
              : "Welcome."}
          </h1>
          {row.plan_name ? (
            <p className="mt-1 text-sm text-white/60">{row.plan_name}</p>
          ) : null}
        </header>

        <PortalStatusClient
          id={row.id}
          initialStatus={row.status as QueueStatus}
          initialDashboardUrl={row.dashboard_url}
          initialError={row.error}
        />

        <footer className="mt-12 text-xs text-white/40">
          Bookmark this page. We will email the same link once the
          dashboard is ready.
        </footer>
      </div>
    </main>
  );
}
