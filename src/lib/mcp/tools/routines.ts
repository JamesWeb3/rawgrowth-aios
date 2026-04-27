import { registerTool, text, textError } from "../registry";
import {
  createRoutine,
  deleteRoutine,
  listRoutinesForOrg,
  updateRoutine,
} from "@/lib/routines/queries";
import type { RoutineTrigger } from "@/lib/routines/constants";
import { randomUUID } from "crypto";

/**
 * MCP tools for the routine lifecycle. Lets clients create, list, update,
 * and archive routines directly from Claude Code. Triggers are kept
 * deliberately simple  -  a manual trigger is always created, and an
 * optional schedule (cron) trigger if requested. Webhook/integration/
 * telegram triggers still flow through the web UI for now.
 */

const VALID_STATUS = ["active", "paused", "archived"] as const;

function newTriggerId() {
  return randomUUID();
}

function buildTriggers(schedule?: {
  cron?: string;
  timezone?: string;
}): RoutineTrigger[] {
  const triggers: RoutineTrigger[] = [
    { id: newTriggerId(), kind: "manual", enabled: true },
  ];
  if (schedule?.cron) {
    triggers.push({
      id: newTriggerId(),
      kind: "schedule",
      enabled: true,
      preset: "custom",
      cron: schedule.cron,
      timezone: schedule.timezone ?? "UTC",
    });
  }
  return triggers;
}

// ─── routines_list ─────────────────────────────────────────────────

registerTool({
  name: "routines_list",
  description:
    "List every routine in this organization. Returns id, title, status, assignee, and whether a schedule trigger is attached.",
  inputSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        description: "Filter by status: active, paused, archived, or all (default: all).",
      },
    },
  },
  handler: async (args, ctx) => {
    const filter = String(args.status ?? "all");
    const routines = await listRoutinesForOrg(ctx.organizationId);
    const filtered =
      filter === "all"
        ? routines
        : routines.filter((r) => r.status === filter);

    if (filtered.length === 0) {
      return text(
        filter === "all"
          ? "No routines yet. Create one with `routines_create`  -  minimum is `title` and `description`."
          : `No routines with status=${filter}.`,
      );
    }

    const lines = [
      `Found ${filtered.length} routine(s):`,
      "",
      ...filtered.map((r) => {
        const schedule = r.triggers.find((t) => t.kind === "schedule");
        const scheduleStr = schedule ? ` · schedule: ${(schedule as { cron: string }).cron}` : "";
        return `- **${r.title}**  -  status: ${r.status}${scheduleStr} · id: \`${r.id}\``;
      }),
    ];
    return text(lines.join("\n"));
  },
});

// ─── routines_create ───────────────────────────────────────────────

registerTool({
  name: "routines_create",
  description:
    "Create a new routine. Required: title, description (the routine's instructions  -  Claude will read this when the routine runs). Optional: assignee_agent_id (id of an agent), schedule_cron (e.g. '0 9 * * *' to run daily at 9am), schedule_timezone (default: UTC). Every routine is always runnable manually.",
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string" },
      description: {
        type: "string",
        description:
          "The routine's instructions. This IS the prompt that runs  -  be specific and plain-english.",
      },
      assignee_agent_id: {
        type: "string",
        description: "Optional id of the agent assigned to this routine.",
      },
      schedule_cron: {
        type: "string",
        description:
          "Optional cron expression. E.g. '0 9 * * *' for daily 9am. Only applies in hosted mode; self-hosted routines fire when the user runs /rawgrowth-triage.",
      },
      schedule_timezone: {
        type: "string",
        description: "IANA timezone for the schedule. Default: UTC.",
      },
    },
    required: ["title", "description"],
  },
  handler: async (args, ctx) => {
    const title = String(args.title ?? "").trim();
    const description = String(args.description ?? "").trim();
    if (!title) return textError("title is required");
    if (!description) return textError("description is required");

    const cron =
      args.schedule_cron !== undefined
        ? String(args.schedule_cron).trim()
        : undefined;

    const routine = await createRoutine(ctx.organizationId, {
      title,
      description,
      assigneeAgentId: args.assignee_agent_id
        ? String(args.assignee_agent_id)
        : null,
      triggers: buildTriggers(
        cron ? { cron, timezone: String(args.schedule_timezone ?? "UTC") } : undefined,
      ),
    });

    const schedule = routine.triggers.find((t) => t.kind === "schedule");
    return text(
      [
        `Created routine **${routine.title}**.`,
        `- id: \`${routine.id}\``,
        `- status: ${routine.status}`,
        schedule
          ? `- schedule: ${(schedule as { cron: string }).cron}`
          : `- schedule: manual only`,
        routine.assigneeAgentId
          ? `- assignee: ${routine.assigneeAgentId}`
          : `- assignee: (none)`,
      ].join("\n"),
    );
  },
});

// ─── routines_update ───────────────────────────────────────────────

registerTool({
  name: "routines_update",
  description:
    "Update an existing routine. Only fields you pass are changed. Use `routines_list` to find the id.",
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      assignee_agent_id: { type: "string" },
      status: {
        type: "string",
        description: "One of: active, paused, archived.",
      },
    },
    required: ["id"],
  },
  handler: async (args, ctx) => {
    const id = String(args.id ?? "").trim();
    if (!id) return textError("id is required");

    const patch: Record<string, unknown> = {};
    if (args.title !== undefined) patch.title = String(args.title);
    if (args.description !== undefined) patch.description = String(args.description);
    if (args.assignee_agent_id !== undefined) {
      const v = String(args.assignee_agent_id).trim();
      patch.assigneeAgentId = v === "" ? null : v;
    }
    if (args.status !== undefined) {
      const s = String(args.status);
      if (!(VALID_STATUS as readonly string[]).includes(s)) {
        return textError(`status must be one of: ${VALID_STATUS.join(", ")}`);
      }
      patch.status = s;
    }

    const routine = await updateRoutine(ctx.organizationId, id, patch);
    return text(
      `Updated **${routine.title}**  -  status: ${routine.status}.`,
    );
  },
});

// ─── routines_delete ───────────────────────────────────────────────

registerTool({
  name: "routines_delete",
  description:
    "Permanently delete a routine and all of its triggers. Pending runs for the routine stay in the database for auditing but won't be executable.",
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
    },
    required: ["id"],
  },
  handler: async (args, ctx) => {
    const id = String(args.id ?? "").trim();
    if (!id) return textError("id is required");
    await deleteRoutine(ctx.organizationId, id);
    return text(`Deleted routine \`${id}\`.`);
  },
});
