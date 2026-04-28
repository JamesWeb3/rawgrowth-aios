/**
 * Brand tokens shim.
 *
 * Execution plan §D3 + §D12 commit to the path
 * `packages/brand/tokens.ts` as the canonical brand-token surface.
 * The shipped implementation lives under `src/lib/brand/tokens.ts`
 * (no monorepo workspace landed for the trial timeline). Keep this
 * file as a thin re-export so any tooling, doc reader, or eslint
 * config that follows the plan path resolves to the same source of
 * truth instead of forking the value.
 */
export * from "../../src/lib/brand/tokens";
