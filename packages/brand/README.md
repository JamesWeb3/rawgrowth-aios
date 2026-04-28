# packages/brand

Path-shape stub committed in execution-plan §D3 + §D12. Real source of
truth lives at `src/lib/brand/`:

| Plan path | Real source |
|---|---|
| `packages/brand/tokens.ts` | `src/lib/brand/tokens.ts` (re-exported) |
| `packages/brand/eslint-banned-defaults.js` | rule body inline in `eslint.config.mjs` (`rawgrowth-brand/banned-tailwind-defaults`) |
| `packages/brand/eslint-banned-words.js` | rule body inline in `eslint.config.mjs` (`rawgrowth-brand/banned-words`) |

Single source of truth for everything brand-related is `src/lib/brand/`.
This directory exists so the doc paths from execution-plan §D3 (page 5)
and §D12 (page 9) resolve, and so a future move into a real workspace
package can land here without a consumer-facing import rewrite.

If you change a token, edit `src/lib/brand/tokens.ts`. If you change a
banned word, edit the same file (`BANNED_WORDS` const). The ESLint
plugin in `eslint.config.mjs` reads from there at lint time; the
runtime brand-voice filter in `src/lib/brand/runtime-filter.ts` reads
the same const at request time.
