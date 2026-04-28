/**
 * Plan §D3 + §D12 commit `packages/brand/eslint-banned-defaults.js`.
 * The active rule logic lives inline in `eslint.config.mjs` under the
 * local `rawgrowth-brand` plugin (banned-tailwind-defaults). This file
 * is the path-shape stub the plan promised; future moves into a real
 * monorepo workspace can land the rule body here without changing
 * the consumer config.
 *
 * Banned tokens enforced today (see eslint.config.mjs):
 *   - bg-blue-* / text-blue-* (Tailwind default blue)
 *   - bg-indigo-* / text-indigo-* (Tailwind default indigo)
 *   - shadow-md / shadow-lg / shadow-xl (flat shadow defaults)
 *   - transition-all (catches every property; we want explicit lists)
 */

module.exports = {
  // Re-exported by eslint.config.mjs; the actual create() is inlined
  // there so both this file and the config stay legible.
  meta: { type: "problem", docs: { description: "no Tailwind defaults per CTO brief §P08" } },
};
