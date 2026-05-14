import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

import { BANNED_WORDS } from "./tokens";
import { shouldEnforceEnglishBrandVoice, type LocaleHint } from "./language";

/**
 * Runtime brand-voice guard. Build-time eslint-banned-words.mjs catches
 * source literals; this module catches LLM-generated text that reaches
 * user-facing surfaces at request time. Applied to:
 *   - telegram_reply (src/lib/mcp/tools/telegram.ts): before sending
 *   - any future outbound copy tool that lands in Slack/email/chat
 *
 * Two-pass flow per CTO brief §P09:
 *   1. checkBrandVoice scans once, case-insensitive, word-boundary aware.
 *      Returns {ok:false, hits, rewritten} where `rewritten` is the
 *      string-level fallback (substring substitution) so callers always
 *      have a sanitised payload to log even if regen fails.
 *   2. regenerateWithBrandReminder retries the copy via Claude with an
 *      explicit "do not use these words" reminder, then re-runs
 *      checkBrandVoice on the result. Returns {ok:true,text} on a clean
 *      pass-2 or {ok:false, hits, finalAttempt} so the caller can
 *      hard-fail and surface to the operator.
 *
 * Language awareness:
 *   The 11 banned words + their REPLACEMENTS map are English. For a
 *   non-English client (e.g. Marti Fox / InstaCEO Academy, Polish) the
 *   substring substitution is at best a no-op and the regen pass can
 *   actively mangle correct Polish copy. Every entry point therefore
 *   takes an optional `lang` hint and, when it can tell the text is not
 *   English, skips the destructive path entirely - the text is returned
 *   untouched and flagged `skipped: "non-english"` so callers can log it
 *   without rewriting it. Passing no hint preserves the original
 *   behaviour for plain-English ASCII copy (see ./language.ts).
 */

const REPLACEMENTS: Record<string, string> = {
  "game-changer": "big deal",
  unlock: "open",
  leverage: "use",
  utilize: "use",
  "deep dive": "close look",
  revolutionary: "new",
  "cutting-edge": "current",
  synergy: "fit",
  streamline: "simplify",
  empower: "equip",
  certainly: "yes",
};

function buildPattern() {
  const escaped = BANNED_WORDS.map((w) =>
    w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"),
  );
  return new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
}

const PATTERN = buildPattern();

export type BrandFilterResult =
  | {
      ok: true;
      /**
       * Set to "non-english" when the banned-word enforcement was
       * intentionally skipped because the text is not English. The text
       * is unchanged; callers should ship it as-is and must NOT run a
       * regen pass on it. Absent on a normal clean English pass.
       */
      skipped?: "non-english";
    }
  | {
      ok: false;
      hits: string[];
      rewritten: string;
    };

/**
 * Scan `text` for the 11 English banned words.
 *
 * @param lang Optional locale hint (BCP-47-ish, e.g. "en", "pl-PL").
 *   When omitted the text is auto-classified by a cheap heuristic
 *   (diacritics + Polish stopwords). When the text is determined to be
 *   non-English the English enforcement is skipped and `{ok:true,
 *   skipped:"non-english"}` is returned - the English path is unchanged.
 */
export function checkBrandVoice(
  text: string,
  lang?: LocaleHint,
): BrandFilterResult {
  if (!shouldEnforceEnglishBrandVoice(text, lang)) {
    return { ok: true, skipped: "non-english" };
  }

  const hits = new Set<string>();
  let rewritten = text;

  rewritten = text.replace(PATTERN, (match) => {
    const lower = match.toLowerCase();
    hits.add(lower);
    const repl = REPLACEMENTS[lower] ?? "";
    // Preserve casing of the first char so the result reads naturally.
    if (!repl) return match;
    if (match[0] === match[0].toUpperCase()) {
      return repl[0].toUpperCase() + repl.slice(1);
    }
    return repl;
  });

  if (hits.size === 0) return { ok: true };
  return { ok: false, hits: [...hits], rewritten };
}

// ─── Pass-2 regenerate ─────────────────────────────────────────────

export type RegenerateResult =
  | { ok: true; text: string }
  | { ok: false; hits: string[]; finalAttempt: string };

export type RegenerateContext = {
  /** Optional: forwarded to telemetry by callers that have it. */
  organizationId?: string;
  agentId?: string | null;
  /**
   * Test injection seam. Default invokes Anthropic via the AI SDK with a
   * 10s AbortController timeout. Tests pass a stub to avoid the network.
   */
  invoke?: (args: {
    system: string;
    prompt: string;
    signal: AbortSignal;
  }) => Promise<{ text: string }>;
};

/** Brief §P09: 10s upper bound so a stuck regen never wedges Telegram. */
const REGEN_TIMEOUT_MS = 10_000;

/**
 * Pass-2 of the brand-voice guard. Re-asks Claude for a clean rewrite
 * with the banned-word list spelled out, then runs the result through
 * checkBrandVoice again. The caller is expected to:
 *   - on `ok:true` → ship the rewritten text;
 *   - on `ok:false` → write an audit_log row of kind brand_voice_hard_fail
 *     with the returned `hits` + `finalAttempt`, and refuse to send.
 *
 * Model: claude-haiku-4-5  -  cheapest + fastest in the family. Brief §02
 * already permits per-call model selection independent of agent runtime.
 *
 * Failure modes folded into ok:false:
 *   - regen request throws (network, 5xx, abort, timeout)
 *   - regen returns text that still trips checkBrandVoice
 * In both cases `finalAttempt` carries the substring-sanitised version of
 * the best string we have so the operator can see what would have shipped.
 */
export async function regenerateWithBrandReminder(
  originalText: string,
  hits: string[],
  ctx: RegenerateContext = {},
  lang?: LocaleHint,
): Promise<RegenerateResult> {
  // Defensive: the regen prompt is English-only and asks Claude to
  // rewrite around English banned words. Running it on non-English copy
  // can corrupt otherwise-correct text, so bail out and hand the
  // original back untouched. Well-behaved callers (applyBrandFilter)
  // never get here for non-English text, but tool code that calls the
  // two passes directly might.
  if (!shouldEnforceEnglishBrandVoice(originalText, lang)) {
    return { ok: true, text: originalText };
  }

  const banList = BANNED_WORDS.map((w) => `"${w}"`).join(", ");
  const hitsLine = hits.length
    ? `Specifically, the prior draft used: ${hits.map((h) => `"${h}"`).join(", ")}. Do not use any of these.`
    : "";
  const system = `You are a brand-voice editor. The text below contains words that violate the §12 banned list. Rewrite it removing all such words. Preserve meaning, tone, and length. Return ONLY the rewritten text, no preamble or explanation. Banned words: ${banList}.`;
  const prompt = `${hitsLine}\n\nRewrite this:\n\n${originalText}`;

  const invoke = ctx.invoke ?? defaultInvoke;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REGEN_TIMEOUT_MS);

  let regenerated: string;
  try {
    const out = await invoke({ system, prompt, signal: ctl.signal });
    regenerated = out.text.trim();
  } catch {
    // Network / timeout / abort  -  fall back to the substring-sanitised
    // version of the original so the operator-bound audit row is at least
    // free of banned words.
    const fallback = checkBrandVoice(originalText, lang);
    return {
      ok: false,
      hits,
      finalAttempt: fallback.ok ? originalText : fallback.rewritten,
    };
  } finally {
    clearTimeout(timer);
  }

  const second = checkBrandVoice(regenerated, lang);
  if (second.ok) return { ok: true, text: regenerated };
  return { ok: false, hits: second.hits, finalAttempt: second.rewritten };
}

async function defaultInvoke({
  system,
  prompt,
  signal,
}: {
  system: string;
  prompt: string;
  signal: AbortSignal;
}): Promise<{ text: string }> {
  const result = await generateText({
    model: anthropic("claude-haiku-4-5"),
    system,
    prompt,
    abortSignal: signal,
  });
  return { text: result.text };
}
