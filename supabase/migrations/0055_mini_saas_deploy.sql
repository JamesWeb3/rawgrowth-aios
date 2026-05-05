-- Mini SaaS: live Vercel deploys.
--
-- Chris's ask (May 4): "should automatically deploy to Vercel for them".
-- v0 stored generated_html and rendered it in an iframe sandbox - good for
-- preview, useless for sharing. This migration adds the two columns the
-- /api/mini-saas/[id]/deploy route writes after a successful Vercel REST
-- create:
--   - deployed_url: the public *.vercel.app URL (or null if never shipped)
--   - deployed_at:  last successful deploy timestamp; doubles as the
--                   "is this live?" gate the UI flips on
--
-- The Vercel deploy itself happens in the API route (POST
-- https://api.vercel.com/v13/deployments with files: [{file:'index.html',
-- data:<base64>}]). VERCEL_TOKEN is per-fleet env, no per-org config yet.

alter table rgaios_mini_saas
  add column if not exists deployed_url text,
  add column if not exists deployed_at  timestamptz;

create index if not exists idx_rgaios_mini_saas_deployed_at
  on rgaios_mini_saas (organization_id, deployed_at desc nulls last);
