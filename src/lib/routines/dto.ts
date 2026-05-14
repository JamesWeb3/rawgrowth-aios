import type { Database } from "@/lib/supabase/types";
import type {
  IntegrationEvent,
  RoutineStatus,
  RoutineTrigger,
  SchedulePreset,
} from "./constants";

type RoutineRow = Database["public"]["Tables"]["rgaios_routines"]["Row"];
type TriggerRow =
  Database["public"]["Tables"]["rgaios_routine_triggers"]["Row"];

/**
 * Client-facing routine shape. `triggers` is embedded (the UI always
 * wants them together). Kind-specific config is flattened from the
 * jsonb `config` column onto the trigger object so the UI can read
 * `trigger.preset` / `trigger.cron` directly.
 */
export type Routine = {
  id: string;
  title: string;
  description: string;
  assigneeAgentId: string | null;
  status: RoutineStatus;
  lastRunAt: string | null;
  createdAt: string;
  triggers: RoutineTrigger[];
};

export function routineFromRows(
  row: RoutineRow,
  triggers: TriggerRow[],
): Routine {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    assigneeAgentId: row.assignee_agent_id,
    // rgaios_routines.status is plain text in Postgres (no enum), so the
    // regenerated types widen it to string. The stored value is always
    // a RoutineStatus - narrow at the row->DTO boundary.
    status: row.status as RoutineStatus,
    lastRunAt: row.last_run_at,
    createdAt: row.created_at,
    triggers: triggers.map(triggerFromRow),
  };
}

export function triggerFromRow(row: TriggerRow): RoutineTrigger {
  const cfg = (row.config ?? {}) as Record<string, unknown>;
  // Legacy compat: agent-commands.ts (Atlas chat <command type="routine_create">)
  // historically inserted rows with kind='cron'. The current write path uses
  // kind='schedule', but the 8 pre-existing rows still need to render. Treat
  // 'cron' as a schedule with custom preset so /api/routines GET stops
  // throwing "Unknown trigger kind: cron" and 500ing the whole list.
  const kind = (row.kind as string) === "cron" ? "schedule" : row.kind;
  switch (kind) {
    case "schedule":
      return {
        id: row.id,
        kind: "schedule",
        enabled: row.enabled,
        preset: (cfg.preset as SchedulePreset) ?? "custom",
        cron: (cfg.cron as string) ?? "",
        timezone: (cfg.timezone as string) ?? "UTC",
      };
    case "webhook":
      return {
        id: row.id,
        kind: "webhook",
        enabled: row.enabled,
        publicUrl: (cfg.publicUrl as string) ?? "",
        signingSecret: (cfg.signingSecret as string) ?? "",
      };
    case "integration":
      return {
        id: row.id,
        kind: "integration",
        enabled: row.enabled,
        event: (cfg.event as IntegrationEvent) ?? "fathom.meeting.ended",
      };
    case "telegram":
      return {
        id: row.id,
        kind: "telegram",
        enabled: row.enabled,
        command: (cfg.command as string) ?? "/run",
        description: (cfg.description as string) ?? "",
      };
    case "manual":
      return { id: row.id, kind: "manual", enabled: row.enabled };
    default: {
      // Defensive: any unknown kind that slips past the cron coercion
      // above falls back to manual rather than 500ing the whole list.
      // The audit trail still shows the original row.kind via the DB.
      console.warn(
        `[routines/dto] unknown trigger kind "${String(row.kind)}" on trigger ${row.id} - falling back to manual`,
      );
      return { id: row.id, kind: "manual", enabled: row.enabled };
    }
  }
}

/** Extract the jsonb-shaped `config` from a UI-shaped trigger. */
export function triggerConfigFor(
  t: RoutineTrigger,
): Record<string, unknown> {
  switch (t.kind) {
    case "schedule":
      return { preset: t.preset, cron: t.cron, timezone: t.timezone };
    case "webhook":
      return { publicUrl: t.publicUrl, signingSecret: t.signingSecret };
    case "integration":
      return { event: t.event };
    case "telegram":
      return { command: t.command, description: t.description ?? "" };
    case "manual":
      return {};
  }
}

export type RoutineCreateInput = {
  title: string;
  description: string;
  assigneeAgentId: string | null;
  triggers: RoutineTrigger[];
};

export type RoutineUpdateInput = Partial<RoutineCreateInput> & {
  status?: RoutineStatus;
};
