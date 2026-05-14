import { supabaseAdmin } from "@/lib/supabase/server";
import {
  checkBrandVoice,
  regenerateWithBrandReminder,
} from "@/lib/brand/runtime-filter";

export type ApplyBrandFilterResult =
  | { ok: true; text: string; regenerated: boolean }
  | { ok: false; hits: string[]; finalAttempt: string; error: string };

/**
 * Two-pass brand-voice guard wrapped for any outbound LLM-text surface.
 * Brief §P09 + §12. Was inlined inside telegram_reply; lifted here so
 * slack_post_message, gmail_send_message, and any future surface get
 * the same protection without copy-paste.
 *
 *   1. checkBrandVoice on raw text. If clean, return as-is.
 *   2. regenerateWithBrandReminder (Haiku, 10s timeout, explicit
 *      "do not use these words"). If clean after regen, return the
 *      rewrite + audit kind=brand_voice_regenerated so the activity
 *      feed shows the trip.
 *   3. Hard-fail: audit kind=brand_voice_hard_fail and return ok:false
 *      so the caller refuses to send + surfaces a tool error.
 *
 * Language awareness: the banned-word list is English. For a non-English
 * client (Marti Fox / InstaCEO Academy is Polish) the regen pass would
 * mangle correct copy, so `ctx.lang` lets a caller pin the org locale.
 * When the text reads as non-English (explicit hint or heuristic),
 * checkBrandVoice short-circuits with `skipped:"non-english"` and this
 * function returns the text untouched, never reaching the regen path.
 */
export async function applyBrandFilter(
  text: string,
  ctx: {
    organizationId: string;
    agentId?: string | null;
    surface: string;
    /**
     * Optional locale hint (BCP-47-ish, e.g. "en", "pl-PL"). Forwarded
     * to checkBrandVoice / regenerateWithBrandReminder. Omit it to let
     * the cheap diacritics + Polish-stopword heuristic classify the
     * text; pass it when the org locale is known for a reliable result.
     */
    lang?: string;
  },
): Promise<ApplyBrandFilterResult> {
  const raw = text.trim();
  if (!raw) {
    return { ok: true, text: raw, regenerated: false };
  }

  const firstPass = checkBrandVoice(raw, ctx.lang);
  if (firstPass.ok) {
    return { ok: true, text: raw, regenerated: false };
  }

  console.warn(
    `[${ctx.surface}] brand-voice pass-1 hit: ${firstPass.hits.join(",")}, regenerating`,
  );
  const regen = await regenerateWithBrandReminder(
    raw,
    firstPass.hits,
    {
      organizationId: ctx.organizationId,
      agentId: ctx.agentId ?? null,
    },
    ctx.lang,
  );

  if (!regen.ok) {
    console.error(
      `[${ctx.surface}] brand-voice hard-fail after pass-2: ${regen.hits.join(",")}`,
    );
    await supabaseAdmin()
      .from("rgaios_audit_log")
      .insert({
        organization_id: ctx.organizationId,
        kind: "brand_voice_hard_fail",
        actor_type: "system",
        actor_id: ctx.surface,
        detail: {
          agent_id: ctx.agentId ?? null,
          original_excerpt: raw.slice(0, 500),
          final_attempt_excerpt: regen.finalAttempt.slice(0, 500),
          hits_first: firstPass.hits,
          hits_second: regen.hits,
        },
      });
    return {
      ok: false,
      hits: regen.hits,
      finalAttempt: regen.finalAttempt,
      error: `Brand voice guard: copy still contained banned words after one regeneration. Operator review needed. Hits: ${regen.hits.join(", ")}`,
    };
  }

  await supabaseAdmin()
    .from("rgaios_audit_log")
    .insert({
      organization_id: ctx.organizationId,
      kind: "brand_voice_regenerated",
      actor_type: "system",
      actor_id: ctx.surface,
      detail: {
        agent_id: ctx.agentId ?? null,
        hits_first: firstPass.hits,
        original_excerpt: raw.slice(0, 500),
        final_excerpt: regen.text.slice(0, 500),
      },
    });
  return { ok: true, text: regen.text, regenerated: true };
}
