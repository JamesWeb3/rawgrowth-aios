import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Unified approval-gate decision for MCP tool execution. Replaces the
 * three divergent inline copies that used to live in:
 *
 *   - src/lib/mcp/registry.ts          (central dispatch)
 *   - src/lib/mcp/tools/composio-router.ts (composio_use_tool only)
 *   - src/lib/runs/executor.ts         (per-tool write_policy)
 *
 * Failure-mode parity is the point: prior to this helper, registry.ts
 * failed CLOSED on a transient read of approvals_gate_all (safer) while
 * composio-router.ts failed OPEN (fell through to execute). A single
 * decision function means every write site behaves the same on the
 * same DB hiccup.
 *
 * Decision:
 *   - skip = true when ctx.skipApprovalGate is set (decideApproval re-
 *     dispatch path; the row already cleared review).
 *   - gate = true when toolName is in ALWAYS_GATE_TOOLS (high-blast,
 *     ignore org policy).
 *   - gate = true when isWrite AND the org has approvals_gate_all on.
 *   - gate = true on read failure (fail CLOSED). The caller surfaces a
 *     "approval system failed" error rather than executing ungated.
 *   - gate = false otherwise.
 */

/**
 * High-blast tools that ALWAYS queue for operator approval, regardless
 * of whether the org opted into approvals_gate_all. supabase_run_sql
 * runs arbitrary SQL against a project's Postgres; apply_migration and
 * create_project are similarly irreversible. An agent is prompt-
 * injectable, so these must never execute unattended on a client's
 * production database.
 */
export const ALWAYS_GATE_TOOLS = new Set<string>([
  "supabase_run_sql",
  "supabase_apply_migration",
  "supabase_create_project",
]);

export type GateContext = {
  organizationId: string;
  skipApprovalGate?: boolean;
};

/**
 * Why each source matters operationally:
 *   SKIP        - decideApproval re-dispatches an already-approved row;
 *                 must NOT re-queue or the operator sees the same item twice.
 *   ALWAYS_GATE - high-blast supabase_run_sql class; ignores org policy
 *                 so an org with approvals_gate_all=false still can't run
 *                 arbitrary SQL unattended.
 *   ORG_FLAG    - the org opted in to gating; routine behavior change.
 *   FAIL_CLOSED - policy read failed (RLS, transient DB). Treat as opted-in
 *                 so a DB hiccup never silently disables the gate; a
 *                 monitoring tool watching this source can alert on
 *                 sustained failures vs the org-flag (legitimate) path.
 *   UNGATED     - no rule triggered; tool executes.
 */
export const GATE_SOURCE = {
  SKIP: "skip",
  ALWAYS_GATE: "always-gate",
  ORG_FLAG: "org-flag",
  FAIL_CLOSED: "fail-closed",
  UNGATED: "ungated",
} as const;

export type GateSource = typeof GATE_SOURCE[keyof typeof GATE_SOURCE];

export type GateDecision = {
  gate: boolean;
  reason: string;
  source: GateSource;
};

/**
 * Whether the org flipped the `approvals_gate_all` kill switch
 * (migration 0067). Returns true on any read error so callers gate
 * closed instead of silently dropping the protection.
 */
async function orgGatesAllWrites(organizationId: string): Promise<{
  on: boolean;
  failed: boolean;
}> {
  try {
    const { data, error } = await supabaseAdmin()
      .from("rgaios_organizations")
      .select("approvals_gate_all")
      .eq("id", organizationId)
      .maybeSingle();
    if (error) {
      console.error(
        `[approval-gate] approvals_gate_all read failed for org=${organizationId}: ${error.message}`,
      );
      return { on: true, failed: true };
    }
    const on =
      (data as { approvals_gate_all?: boolean } | null)?.approvals_gate_all ===
      true;
    return { on, failed: false };
  } catch (err) {
    console.error(
      `[approval-gate] approvals_gate_all check threw for org=${organizationId}: ${
        (err as Error).message
      }`,
    );
    return { on: true, failed: true };
  }
}

export async function shouldGateTool(
  ctx: GateContext,
  toolName: string,
  isWrite: boolean,
): Promise<GateDecision> {
  if (ctx.skipApprovalGate) {
    return {
      gate: false,
      reason: "decideApproval re-dispatch; gate already cleared",
      source: GATE_SOURCE.SKIP,
    };
  }

  if (ALWAYS_GATE_TOOLS.has(toolName)) {
    return {
      gate: true,
      reason: `${toolName} is a high-blast write tool; every call requires operator approval.`,
      source: GATE_SOURCE.ALWAYS_GATE,
    };
  }

  if (!isWrite) {
    return {
      gate: false,
      reason: "read-only tool; no approval required",
      source: GATE_SOURCE.UNGATED,
    };
  }

  const { on, failed } = await orgGatesAllWrites(ctx.organizationId);
  if (failed) {
    return {
      gate: true,
      reason: `${toolName}: approvals_gate_all policy read failed; gating closed to stay safe.`,
      source: GATE_SOURCE.FAIL_CLOSED,
    };
  }
  if (on) {
    return {
      gate: true,
      reason: `Org policy approvals_gate_all is on; every write action requires operator approval.`,
      source: GATE_SOURCE.ORG_FLAG,
    };
  }
  return {
    gate: false,
    reason: "org policy off and tool not in ALWAYS_GATE_TOOLS",
    source: GATE_SOURCE.UNGATED,
  };
}
