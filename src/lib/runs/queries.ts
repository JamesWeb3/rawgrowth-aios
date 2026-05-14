import { supabaseAdmin } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type RunRow = Database["public"]["Tables"]["rgaios_routine_runs"]["Row"];
type RoutineRow = Database["public"]["Tables"]["rgaios_routines"]["Row"];
type TriggerRow =
  Database["public"]["Tables"]["rgaios_routine_triggers"]["Row"];
type AgentRow = Database["public"]["Tables"]["rgaios_agents"]["Row"];

/** All the context the executor needs for a single run. */
export type RunContext = {
  run: RunRow;
  routine: RoutineRow;
  trigger: TriggerRow | null;
  agent: AgentRow | null;
};

/**
 * Atomically claim a pending run for execution. Uses an UPDATE-with-WHERE
 * so two concurrent workers can't both pick up the same run.
 *
 * Every query here is scoped by `organizationId` as well as the row id:
 * the service-role client bypasses RLS, so a runId (or its routine /
 * trigger ids) from another tenant must not be claimable, readable, or
 * able to stamp last_run_at on a foreign routine. An org mismatch falls
 * through to the same `null` return as a lost claim race.
 */
export async function claimRun(
  runId: string,
  orgId: string,
): Promise<RunContext | null> {
  const db = supabaseAdmin();
  const { data: run, error } = await db
    .from("rgaios_routine_runs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("organization_id", orgId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`claimRun: ${error.message}`);
  if (!run) return null; // already claimed, gone, or wrong org

  // Routine + trigger are independent of each other; fire them in
  // parallel. Agent depends on routine.assignee_agent_id so it's the
  // only one that has to wait for routine.
  const [routineRes, triggerRes] = await Promise.all([
    db
      .from("rgaios_routines")
      .select("*")
      .eq("id", run.routine_id)
      .eq("organization_id", orgId)
      .single(),
    run.trigger_id
      ? db
          .from("rgaios_routine_triggers")
          .select("*")
          .eq("id", run.trigger_id)
          .eq("organization_id", orgId)
          .maybeSingle()
      : Promise.resolve({ data: null as TriggerRow | null }),
  ]);
  const { data: routine, error: rErr } = routineRes;
  if (rErr || !routine) throw new Error(`claimRun routine: ${rErr?.message}`);
  const trigger: TriggerRow | null = triggerRes.data;

  // why: "Last run" must reflect when a run actually executed, not just
  // when it was queued. Schedule-tick / manual-run / telegram each bump
  // last_run_at at dispatch time, but a run created any other way (MCP
  // routines_*, future trigger kinds) would leave the routine showing
  // "Never" forever even after it ran. Stamping it here - the single
  // chokepoint every in-process execution passes through - makes the
  // field correct regardless of which path queued the run.
  await db
    .from("rgaios_routines")
    .update({ last_run_at: new Date().toISOString() })
    .eq("id", run.routine_id)
    .eq("organization_id", orgId);

  let agent: AgentRow | null = null;
  if (routine.assignee_agent_id) {
    const { data } = await db
      .from("rgaios_agents")
      .select("*")
      .eq("id", routine.assignee_agent_id)
      .maybeSingle();
    agent = data;
  }

  return { run, routine, trigger, agent };
}

export async function finaliseRun(
  runId: string,
  status: "succeeded" | "failed",
  output: Record<string, unknown> | null,
  error?: string,
): Promise<void> {
  const db = supabaseAdmin();
  const { error: updErr } = await db
    .from("rgaios_routine_runs")
    .update({
      status,
      output,
      error: error ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);
  if (updErr) throw new Error(`finaliseRun: ${updErr.message}`);
}

export async function getRun(runId: string): Promise<RunRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("rgaios_routine_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new Error(`getRun: ${error.message}`);
  return data;
}
