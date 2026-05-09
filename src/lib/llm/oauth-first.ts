import { supabaseAdmin } from "@/lib/supabase/server";
import { tryDecryptSecret } from "@/lib/crypto";
import {
  chatComplete,
  type ChatRequest,
  type ChatResponse,
} from "@/lib/llm/provider";

/**
 * OAuth-first LLM dispatcher with token-pool rotation.
 *
 * Pedro hit Anthropic's per-IP / per-account 429 throttle on every
 * single token after a few minutes of demoing. The bug is documented
 * upstream (anthropics/claude-code#46037, #22876, #30930) and has no
 * official workaround other than an API key, which Pedro doesn't want
 * to ship.
 *
 * The rotation: read EVERY connected claude-max row in this org, put
 * the caller's own token first, and try them in order on 429. Each
 * row maps to a different Anthropic account (per-user OAuth landed
 * in 0063), so when the caller's bucket is empty we burn through any
 * other member's bucket that's idle. First success wins.
 *
 * Fallback chain:
 *   1. Pool of org's claude-max OAuth tokens (caller first, then rest)
 *   2. ANTHROPIC_API_KEY (env, paid)
 *   3. OPENAI_API_KEY (env, last resort)
 *   4. Throw LlmNotConfiguredError so the route returns 503
 *
 * 429 detection is string-match on "429" or "rate_limit_error" in the
 * thrown error message - matches what runClaudeMaxOauth surfaces.
 */

export class LlmNotConfiguredError extends Error {
  constructor() {
    super(
      "No LLM provider configured. Connect Claude Max at /connections, or set ANTHROPIC_API_KEY / OPENAI_API_KEY in the environment.",
    );
    this.name = "LlmNotConfiguredError";
  }
}

type ClaudeTokenRow = {
  id: string;
  user_id: string | null;
  metadata: Record<string, unknown> | null;
};

async function listClaudeOauthTokens(
  orgId: string,
  callerUserId?: string | null,
): Promise<string[]> {
  const { data, error } = await supabaseAdmin()
    .from("rgaios_connections")
    .select("id, user_id, metadata")
    .eq("organization_id", orgId)
    .eq("provider_config_key", "claude-max")
    .eq("status", "connected");
  if (error || !data) return [];

  const rows = data as ClaudeTokenRow[];
  // Caller's own row first (highest priority, hits their bucket before
  // borrowing anyone else's). Then the rest, deterministic by row id
  // so the rotation order stays stable across requests.
  const ordered = [...rows].sort((a, b) => {
    const aOwn = callerUserId && a.user_id === callerUserId ? 0 : 1;
    const bOwn = callerUserId && b.user_id === callerUserId ? 0 : 1;
    if (aOwn !== bOwn) return aOwn - bOwn;
    return a.id.localeCompare(b.id);
  });

  const tokens: string[] = [];
  for (const row of ordered) {
    const meta = (row.metadata ?? {}) as { access_token?: string };
    if (!meta.access_token) continue;
    const tok = tryDecryptSecret(meta.access_token);
    if (tok) tokens.push(tok);
  }
  return tokens;
}

/**
 * In-process cooldown for tokens we just saw 429 / 401 on. Anthropic's
 * IP / account buckets typically clear within 30-90s, so a 60s cooldown
 * keeps us from re-hitting a known-cold token while the pool rotates
 * around it. Map keyed on the access_token string itself; cleared on
 * process restart (cron-tick reboots the process when workers OOM).
 */
const TOKEN_COOLDOWN: Map<string, number> = new Map();
const COOLDOWN_MS = 60_000;

function isOnCooldown(token: string): boolean {
  const until = TOKEN_COOLDOWN.get(token);
  if (!until) return false;
  if (Date.now() >= until) {
    TOKEN_COOLDOWN.delete(token);
    return false;
  }
  return true;
}

function markCold(token: string): void {
  TOKEN_COOLDOWN.set(token, Date.now() + COOLDOWN_MS);
}

function isRateLimit(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /\b429\b/.test(msg) ||
    /rate_limit_error/i.test(msg) ||
    /Too Many Requests/i.test(msg)
  );
}

function isAuthFail(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /\b401\b/.test(msg) ||
    /authentication_error/i.test(msg) ||
    /Invalid authentication credentials/i.test(msg)
  );
}

export async function chatCompleteOAuthFirst(
  orgId: string,
  req: Omit<ChatRequest, "provider" | "claudeMaxOauthToken">,
  userId?: string | null,
): Promise<ChatResponse> {
  const tokens = await listClaudeOauthTokens(orgId, userId);

  // Two-pass: first try only tokens NOT on cooldown, then warm-up cold
  // ones if we ran out. Avoids burning cycles on tokens we just saw 429
  // on while the pool has fresh ones available.
  const passes: Array<(t: string) => boolean> = [
    (t) => !isOnCooldown(t),
    () => true,
  ];

  let lastErr: unknown = null;
  for (const filter of passes) {
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (!filter(tok)) continue;
      try {
        return await chatComplete({
          ...req,
          provider: "claude-max-oauth",
          claudeMaxOauthToken: tok,
        });
      } catch (err) {
        lastErr = err;
        // Rotate on 429 (rate limit) and 401 (expired/revoked token).
        // Anything else (network, abort, validation) bubbles up — those
        // aren't bucket-pressure failures and retrying the next token
        // wouldn't change the outcome.
        if (!isRateLimit(err) && !isAuthFail(err)) throw err;
        markCold(tok);
        console.warn(
          `[oauth-first] token ${i + 1}/${tokens.length} failed (${
            isRateLimit(err) ? "429" : "401"
          }), marked cold ${COOLDOWN_MS / 1000}s, trying next`,
        );
      }
    }
  }

  if (process.env.ANTHROPIC_API_KEY) {
    console.warn(
      "[oauth-first] all OAuth tokens exhausted, falling back to ANTHROPIC_API_KEY",
    );
    return chatComplete({ ...req, provider: "anthropic-api" });
  }

  if (process.env.OPENAI_API_KEY) {
    console.warn(
      "[oauth-first] all OAuth tokens exhausted, falling back to OPENAI",
    );
    return chatComplete({ ...req, provider: "openai" });
  }

  if (lastErr) throw lastErr;
  throw new LlmNotConfiguredError();
}
