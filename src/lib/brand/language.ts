/**
 * Language awareness for the brand-voice guard.
 *
 * The 11 banned words in tokens.ts are English. The runtime filter's
 * substring substitution + Claude regen pass only make sense for English
 * copy. Marti Fox / InstaCEO Academy is a Polish client, so most agent
 * output is Polish - running the English enforcement on it either does
 * nothing useful or, via the regen pass, mangles correct Polish copy.
 *
 * This module gives the filter a cheap, dependency-free way to decide
 * "is this text English enough to safely enforce the English banned-word
 * list?". Callers that already know the org locale can pass a hint and
 * skip the heuristic entirely.
 */

/**
 * Locale hint a caller may pass through to the brand filter. `undefined`
 * means "no hint, use the heuristic". A BCP-47-ish string ("en", "pl",
 * "en-US", "pl-PL") is matched on its primary subtag.
 */
export type LocaleHint = string | undefined;

/**
 * Latin letters carrying diacritics that English never uses but Polish
 * (and most other European languages) do. Their presence is a strong
 * "not English" signal.
 */
const NON_ENGLISH_DIACRITICS = /[ąćęłńóśźżäöüßàâçéèêëîïôûùÿñõáíúâêôûãàèìòù]/i;

/**
 * High-frequency Polish function words. These are short and unambiguous
 * enough that even one or two in a sentence reliably means the text is
 * Polish, not English. Kept small on purpose - this is a guard rail, not
 * a language classifier.
 */
const POLISH_STOPWORDS = new Set([
  "i",
  "w",
  "na",
  "do",
  "nie",
  "to",
  "się",
  "że",
  "z",
  "jest",
  "jak",
  "co",
  "dla",
  "od",
  "po",
  "ale",
  "lub",
  "czy",
  "być",
  "ma",
  "masz",
  "twój",
  "twoja",
  "twoje",
  "jego",
  "jej",
  "oraz",
  "tylko",
  "już",
  "może",
  "więc",
  "dziś",
  "tutaj",
]);

/**
 * Returns the primary subtag of a BCP-47-ish locale string, lower-cased.
 * `"en-US"` -> `"en"`, `"pl"` -> `"pl"`, `""`/garbage -> `""`.
 */
function primarySubtag(locale: string): string {
  return locale.trim().toLowerCase().split(/[-_]/)[0] ?? "";
}

/**
 * Decide whether the English banned-word enforcement should run on this
 * text.
 *
 * Resolution order:
 *   1. If `hint` is given, trust it. Primary subtag `"en"` -> enforce.
 *      Any other explicit locale (`"pl"`, `"de"`, ...) -> skip.
 *   2. No hint -> heuristic on the text itself:
 *      - any Polish/European diacritic        -> not English -> skip
 *      - any Polish stopword among the tokens -> not English -> skip
 *      - otherwise                            -> treat as English -> enforce
 *
 * The heuristic is deliberately biased towards "English" for plain ASCII
 * text with no Polish stopwords: that keeps the existing English path
 * byte-for-byte unchanged, while still catching the common Polish cases
 * (Polish always sprinkles diacritics and stopwords in real copy).
 */
export function shouldEnforceEnglishBrandVoice(
  text: string,
  hint?: LocaleHint,
): boolean {
  if (hint != null && hint.trim() !== "") {
    return primarySubtag(hint) === "en";
  }

  if (NON_ENGLISH_DIACRITICS.test(text)) return false;

  const tokens = text.toLowerCase().match(/[\p{L}]+/gu);
  if (tokens) {
    for (const tok of tokens) {
      if (POLISH_STOPWORDS.has(tok)) return false;
    }
  }

  return true;
}
