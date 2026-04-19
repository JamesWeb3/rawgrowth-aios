import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { currentOrganizationId } from "@/lib/supabase/constants";

export const runtime = "nodejs";

/**
 * GET /api/runs/[id]
 *
 * Returns the run + routine + agent + a full timeline of audit events
 * where detail->>run_id == this run. Ordered by timestamp ascending so
 * the UI can render the tool-call chain as it happened.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const organizationId = await currentOrganizationId();
    const db = supabaseAdmin();

    const { data: run, error: runErr } = await db
      .from("rgaios_routine_runs")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("id", id)
      .maybeSingle();
    if (runErr) throw new Error(runErr.message);
    if (!run) {
      return NextResponse.json({ error: "run not found" }, { status: 404 });
    }

    // Routine + agent (one extra round-trip each; fine at MVP scale)
    const { data: routine } = await db
      .from("rgaios_routines")
      .select("id, title, description, assignee_agent_id")
      .eq("id", run.routine_id)
      .maybeSingle();

    let agent: {
      id: string;
      name: string;
      role: string;
      title: string | null;
    } | null = null;
    if (routine?.assignee_agent_id) {
      const { data } = await db
        .from("rgaios_agents")
        .select("id, name, role, title")
        .eq("id", routine.assignee_agent_id)
        .maybeSingle();
      agent = data;
    }

    // Timeline from audit_log
    const { data: events, error: eErr } = await db
      .from("rgaios_audit_log")
      .select("*")
      .eq("organization_id", organizationId)
      .contains("detail", { run_id: id })
      .order("ts", { ascending: true });
    if (eErr) throw new Error(eErr.message);

    return NextResponse.json({
      run,
      routine,
      agent,
      events: events ?? [],
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
