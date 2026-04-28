import { after } from "next/server";
import { isSelfHosted, isV3 } from "@/lib/deploy-mode";
import { supabaseAdmin } from "@/lib/supabase/server";
import { executeRun } from "./executor";

/**
 * Unified "a run was just created, what happens next?" entrypoint.
 *
 *   hosted      → fires the autonomous executor in the background via after()
 *   self_hosted → leaves the run in `pending` for local Claude Code to claim
 *                 via the MCP `runs_claim` tool, and records an audit entry
 *                 so the UI can reflect "queued for local Claude".
 *   v3          → leaves the run in `pending` and pokes the host-side
 *                 rawclaw-drain.service (port 9876) so it spawns Claude Code
 *                 to claim + execute via MCP. Drain is bounded by the
 *                 4-concurrent spawn cap (CTO brief §02 + R05). Without
 *                 this branch v3 silently fell into the in-process
 *                 Anthropic-API path and the drain server was dead infra.
 *
 * Callers do not need to know which mode they're in  -  this helper is the
 * single place that branches.
 */
export function dispatchRun(runId: string, organizationId: string) {
  if (isSelfHosted || isV3) {
    void supabaseAdmin()
      .from("rgaios_audit_log")
      .insert({
        organization_id: organizationId,
        kind: isV3 ? "run_queued_for_drain" : "run_queued_for_claude",
        actor_type: "system",
        actor_id: "dispatcher",
        detail: { run_id: runId },
      });
    if (isV3) {
      const drainUrl = process.env.RAWCLAW_DRAIN_URL;
      if (drainUrl) {
        // Fire-and-forget poke. The drain server's /triage path runs the
        // rawgrowth-triage slash command which uses MCP runs_claim to pick
        // up the pending row. 1s timeout — drain ack is local + immediate.
        fetch(`${drainUrl.replace(/\/$/, "")}/triage`, {
          method: "POST",
          signal: AbortSignal.timeout(1000),
        }).catch(() => {
          /* drain unreachable; the systemd-tick fallback (every 1-2 min)
             will retry the pending row so a momentarily-down drain
             daemon doesn't lose work. */
        });
      }
    }
    return;
  }
  after(async () => {
    await executeRun(runId);
  });
}
