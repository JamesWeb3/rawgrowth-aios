/**
 * Plan §D12 commit `packages/brand/eslint-banned-words.js`. Banned-word
 * list is single-sourced in `src/lib/brand/tokens.ts` (BANNED_WORDS)
 * and the ESLint rule body lives inline in `eslint.config.mjs` under
 * the local `rawgrowth-brand/banned-words` rule. This file is the
 * path-shape stub the plan promised.
 *
 * Brief §12 banned list (11 words, frozen):
 *   game-changer, unlock, leverage, utilize, deep dive, revolutionary,
 *   cutting-edge, synergy, streamline, empower, certainly.
 */

module.exports = {
  meta: { type: "problem", docs: { description: "no banned brand voice words per CTO brief §12" } },
};
