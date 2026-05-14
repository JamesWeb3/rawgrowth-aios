import { supabaseAdmin } from "@/lib/supabase/server";
import { registerTool, text, textError } from "../registry";

/**
 * MCP tools for the orchestrator plan artifact. The COO / Atlas persona
 * runs a plan -> dispatch -> evaluate -> re-check loop, but the plan
 * used to live only in its <thinking> block  -  ephemeral, gone on the
 * next turn or the next context compaction. These three tools give it a
 * real row in rgaios_plans (migration 0071) so the plan survives.
 *
 * plan_create writes a fresh plan, plan_update edits the goal / status /
 * step list of one the org owns, plan_get reads it back. Every query is
 * scoped with `.eq("organization_id", ctx.organizationId)` so a plan
 * from another org is invisible and uneditable even if its id is known.
 */

const VALID_PLAN_STATUS = ["active", "completed", "abandoned"] as const;
const VALID_STEP_STATUS = ["pending", "running", "done", "blocked"] as const;

type PlanRow = {
  id: string;
  goal: string;
  steps: unknown;
  status: string;
  owner_agent_id: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Validate that `steps` is an array of plain objects. Returns the array
 * on success or an error string the caller turns into a textError. We
 * deliberately stay loose on the per-step shape  -  the orchestrator
 * owns the { id, desc, owner_agent_id, status, result_ref } convention
 * and the jsonb column does not enforce it.
 */
function validateSteps(raw: unknown): unknown[] | string {
  if (!Array.isArray(raw)) {
    return "steps must be an array of objects";
  }
  for (const [i, step] of raw.entries()) {
    if (typeof step !== "object" || step === null || Array.isArray(step)) {
      return `steps[${i}] must be an object`;
    }
    const status = (step as { status?: unknown }).status;
    if (
      status !== undefined &&
      !(VALID_STEP_STATUS as readonly unknown[]).includes(status)
    ) {
      return `steps[${i}].status must be one of: ${VALID_STEP_STATUS.join(", ")}`;
    }
  }
  return raw;
}

/** Render a plan row as a readable text block for plan_get. */
function formatPlan(plan: PlanRow): string {
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const lines = [
    `**Plan** \`${plan.id}\`  -  status: ${plan.status}`,
    `Goal: ${plan.goal}`,
    plan.owner_agent_id
      ? `Owner agent: ${plan.owner_agent_id}`
      : `Owner agent: (none)`,
    "",
  ];
  if (steps.length === 0) {
    lines.push("No steps recorded yet.");
  } else {
    lines.push(`Steps (${steps.length}):`);
    steps.forEach((raw, i) => {
      const step = (raw ?? {}) as {
        id?: unknown;
        desc?: unknown;
        owner_agent_id?: unknown;
        status?: unknown;
        result_ref?: unknown;
      };
      const status = step.status ? String(step.status) : "pending";
      const desc = step.desc ? String(step.desc) : "(no description)";
      const owner = step.owner_agent_id
        ? ` · owner: ${String(step.owner_agent_id)}`
        : "";
      const ref = step.result_ref
        ? ` · result: ${String(step.result_ref)}`
        : "";
      const id = step.id ? String(step.id) : String(i + 1);
      lines.push(`- [${status}] ${desc}${owner}${ref} · id: \`${id}\``);
    });
  }
  return lines.join("\n");
}

// ─── plan_create ───────────────────────────────────────────────────

registerTool({
  name: "plan_create",
  description:
    "Persist a new orchestrator plan. Required: goal (what the plan is trying to achieve). Optional: steps (an array of step objects, each shaped { id, desc, owner_agent_id, status, result_ref } where status is pending|running|done|blocked). Returns the new plan id  -  hold on to it and pass it to `plan_update` as you make progress so the plan survives context compaction.",
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: {
      goal: {
        type: "string",
        description: "The plan's objective, in plain English.",
      },
      steps: {
        type: "array",
        items: { type: "object" },
        description:
          "Optional initial step list. Each step: { id, desc, owner_agent_id, status, result_ref }. status is one of pending, running, done, blocked.",
      },
      owner_agent_id: {
        type: "string",
        description:
          "Optional id of the orchestrator agent that owns this plan.",
      },
    },
    required: ["goal"],
  },
  handler: async (args, ctx) => {
    const goal = String(args.goal ?? "").trim();
    if (!goal) return textError("goal is required");

    let steps: unknown[] = [];
    if (args.steps !== undefined) {
      const validated = validateSteps(args.steps);
      if (typeof validated === "string") return textError(validated);
      steps = validated;
    }

    const ownerAgentId = args.owner_agent_id
      ? String(args.owner_agent_id).trim()
      : null;

    // rgaios_plans landed in migration 0071; the generated Supabase
    // types file is regenerated on the next typegen pass, so until then
    // the row payloads are cast through `never` the same way the
    // rgaios_audit_log insert in agents.ts is.
    const db = supabaseAdmin();
    const { data, error } = await db
      .from("rgaios_plans")
      .insert({
        organization_id: ctx.organizationId,
        owner_agent_id: ownerAgentId || null,
        goal,
        steps,
      } as never)
      .select("id")
      .single();

    if (error || !data) {
      return textError(
        `Could not create plan: ${error?.message ?? "unknown error"}`,
      );
    }

    return text(
      [
        `Created plan \`${(data as { id: string }).id}\`.`,
        `- goal: ${goal}`,
        `- steps: ${steps.length}`,
        `- status: active`,
      ].join("\n"),
    );
  },
});

// ─── plan_update ───────────────────────────────────────────────────

registerTool({
  name: "plan_update",
  description:
    "Update a plan this organization owns. Required: plan_id. Optional: goal, status (active|completed|abandoned), steps (replaces the whole step list  -  pass the full array back with individual step status fields changed). Only fields you pass are touched. Use `plan_get` first to read the current step list.",
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: {
      plan_id: { type: "string", description: "Id of the plan to update." },
      goal: { type: "string" },
      status: {
        type: "string",
        description: "One of: active, completed, abandoned.",
      },
      steps: {
        type: "array",
        items: { type: "object" },
        description:
          "Replaces the entire step list. To change one step's status, read the plan, edit that step's `status`, and pass the full array back.",
      },
    },
    required: ["plan_id"],
  },
  handler: async (args, ctx) => {
    const planId = String(args.plan_id ?? "").trim();
    if (!planId) return textError("plan_id is required");

    const patch: Record<string, unknown> = {};
    if (args.goal !== undefined) {
      const goal = String(args.goal).trim();
      if (!goal) return textError("goal cannot be empty");
      patch.goal = goal;
    }
    if (args.status !== undefined) {
      const status = String(args.status);
      if (!(VALID_PLAN_STATUS as readonly string[]).includes(status)) {
        return textError(
          `status must be one of: ${VALID_PLAN_STATUS.join(", ")}`,
        );
      }
      patch.status = status;
    }
    if (args.steps !== undefined) {
      const validated = validateSteps(args.steps);
      if (typeof validated === "string") return textError(validated);
      patch.steps = validated;
    }

    if (Object.keys(patch).length === 0) {
      return textError(
        "nothing to update  -  pass at least one of: goal, status, steps",
      );
    }

    const db = supabaseAdmin();
    // The .eq("organization_id", ...) guard makes a cross-org update a
    // no-op: the row count comes back zero and we report not-found
    // rather than leaking that the id exists in another org.
    const { data, error } = await db
      .from("rgaios_plans")
      .update(patch as never)
      .eq("id", planId)
      .eq("organization_id", ctx.organizationId)
      .select("id, goal, steps, status, owner_agent_id, created_at, updated_at")
      .maybeSingle();

    if (error) {
      return textError(`Could not update plan: ${error.message}`);
    }
    if (!data) {
      return textError(`plan ${planId} not found in your organization`);
    }

    return text(formatPlan(data as PlanRow));
  },
});

// ─── plan_get ──────────────────────────────────────────────────────

registerTool({
  name: "plan_get",
  description:
    "Read back a persisted plan. With plan_id: returns that plan. Without plan_id: returns this organization's most recently updated `active` plan. Use this at the start of a turn to recover the plan after context compaction.",
  inputSchema: {
    type: "object",
    properties: {
      plan_id: {
        type: "string",
        description:
          "Optional. Omit to get the org's most recent active plan.",
      },
    },
  },
  handler: async (args, ctx) => {
    const db = supabaseAdmin();
    const planId =
      args.plan_id !== undefined ? String(args.plan_id).trim() : "";

    if (planId) {
      const { data, error } = await db
        .from("rgaios_plans")
        .select(
          "id, goal, steps, status, owner_agent_id, created_at, updated_at",
        )
        .eq("id", planId)
        .eq("organization_id", ctx.organizationId)
        .maybeSingle();

      if (error) {
        return textError(`Could not read plan: ${error.message}`);
      }
      if (!data) {
        return textError(`plan ${planId} not found in your organization`);
      }
      return text(formatPlan(data as PlanRow));
    }

    // No id given: most-recent active plan for the org.
    const { data, error } = await db
      .from("rgaios_plans")
      .select(
        "id, goal, steps, status, owner_agent_id, created_at, updated_at",
      )
      .eq("organization_id", ctx.organizationId)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return textError(`Could not read plans: ${error.message}`);
    }
    if (!data) {
      return text(
        "No active plan for this organization. Create one with `plan_create`.",
      );
    }
    return text(formatPlan(data as PlanRow));
  },
});

export const PLANS_TOOLS_REGISTERED = true;
