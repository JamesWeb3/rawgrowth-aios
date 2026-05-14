import { supabaseAdmin } from "@/lib/supabase/server";
import { callTool } from "@/lib/mcp/registry";
import type { Database } from "@/lib/supabase/types";

type ApprovalRow = Database["public"]["Tables"]["rgaios_approvals"]["Row"];

export type ApprovalWithContext = ApprovalRow & {
  agent_name: string | null;
  routine_title: string | null;
};

export async function listApprovals(
  organizationId: string,
  status: "pending" | "approved" | "rejected" | "all" = "pending",
  limit = 50,
): Promise<ApprovalWithContext[]> {
  const db = supabaseAdmin();
  let query = db
    .from("rgaios_approvals")
    .select(
      `*,
       rgaios_agents:agent_id ( name ),
       rgaios_routine_runs:routine_run_id (
         rgaios_routines:routine_id ( title )
       )`,
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status !== "all") query = query.eq("status", status);

  const { data, error } = await query;
  if (error) throw new Error(`listApprovals: ${error.message}`);

  type Joined = ApprovalRow & {
    rgaios_agents: { name: string } | null;
    rgaios_routine_runs: {
      rgaios_routines: { title: string } | null;
    } | null;
  };

  return (data as Joined[] | null ?? []).map((row) => ({
    ...row,
    agent_name: row.rgaios_agents?.name ?? null,
    routine_title:
      row.rgaios_routine_runs?.rgaios_routines?.title ?? null,
  }));
}

export async function createApproval(params: {
  organizationId: string;
  routineRunId: string | null;
  agentId: string | null;
  toolName: string;
  toolArgs: Record<string, unknown>;
  reason?: string | null;
}): Promise<ApprovalRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("rgaios_approvals")
    .insert({
      organization_id: params.organizationId,
      routine_run_id: params.routineRunId,
      agent_id: params.agentId,
      tool_name: params.toolName,
      tool_args: params.toolArgs,
      reason: params.reason ?? null,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`createApproval: ${error?.message}`);
  return data;
}

/**
 * Decide an approval. On approve, executes the stored tool with its stored
 * args and writes an audit log entry. On reject, just marks the row.
 */
export async function decideApproval(params: {
  organizationId: string;
  approvalId: string;
  decision: "approved" | "rejected";
  reviewerId: string;
}): Promise<{ approval: ApprovalRow; executionResult?: string }> {
  const db = supabaseAdmin();

  // Atomic claim: conditional UPDATE on status='pending'. Mirrors the
  // schedule-tick "raced" pattern (see src/app/api/cron/schedule-tick/
  // route.ts:196-226). Without this, two reviewer clicks both pass a
  // SELECT-then-UPDATE check and both fire the tool. Now: only one UPDATE
  // returns a row; the other gets count=0 and we bail before invoking
  // callTool. The audit log entry for the loser is suppressed on purpose -
  // there's nothing to audit, no decision was applied.
  const reviewedAt = new Date().toISOString();
  const { data: claimed, error: claimErr } = await db
    .from("rgaios_approvals")
    .update({
      status: params.decision,
      reviewed_by: params.reviewerId,
      reviewed_at: reviewedAt,
    })
    .eq("id", params.approvalId)
    .eq("organization_id", params.organizationId)
    .eq("status", "pending")
    .select("*");
  if (claimErr) throw new Error(`decideApproval claim: ${claimErr.message}`);
  if (!claimed || claimed.length === 0) {
    // Either the row doesn't exist, doesn't belong to this org, or another
    // reviewer already decided it. Distinguish so the API can return a
    // useful error.
    const { data: existing } = await db
      .from("rgaios_approvals")
      .select("status")
      .eq("id", params.approvalId)
      .eq("organization_id", params.organizationId)
      .maybeSingle();
    if (!existing) throw new Error("Approval not found");
    throw new Error(`Approval already ${existing.status}`);
  }
  const approval = claimed[0];

  let executionResult: string | undefined;

  if (params.decision === "approved") {
    try {
      const result = await callTool(
        approval.tool_name,
        approval.tool_args as Record<string, unknown>,
        // skipApprovalGate: this IS the approved re-execution. Without
        // it the central callTool write gate would re-queue the call
        // into rgaios_approvals and it would never actually run.
        { organizationId: params.organizationId, skipApprovalGate: true },
      );
      executionResult = result.content.map((c) => c.text).join("\n");
      if (result.isError) {
        executionResult = `[tool error] ${executionResult}`;
      }
    } catch (err) {
      executionResult = `[execution failed] ${(err as Error).message}`;
    }
  }

  const updated = approval;

  await db.from("rgaios_audit_log").insert({
    organization_id: params.organizationId,
    kind: `approval_${params.decision}`,
    actor_type: "user",
    actor_id: params.reviewerId,
    detail: {
      approval_id: params.approvalId,
      tool_name: approval.tool_name,
      routine_run_id: approval.routine_run_id,
      agent_id: approval.agent_id,
      execution_result: executionResult ?? null,
    },
  });

  return { approval: updated, executionResult };
}
