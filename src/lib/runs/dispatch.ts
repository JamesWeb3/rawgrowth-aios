import { after } from "next/server";
import { isV3 } from "@/lib/deploy-mode";
import { supabaseAdmin } from "@/lib/supabase/server";
import { executeRun } from "./executor";

/**
 * Unified "a run was just created, what happens next?" entrypoint.
 *
 *   hosted      → fires the autonomous executor in the background via after()
 *   self_hosted → SAME as hosted: in-process via after(). Pre-fix this
 *                 left runs pending forever waiting for an external MCP
 *                 `runs_claim` client that doesn't exist on Pedro's admin
 *                 VPS (DEPLOY_MODE=self_hosted, no drain daemon, no
 *                 long-running Claude Code session). The audit row +
 *                 in-process executor is the right default; clients who
 *                 actually want MCP claim semantics can flip to v3.
 *   v3          → audits + pokes the host-side rawclaw-drain.service
 *                 (port 9876). If the drain ack comes back, drain owns
 *                 the run and we exit. If the drain didn't ack (no URL
 *                 set, network refusal, non-200 reply), fall back to the
 *                 same in-process after()/direct path. Without that
 *                 fallback every v3 VPS missing a live drain daemon
 *                 silently age-outs every dispatched run.
 *
 * Callers do not need to know which mode they're in  -  this helper is the
 * single place that branches.
 */
export function dispatchRun(runId: string, organizationId: string) {
  if (isV3) {
    void dispatchV3(runId, organizationId);
    return;
  }
  fireInProcess(runId, organizationId);
}

/**
 * v3 branch: audit + drain poke + in-process fallback. Runs as a detached
 * Promise from the synchronous dispatchRun caller so HTTP handlers don't
 * block on the drain handshake.
 */
async function dispatchV3(runId: string, organizationId: string) {
  // Supabase's PostgrestBuilder is a PromiseLike, not a real Promise,
  // so .catch() isn't on the prototype. Wrap with Promise.resolve()
  // to get full Promise semantics for both error-payload + thrown
  // rejection handling. Pre-fix this was `void ...insert(...)` which
  // silently swallowed both branches.
  Promise.resolve(
    supabaseAdmin()
      .from("rgaios_audit_log")
      .insert({
        organization_id: organizationId,
        kind: "run_queued_for_drain",
        actor_type: "system",
        actor_id: "dispatcher",
        detail: { run_id: runId },
      }),
  )
    .then(({ error }) => {
      if (error) {
        console.error("[dispatch.audit] insert failed", error);
      }
    })
    .catch((err) => {
      console.error("[dispatch.audit] insert threw", err);
    });

  const drainUrl = process.env.RAWCLAW_DRAIN_URL;
  if (drainUrl) {
    // Fire-and-forget poke. The drain server's /triage path runs the
    // rawgrowth-triage slash command which uses MCP runs_claim to pick
    // up the pending row. 1s timeout — drain ack is local + immediate.
    let drainAcked = false;
    try {
      const r = await fetch(`${drainUrl.replace(/\/$/, "")}/triage`, {
        method: "POST",
        signal: AbortSignal.timeout(1000),
      });
      drainAcked = r.ok;
    } catch {
      /* drain unreachable; fall through to in-process below. */
    }
    if (drainAcked) return;
    console.warn(
      `[dispatch] drain at ${drainUrl} did not ack, falling back to in-process executor for run ${runId}`,
    );
  }

  // No drain URL OR drain didn't ack: run in-process so the v3 VPS
  // doesn't lose the run. Brief double-execute risk if the drain wakes
  // late is bounded by claimRun's atomic status=pending→running -
  // whichever side wins, the loser bails on a no-op.
  fireInProcess(runId, organizationId);
}

/**
 * In-process executor dispatch via Next.js after(). after() requires
 * the request scope of an HTTP handler; if we're called from a script
 * or other background context where it throws, fall back to a detached
 * executeRun() so the run still progresses past pending.
 */
function fireInProcess(runId: string, organizationId: string) {
  try {
    after(async () => {
      await executeRun(runId, organizationId);
    });
  } catch (err) {
    console.error(
      "[dispatch] after() unavailable, falling back to direct executor:",
      (err as Error).message,
    );
    void executeRun(runId, organizationId).catch((e) => {
      console.error("[dispatch] direct executor failed", runId, e);
    });
  }
}
