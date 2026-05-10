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
  if (isV3) {
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
      fetch(`${drainUrl.replace(/\/$/, "")}/triage`, {
        method: "POST",
        signal: AbortSignal.timeout(1000),
      }).catch(() => {
        /* drain unreachable; the systemd-tick fallback (every 1-2 min)
           will retry the pending row so a momentarily-down drain
           daemon doesn't lose work. */
      });
    }
    return;
  }
  // hosted + self_hosted: in-process executor via Next.js after().
  // after() requires Next.js request scope; if we're called from a
  // background context where it throws (e.g. a script invoking
  // dispatchRun directly outside an HTTP handler), fall back to a
  // detached executeRun() so the run still progresses past pending.
  try {
    after(async () => {
      await executeRun(runId);
    });
  } catch (err) {
    console.error(
      "[dispatch] after() unavailable, falling back to direct executor:",
      (err as Error).message,
    );
    void executeRun(runId).catch((e) => {
      console.error("[dispatch] direct executor failed", runId, e);
    });
  }
}
