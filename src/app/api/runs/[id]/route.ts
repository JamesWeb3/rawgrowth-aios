import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth/admin";
import { getAllowedDepartments } from "@/lib/auth/dept-acl";
import { badUuidResponse } from "@/lib/utils";

export const runtime = "nodejs";

/**
 * GET /api/runs/[id]
 *
 * Returns the run + routine + agent + a full timeline of audit events
 * where detail->>run_id == this run. Ordered by timestamp ascending so
 * the UI can render the tool-call chain as it happened.
 *
 * Per-dept ACL: invitees with allowed_departments only see a run whose
 * routine's assignee_agent.department is in their allowed set. UUIDs
 * aren't secrets - runs link out via dashboards / Slack / Telegram, so
 * org-scope alone leaks across departments. Returns 404 (not 403) so a
 * marketing invitee can't probe finance run ids by status code.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const bad = badUuidResponse(id);
    if (bad) return bad;
    const ctx = await getOrgContext();
    if (!ctx?.activeOrgId || !ctx.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const organizationId = ctx.activeOrgId;
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
      department: string | null;
    } | null = null;
    if (routine?.assignee_agent_id) {
      const { data } = await db
        .from("rgaios_agents")
        .select("id, name, role, title, department")
        .eq("id", routine.assignee_agent_id)
        .maybeSingle();
      agent = data;
    }

    // Dept-ACL gate. Resolve once. allowed=null means unrestricted.
    const allowedDepts = await getAllowedDepartments({
      userId: ctx.userId,
      organizationId,
      isAdmin: ctx.isAdmin,
    });
    if (allowedDepts !== null) {
      const dept = agent?.department ?? null;
      if (!dept || !allowedDepts.includes(dept)) {
        return NextResponse.json({ error: "run not found" }, { status: 404 });
      }
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
    // Server logs get the cause; client gets a generic 500 so we don't
    // leak supabase / pg internals through the response body.
    console.error("[runs/[id]] error:", (err as Error).message);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
