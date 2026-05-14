/**
 * Shared raw-fetch caller for Anthropic's /v1/messages endpoint when
 * authenticating with a Claude Max OAuth token (sk-ant-oat01-*) instead
 * of an x-api-key.
 *
 * Why a hand-rolled fetch and not @ai-sdk/anthropic?
 *
 * The AI SDK's `createAnthropic({ authToken })` swap looks right on the
 * surface but its retry / wrapper layer was observed dropping the
 * `anthropic-beta: oauth-2025-04-20` header on retry attempts (Pedro's
 * Atlas demo, 2026-05-10): runs failed after ~6.5s with the opaque
 * "Failed after 3 attempts. Last error: Error" wrapper. Meanwhile the
 * agent-chat path (lib/agent/chat.ts) using a literal fetch with the
 * same token + headers worked end-to-end. Rather than patch around an
 * opaque SDK regression, both code paths now share this helper so the
 * exact wire shape that proven-works in chat.ts is what executor.ts
 * also sends.
 *
 * Two layers exposed:
 *   - `callAnthropicOauthOnce`  - single /v1/messages call, returns
 *     parsed JSON or throws AnthropicHttpError with status + body.
 *   - `runOauthToolLoop`  - executor-style multi-turn loop with token
 *     pool rotation, 60s cooldown, optional native tool execution.
 *
 * chat.ts calls `callAnthropicOauthOnce` directly inside its existing
 * pool-rotation. executor.ts calls `runOauthToolLoop` so it gets the
 * same rotation primitives without re-implementing them.
 */

export const CLAUDE_OAUTH_BETA_HEADER = "oauth-2025-04-20";
export const ANTHROPIC_VERSION = "2023-06-01";
export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

/**
 * Anthropic's OAuth gate REQUIRES the system prompt to start with this
 * exact identity line - any other content before it returns 401 "OAuth
 * authentication is currently not supported." Both chat.ts and the
 * executor prepend this line before sending.
 */
export const CLAUDE_CODE_PREFIX =
  "You are Claude Code, Anthropic's official CLI for Claude.";

export type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
};

export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string | Array<{ type: "text"; text: string }>;
      is_error?: boolean;
    };

export type AnthropicTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type AnthropicMessageResponse = {
  id: string;
  content: AnthropicContentBlock[];
  stop_reason: string;
  model: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
};

export class AnthropicHttpError extends Error {
  readonly status: number;
  readonly body: string;
  /**
   * Seconds the server told us to wait before retrying. Parsed from the
   * `retry-after` header. Null when the header is absent (some 5xx) or
   * malformed. Callers should prefer this over a fixed cooldown.
   */
  readonly retryAfterSec: number | null;
  /**
   * Reset hints from anthropic-ratelimit-* headers when present. Lets
   * us schedule a token's "warm at" time precisely rather than guess
   * with a flat 5-min cooldown that was too aggressive in practice.
   */
  readonly resetAt: number | null;
  constructor(
    status: number,
    body: string,
    retryAfterSec: number | null = null,
    resetAt: number | null = null,
  ) {
    super(`Anthropic ${status}: ${body.slice(0, 300)}`);
    this.name = "AnthropicHttpError";
    this.status = status;
    this.body = body;
    this.retryAfterSec = retryAfterSec;
    this.resetAt = resetAt;
  }
}

export type CallAnthropicOauthOpts = {
  token: string;
  model: string;
  /**
   * The system field. Caller is responsible for ensuring it starts with
   * CLAUDE_CODE_PREFIX (or matches it exactly) - this helper does not
   * silently rewrite it because chat.ts and executor.ts both already
   * have their own preamble construction.
   */
  system: string;
  messages: AnthropicMessage[];
  maxTokens: number;
  tools?: AnthropicTool[];
  /** Default 60s. */
  timeoutMs?: number;
  /**
   * Optional caller-supplied AbortSignal. Combined with the timeout via
   * AbortSignal.any when both are present.
   */
  abortSignal?: AbortSignal;
};

/**
 * One round-trip to /v1/messages. Returns parsed body on 2xx, throws
 * AnthropicHttpError on non-2xx (caller decides whether to rotate).
 * Network errors propagate as the original Error (caller distinguishes
 * by `instanceof AnthropicHttpError`).
 */
export async function callAnthropicOauthOnce(
  opts: CallAnthropicOauthOpts,
): Promise<AnthropicMessageResponse> {
  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens,
    system: opts.system,
    messages: opts.messages,
  };
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools;
  }

  // Stack the timeout + caller's abort. AbortSignal.any landed in
  // Node 20.3 / 21+ - the runtime targets are Node 22 (Next 16 baseline)
  // so this is safe.
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = opts.abortSignal
    ? AbortSignal.any([timeoutSignal, opts.abortSignal])
    : timeoutSignal;

  const r = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${opts.token}`,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-beta": CLAUDE_OAUTH_BETA_HEADER,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    // Capture the server's actual hint instead of guessing with a fixed
    // cooldown. retry-after is in seconds (RFC 7231 §7.1.3). The
    // anthropic-ratelimit-*-reset headers carry RFC 3339 timestamps for
    // when each bucket resets - we pick the soonest non-null one.
    const retryAfterRaw = r.headers.get("retry-after");
    const retryAfterSec = retryAfterRaw && /^\d+$/.test(retryAfterRaw)
      ? Number(retryAfterRaw)
      : null;
    const resetTimestamps: number[] = [];
    for (const h of [
      "anthropic-ratelimit-requests-reset",
      "anthropic-ratelimit-input-tokens-reset",
      "anthropic-ratelimit-output-tokens-reset",
      "anthropic-ratelimit-tokens-reset",
    ]) {
      const v = r.headers.get(h);
      if (!v) continue;
      const t = Date.parse(v);
      if (!Number.isNaN(t)) resetTimestamps.push(t);
    }
    const resetAt = resetTimestamps.length > 0 ? Math.min(...resetTimestamps) : null;
    throw new AnthropicHttpError(r.status, text, retryAfterSec, resetAt);
  }
  return (await r.json()) as AnthropicMessageResponse;
}

// ─── Multi-turn tool loop with pool rotation ────────────────────────

/**
 * Per-token cooldown driven by the server's actual hint, not a guess.
 *
 * Anthropic returns:
 *   - retry-after: <seconds>     ← RFC 7231 standard, exact wait time
 *   - anthropic-ratelimit-*-reset: <ISO ts>  ← bucket reset times
 *
 * We use the soonest of those when present. Falls back to a 30s floor
 * when both are missing. A flat 5min was wrong: most 429s on Claude
 * Max OAuth resolve in seconds (RPM bucket), not minutes (daily quota).
 *
 * Cap on the high end keeps a misbehaving header from parking a token
 * for a literal day. Map keyed on the access_token, cleared on restart.
 */
const TOKEN_COOLDOWN: Map<string, number> = new Map();
const DEFAULT_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_MS = 60 * 60_000;

function isTokenCold(token: string): boolean {
  const until = TOKEN_COOLDOWN.get(token);
  if (!until) return false;
  if (Date.now() >= until) {
    TOKEN_COOLDOWN.delete(token);
    return false;
  }
  return true;
}

function markTokenCold(
  token: string,
  retryAfterSec: number | null = null,
  resetAt: number | null = null,
): void {
  // Pick the most informative hint we got. retry-after is server's
  // direct instruction; reset header is the bucket clock; fall back
  // to a short default. Bounded to MAX_COOLDOWN_MS so a buggy header
  // can't take a token offline indefinitely.
  let waitMs: number;
  if (typeof retryAfterSec === "number" && retryAfterSec > 0) {
    waitMs = retryAfterSec * 1000;
  } else if (typeof resetAt === "number" && resetAt > Date.now()) {
    waitMs = resetAt - Date.now();
  } else {
    waitMs = DEFAULT_COOLDOWN_MS;
  }
  waitMs = Math.min(Math.max(waitMs, 5_000), MAX_COOLDOWN_MS);
  TOKEN_COOLDOWN.set(token, Date.now() + waitMs);
}

export type OauthToolDef = {
  /** Anthropic native tool definition the model sees. */
  spec: AnthropicTool;
  /** Server-side execution. Return value is stringified for tool_result. */
  execute: (args: Record<string, unknown>) => Promise<string>;
};

export type ToolCallTrace = {
  name: string;
  isError?: boolean;
};

export type RunOauthToolLoopOpts = {
  /**
   * Pool of decrypted Claude Max access tokens, ordered by caller's
   * preference (e.g. callerUserId first, then shuffled rest). Helper
   * walks two passes: cold-skip first, then everything.
   */
  tokens: string[];
  model: string;
  /**
   * System prompt - helper prepends CLAUDE_CODE_PREFIX automatically
   * if it isn't already at the start.
   */
  system: string;
  userMessage: string;
  /** Map of tool name → spec + execute. Empty / undefined disables tools. */
  tools?: Record<string, OauthToolDef>;
  /** Hard cap on assistant turns (each iteration burns one). */
  maxSteps: number;
  maxTokens?: number;
  abortSignal?: AbortSignal;
  /**
   * Optional callback fired on a token's 401 after the first failure.
   * Should attempt a refresh and return the new token (or null). The
   * loop swaps the failed token in-place and retries once.
   */
  onTokenAuthError?: (failedToken: string) => Promise<string | null>;
  /** Optional logger prefix - default "[oauth-anthropic]". */
  logPrefix?: string;
};

export type RunOauthToolLoopResult = {
  text: string;
  stopReason: string;
  steps: number;
  toolCalls: ToolCallTrace[];
};

function isRotateStatus(status: number): boolean {
  return status === 401 || status === 429;
}

function classifyAndLog(
  err: unknown,
  prefix: string,
  i: number,
  total: number,
): { rotate: boolean; status: number | null } {
  if (err instanceof AnthropicHttpError) {
    const rotate =
      isRotateStatus(err.status) || (err.status >= 500 && err.status < 600);
    console.warn(
      `${prefix} token ${i + 1}/${total} returned ${err.status}, ${rotate ? "rotating" : "fatal"}: ${err.body.slice(0, 200)}`,
    );
    return { rotate, status: err.status };
  }
  // Network / timeout / abort. Rotate (a different account / region might work).
  console.warn(
    `${prefix} token ${i + 1}/${total} threw ${(err as Error).message?.slice(0, 200) ?? "unknown"}, rotating`,
  );
  return { rotate: true, status: null };
}

/**
 * Run a multi-turn agent loop against /v1/messages with OAuth tokens.
 *
 * Flow per iteration:
 *   1. Try the current pool order; first 2xx wins for THIS turn.
 *   2. Inspect response.content - if it contains tool_use blocks AND
 *      the tools dict has entries, execute each, append a user turn
 *      with the matching tool_result blocks, loop again.
 *   3. If no tool_use OR tools disabled, concatenate text blocks and
 *      return.
 *
 * Keeps a fresh pool order per turn (cold tokens may have warmed back
 * up between turns), but a SUCCESSFUL token is sticky for the loop -
 * subsequent turns try it first to keep one Anthropic account on the
 * full conversation when possible.
 */
export async function runOauthToolLoop(
  opts: RunOauthToolLoopOpts,
): Promise<RunOauthToolLoopResult> {
  if (opts.tokens.length === 0) {
    throw new Error(
      "runOauthToolLoop: tokens pool is empty. Connect Claude Max at /connections.",
    );
  }
  const prefix = opts.logPrefix ?? "[oauth-anthropic]";
  const maxTokens = opts.maxTokens ?? 4096;
  const system = opts.system.startsWith(CLAUDE_CODE_PREFIX)
    ? opts.system
    : `${CLAUDE_CODE_PREFIX}\n\n${opts.system}`;
  const toolSpecs = opts.tools
    ? Object.values(opts.tools).map((t) => t.spec)
    : undefined;

  const messages: AnthropicMessage[] = [
    { role: "user", content: opts.userMessage },
  ];
  const toolCalls: ToolCallTrace[] = [];
  let stickyToken: string | null = null;
  let lastResponse: AnthropicMessageResponse | null = null;

  for (let step = 0; step < opts.maxSteps; step++) {
    // Build per-turn pool order: sticky token first if still warm, then
    // the rest in caller-supplied order.
    const ordered: string[] = [];
    if (stickyToken && opts.tokens.includes(stickyToken)) {
      ordered.push(stickyToken);
    }
    for (const t of opts.tokens) {
      if (t !== stickyToken) ordered.push(t);
    }

    let resp: AnthropicMessageResponse | null = null;
    let lastErr: unknown = null;
    let usedToken: string | null = null;
    outer: for (const filter of [
      (t: string) => !isTokenCold(t),
      () => true,
    ]) {
      for (let i = 0; i < ordered.length; i++) {
        const tok = ordered[i];
        if (!filter(tok)) continue;
        try {
          resp = await callAnthropicOauthOnce({
            token: tok,
            model: opts.model,
            system,
            messages,
            tools: toolSpecs,
            maxTokens,
            abortSignal: opts.abortSignal,
          });
          usedToken = tok;
          break outer;
        } catch (err) {
          lastErr = err;
          // 401 special case: try a refresh once on this token slot
          // before rotating. Mirrors chat.ts behavior.
          if (
            err instanceof AnthropicHttpError &&
            err.status === 401 &&
            opts.onTokenAuthError
          ) {
            const fresh = await opts.onTokenAuthError(tok).catch(() => null);
            if (fresh) {
              try {
                resp = await callAnthropicOauthOnce({
                  token: fresh,
                  model: opts.model,
                  system,
                  messages,
                  tools: toolSpecs,
                  maxTokens,
                  abortSignal: opts.abortSignal,
                });
                usedToken = fresh;
                break outer;
              } catch (err2) {
                lastErr = err2;
              }
            }
          }
          const c = classifyAndLog(err, prefix, i, ordered.length);
          if (!c.rotate) throw err;
          // Use server's actual retry-after / reset hint instead of a
          // fixed cooldown. err is AnthropicHttpError here (rotate=true
          // implies status was 401 or 429).
          const httpErr = err instanceof AnthropicHttpError ? err : null;
          markTokenCold(tok, httpErr?.retryAfterSec ?? null, httpErr?.resetAt ?? null);
        }
      }
    }

    if (!resp) {
      // Whole pool exhausted on this turn. If the last failure was a
      // 429 we surface the operator-actionable copy spec'd in the
      // 2026-05-13 fix; otherwise propagate the underlying error so
      // network / 5xx / validation failures stay debuggable.
      const isRateLimited =
        lastErr instanceof AnthropicHttpError && lastErr.status === 429;
      if (isRateLimited) {
        throw new Error(
          "Claude Max quota exhausted - all OAuth tokens cooling down. Operator should add more accounts to /connections.",
        );
      }
      if (lastErr instanceof Error) throw lastErr;
      throw new Error(`${prefix} pool exhausted with no response`);
    }
    lastResponse = resp;
    stickyToken = usedToken;

    // Inspect for tool_use. If none OR tools disabled, finish.
    const toolUses = resp.content.filter(
      (b): b is Extract<AnthropicContentBlock, { type: "tool_use" }> =>
        b.type === "tool_use",
    );
    if (!opts.tools || toolUses.length === 0) {
      const text = resp.content
        .filter(
          (b): b is Extract<AnthropicContentBlock, { type: "text" }> =>
            b.type === "text",
        )
        .map((b) => b.text)
        .join("\n\n")
        .trim();
      return {
        text,
        stopReason: resp.stop_reason,
        steps: step + 1,
        toolCalls,
      };
    }

    // Append assistant turn (the full content blocks) so subsequent
    // tool_result blocks reference the right tool_use_ids. Anthropic
    // requires the assistant message that produced tool_use to be in
    // history before the user reply with tool_result.
    messages.push({ role: "assistant", content: resp.content });

    // Execute every tool_use in parallel, build a single user turn with
    // all the tool_result blocks. Failures become is_error=true blocks
    // so the model can see what broke and react.
    const results = await Promise.all(
      toolUses.map(async (use) => {
        const def = opts.tools![use.name];
        if (!def) {
          toolCalls.push({ name: use.name, isError: true });
          return {
            type: "tool_result" as const,
            tool_use_id: use.id,
            content: `Unknown tool: ${use.name}`,
            is_error: true,
          };
        }
        try {
          const out = await def.execute(use.input ?? {});
          toolCalls.push({ name: use.name, isError: false });
          return {
            type: "tool_result" as const,
            tool_use_id: use.id,
            content: out,
          };
        } catch (err) {
          toolCalls.push({ name: use.name, isError: true });
          return {
            type: "tool_result" as const,
            tool_use_id: use.id,
            content: `Tool ${use.name} failed: ${(err as Error).message}`,
            is_error: true,
          };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }

  // Hit MAX_STEPS without the model emitting a tool-free reply. Return
  // whatever text the last response had so the run row records something
  // useful instead of silently throwing.
  const text =
    lastResponse?.content
      .filter(
        (b): b is Extract<AnthropicContentBlock, { type: "text" }> =>
          b.type === "text",
      )
      .map((b) => b.text)
      .join("\n\n")
      .trim() ?? "";
  return {
    text:
      text ||
      `[max_steps=${opts.maxSteps} hit without final answer; ${toolCalls.length} tool calls executed]`,
    stopReason: lastResponse?.stop_reason ?? "max_steps",
    steps: opts.maxSteps,
    toolCalls,
  };
}
