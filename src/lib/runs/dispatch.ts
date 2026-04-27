import { after } from "next/server";
import { isSelfHosted } from "@/lib/deploy-mode";
import { supabaseAdmin } from "@/lib/supabase/server";
import { executeRun } from "./executor";

/**
 * Unified "a run was just created, what happens next?" entrypoint.
 *
 *   hosted      → fires the autonomous executor in the background via after()
 *   self_hosted → leaves the run in `pending` for local Claude Code to claim
 *                 via the MCP `runs_claim` tool, and records an audit entry
 *                 so the UI can reflect "queued for local Claude".
 *
 * Callers do not need to know which mode they're in  -  this helper is the
 * single place that branches.
 */
export function dispatchRun(runId: string, organizationId: string) {
  if (isSelfHosted) {
    // Fire-and-forget audit entry. We don't await it because HTTP responses
    // should never wait on logging.
    void supabaseAdmin()
      .from("rgaios_audit_log")
      .insert({
        organization_id: organizationId,
        kind: "run_queued_for_claude",
        actor_type: "system",
        actor_id: "dispatcher",
        detail: { run_id: runId },
      });
    return;
  }
  after(async () => {
    await executeRun(runId);
  });
}
