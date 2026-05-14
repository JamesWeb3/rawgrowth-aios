/**
 * Durable-orchestration retry policy for delegated / scheduled runs.
 *
 * Pure module: no DB, no IO. The executor consults this to decide what
 * to do when a run fails - re-enqueue with backoff, escalate to a human,
 * or just leave it failed once attempts are exhausted.
 *
 * The CTO preamble tells the orchestrator to "retry once OR escalate",
 * but a prompt instruction is not a mechanism. This module is the
 * mechanism: a fixed max-attempts bound (the hard stop against infinite
 * loops) plus a simple, transparent classification of the failure.
 */

/** Hard cap on total attempts (original + retries). attempt 1 = original.  */
export const MAX_ATTEMPTS = 2;

/**
 * Backoff schedule in milliseconds, indexed by the attempt that is about
 * to start. attemptCount is the number of attempts already made, so the
 * delay before re-dispatching attempt N is BACKOFF_MS[N - 1]. Kept short:
 * the executor's own wall-clock cap is 120s and a delegated invoke caller
 * polls with its own timeout, so a long backoff would just blow that
 * budget. A re-enqueued run still has to wait for the dispatch path /
 * schedule-tick sweep anyway, so this is a floor, not a precise timer.
 */
export const BACKOFF_MS: readonly number[] = [0, 5_000];

/**
 * Delay (ms) to wait before re-dispatching, given how many attempts have
 * already completed. Clamps past the end of the schedule so a caller
 * can't index out of bounds.
 */
export function backoffForAttempt(attemptCount: number): number {
  if (attemptCount < 1) return BACKOFF_MS[0];
  const idx = Math.min(attemptCount, BACKOFF_MS.length) - 1;
  return BACKOFF_MS[idx];
}

/**
 * Substrings that mark a failure as transient / worth retrying. Matched
 * case-insensitively against the run's error string. These are the
 * shapes the executor + LLM transport actually emit:
 *   - "timed out" / "wall-clock" / "AbortError" - the 120s cap fired, or
 *     a CLI subprocess was SIGTERM'd; a retry may land inside budget.
 *   - "exited 1".."exited N" / "ECONNRESET" / "fetch failed" / "socket" -
 *     CLI subprocess crash or a dropped network connection mid-stream.
 *   - "stream" / "overloaded" / "rate limit" / "429" - Anthropic
 *     transient backpressure surfaced by the OAuth raw-fetch loop.
 *   - "500".."504" / "service unavailable" / "internal server error" -
 *     upstream 5xx; the request itself was fine.
 *   - "empty model output" / "no output" - the model returned nothing;
 *     often a transient hiccup, cheap to try once more.
 */
const RETRYABLE_MARKERS: readonly string[] = [
  "timed out",
  "timeout",
  "wall-clock",
  "aborterror",
  "aborted",
  "econnreset",
  "etimedout",
  "fetch failed",
  "socket hang up",
  "network",
  "stream error",
  "stream",
  "overloaded",
  "rate limit",
  "429",
  "500",
  "502",
  "503",
  "504",
  "service unavailable",
  "internal server error",
  "bad gateway",
  "gateway timeout",
  "empty model output",
  "no output",
  "returned no output",
];

/**
 * Substrings that mark a failure as permanent - retrying cannot help, so
 * escalate straight away. Checked FIRST: a non-retryable marker always
 * wins over a retryable one (e.g. a "permission denied" error that also
 * happens to contain "network" in its text must not be retried).
 *   - auth / permission / forbidden / 401 / 403 - the org's credentials
 *     or write-policy reject the action; a retry hits the same wall.
 *   - "no llm auth available" - executor's own "connect Claude Max"
 *     error; nothing to retry until a human wires up auth.
 *   - "requires human approval" - the run is blocked on the approvals
 *     inbox, not failed-transient.
 *   - bad request / invalid / 400 / 422 / schema / not found / 404 -
 *     malformed input or an impossible ask; the same input fails again.
 *   - "unsupported" / "not available" - asking for a tool/integration
 *     that does not exist for this org.
 */
const NON_RETRYABLE_MARKERS: readonly string[] = [
  "no llm auth available",
  "permission denied",
  "forbidden",
  "unauthorized",
  "401",
  "403",
  "requires human approval",
  "bad request",
  "invalid",
  "malformed",
  "400",
  "422",
  "schema",
  "not found",
  "404",
  "unsupported",
  "not available",
  "impossible",
];

/** Outcome of a retry decision. Exactly one of retry / escalate is true. */
export type RetryDecision = {
  /** Re-enqueue the run for another attempt. */
  retry: boolean;
  /** Stop retrying and write an escalation audit row for a human. */
  escalate: boolean;
  /** Human-readable why, recorded on the escalation audit row / logs. */
  reason: string;
  /** Backoff to wait before re-dispatch when `retry` is true; else 0. */
  backoffMs: number;
};

/** Minimal run shape this module needs - keeps it decoupled from RunRow. */
export type RetryableRun = {
  id: string;
  error?: string | null;
};

/**
 * Classify a failure string. Non-retryable markers are checked first so a
 * permanent failure is never masked by an incidental transient keyword.
 * An empty / unknown error string is treated as transient: we'd rather
 * burn one bounded retry than silently escalate a failure we can't read.
 */
function classifyError(error: string | null | undefined): {
  transient: boolean;
  reason: string;
} {
  const text = (error ?? "").toLowerCase().trim();
  if (text.length === 0) {
    return { transient: true, reason: "no error text recorded; treating as transient" };
  }
  for (const marker of NON_RETRYABLE_MARKERS) {
    if (text.includes(marker)) {
      return { transient: false, reason: `non-retryable failure (matched "${marker}")` };
    }
  }
  for (const marker of RETRYABLE_MARKERS) {
    if (text.includes(marker)) {
      return { transient: true, reason: `transient failure (matched "${marker}")` };
    }
  }
  // Unrecognised failure: be conservative and escalate rather than spend a
  // retry on something we can't reason about. The max-attempts bound would
  // catch it anyway, but escalating early gets a human on it sooner.
  return { transient: false, reason: "unrecognised failure; escalating for human review" };
}

/**
 * Decide what to do with a failed run.
 *
 * @param run          the failed run (only `id` + `error` are read)
 * @param attemptCount how many attempts have already completed, including
 *                     the one that just failed. The original run is
 *                     attempt 1, so the first failure arrives here as 1.
 *
 * Rules, in order:
 *   1. attempts exhausted (attemptCount >= MAX_ATTEMPTS) -> escalate.
 *   2. failure is non-retryable -> escalate immediately, no retry.
 *   3. otherwise -> retry with the backoff for the next attempt.
 *
 * The invariant `retry XOR escalate` always holds.
 */
export function shouldRetry(
  run: RetryableRun,
  attemptCount: number,
): RetryDecision {
  const attempts = Number.isFinite(attemptCount) && attemptCount > 0
    ? Math.floor(attemptCount)
    : 1;

  // Rule 1: hard stop. This is the bound that guarantees the loop ends.
  if (attempts >= MAX_ATTEMPTS) {
    return {
      retry: false,
      escalate: true,
      reason: `attempts exhausted (${attempts}/${MAX_ATTEMPTS}); escalating`,
      backoffMs: 0,
    };
  }

  // Rule 2: classify. A permanent failure escalates even with budget left.
  const { transient, reason } = classifyError(run.error);
  if (!transient) {
    return { retry: false, escalate: true, reason, backoffMs: 0 };
  }

  // Rule 3: transient + budget remaining -> retry.
  return {
    retry: true,
    escalate: false,
    reason: `${reason}; retrying (attempt ${attempts + 1}/${MAX_ATTEMPTS})`,
    backoffMs: backoffForAttempt(attempts),
  };
}
