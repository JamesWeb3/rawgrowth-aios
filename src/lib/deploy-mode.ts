/**
 * Deploy-mode flag. Read once; used to branch behaviour between SKUs.
 *
 *   hosted       - Vercel + Supabase Cloud, executor runs with Anthropic API
 *   self_hosted  - Per-client VPS, own Postgres, agents driven by Claude Code via MCP
 *   v3           - Per-client VPS app, shared Supabase, Claude Code CLI primary +
 *                  Anthropic API (Commercial) fallback. Multi-tenant RLS.
 */

export type DeployMode = "hosted" | "self_hosted" | "v3";

export const DEPLOY_MODE: DeployMode = (() => {
  const raw = process.env.DEPLOY_MODE as DeployMode | undefined;
  if (raw === "self_hosted" || raw === "v3") return raw;
  return "hosted";
})();

export const isSelfHosted = DEPLOY_MODE === "self_hosted";
export const isHosted = DEPLOY_MODE === "hosted";
export const isV3 = DEPLOY_MODE === "v3";

/**
 * True when tenant isolation comes from Supabase RLS, false when it comes from
 * the single-org-per-VPS DB trigger. v3 and hosted use RLS; self_hosted uses
 * the trigger (one VPS = one org, no mixing).
 */
export const usesSharedSupabase = DEPLOY_MODE === "hosted" || DEPLOY_MODE === "v3";
