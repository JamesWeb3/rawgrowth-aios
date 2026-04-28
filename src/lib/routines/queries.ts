import { supabaseAdmin } from "@/lib/supabase/server";
import { ensureDefaultOrganization } from "@/lib/supabase/ensure-org";
import {
  routineFromRows,
  triggerConfigFor,
  type Routine,
  type RoutineCreateInput,
  type RoutineUpdateInput,
} from "./dto";
import type { RoutineTrigger } from "./constants";
import type { Database } from "@/lib/supabase/types";

type TriggerRow =
  Database["public"]["Tables"]["rgaios_routine_triggers"]["Row"];
type RoutineUpdate =
  Database["public"]["Tables"]["rgaios_routines"]["Update"];

export async function listRoutinesForOrg(
  organizationId: string,
): Promise<Routine[]> {
  const db = supabaseAdmin();
  const { data: routines, error: rErr } = await db
    .from("rgaios_routines")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (rErr) throw new Error(`listRoutines: ${rErr.message}`);
  if (!routines || routines.length === 0) return [];

  const { data: triggers, error: tErr } = await db
    .from("rgaios_routine_triggers")
    .select("*")
    .eq("organization_id", organizationId)
    .in(
      "routine_id",
      routines.map((r) => r.id),
    );
  if (tErr) throw new Error(`listRoutines triggers: ${tErr.message}`);

  const byRoutine = new Map<string, TriggerRow[]>();
  for (const t of triggers ?? []) {
    if (!byRoutine.has(t.routine_id)) byRoutine.set(t.routine_id, []);
    byRoutine.get(t.routine_id)!.push(t);
  }
  return routines.map((r) => routineFromRows(r, byRoutine.get(r.id) ?? []));
}

async function replaceTriggers(
  organizationId: string,
  routineId: string,
  triggers: RoutineTrigger[],
): Promise<void> {
  const db = supabaseAdmin();
  // Wipe existing triggers for this routine, then insert the new set.
  const { error: delErr } = await db
    .from("rgaios_routine_triggers")
    .delete()
    .eq("organization_id", organizationId)
    .eq("routine_id", routineId);
  if (delErr) throw new Error(`replaceTriggers delete: ${delErr.message}`);

  if (triggers.length === 0) return;
  const rows = triggers.map((t) => ({
    // Omit id when missing so the DB default (gen_random_uuid()) fires.
    // Sending {id: undefined} serialises as null over PostgREST, which
    // violates the NOT NULL primary key.
    ...(t.id ? { id: t.id } : {}),
    organization_id: organizationId,
    routine_id: routineId,
    kind: t.kind,
    // `enabled` is NOT NULL in rgaios_routine_triggers. The UI always
    // sends a boolean (newTrigger() defaults to true), but external
    // callers (MCP, raw fetch from a script, the routine-from-chat
    // tool) may omit the field entirely. Default to enabled=true so
    // the insert never crashes with "violates not-null constraint";
    // a routine with a manual trigger you can't fire isn't useful.
    enabled: t.enabled ?? true,
    config: triggerConfigFor(t),
  }));
  const { error: insErr } = await db
    .from("rgaios_routine_triggers")
    .insert(rows);
  if (insErr) throw new Error(`replaceTriggers insert: ${insErr.message}`);
}

export async function createRoutine(
  organizationId: string,
  input: RoutineCreateInput,
): Promise<Routine> {
  await ensureDefaultOrganization();
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("rgaios_routines")
    .insert({
      organization_id: organizationId,
      title: input.title,
      description: input.description || null,
      assignee_agent_id: input.assigneeAgentId,
      status: "active",
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`createRoutine: ${error?.message}`);

  await replaceTriggers(organizationId, data.id, input.triggers);
  return routineFromRows(
    data,
    input.triggers.map((t) => ({
      id: t.id,
      organization_id: organizationId,
      routine_id: data.id,
      kind: t.kind,
      enabled: t.enabled,
      config: triggerConfigFor(t),
      public_id: null,
      last_fired_at: null,
      created_at: new Date().toISOString(),
    })),
  );
}

export async function updateRoutine(
  organizationId: string,
  id: string,
  patch: RoutineUpdateInput,
): Promise<Routine> {
  const db = supabaseAdmin();
  const dbPatch: RoutineUpdate = {};
  if (patch.title !== undefined) dbPatch.title = patch.title;
  if (patch.description !== undefined)
    dbPatch.description = patch.description || null;
  if (patch.assigneeAgentId !== undefined)
    dbPatch.assignee_agent_id = patch.assigneeAgentId;
  if (patch.status !== undefined) dbPatch.status = patch.status;

  if (Object.keys(dbPatch).length > 0) {
    const { error } = await db
      .from("rgaios_routines")
      .update(dbPatch)
      .eq("organization_id", organizationId)
      .eq("id", id);
    if (error) throw new Error(`updateRoutine: ${error.message}`);
  }

  if (patch.triggers !== undefined) {
    await replaceTriggers(organizationId, id, patch.triggers);
  }

  // Re-read fresh state
  const { data: row, error: fErr } = await db
    .from("rgaios_routines")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .single();
  if (fErr || !row) throw new Error(`updateRoutine re-read: ${fErr?.message}`);
  const { data: tRows, error: tErr } = await db
    .from("rgaios_routine_triggers")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("routine_id", id);
  if (tErr) throw new Error(`updateRoutine triggers: ${tErr.message}`);
  return routineFromRows(row, tRows ?? []);
}

export async function deleteRoutine(
  organizationId: string,
  id: string,
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("rgaios_routines")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", id);
  if (error) throw new Error(`deleteRoutine: ${error.message}`);
}

export async function setRoutineStatus(
  organizationId: string,
  id: string,
  status: "active" | "paused" | "archived",
): Promise<Routine> {
  return updateRoutine(organizationId, id, { status });
}

export async function markRoutineRunNow(
  organizationId: string,
  id: string,
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("rgaios_routines")
    .update({ last_run_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("id", id);
  if (error) throw new Error(`markRoutineRunNow: ${error.message}`);
}
