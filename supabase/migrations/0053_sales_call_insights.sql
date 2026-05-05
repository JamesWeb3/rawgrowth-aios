-- Sales-call structured insights (post-transcribe LLM extraction).
--
-- After Whisper produces a transcript in /api/onboarding/sales-calls/upload,
-- a background `after()` step calls extractInsights() which returns:
--   - top 3 objections (verbatim where possible)
--   - top 3 pain points
--   - buying signals (positive intent markers)
--   - stuck points (rep struggles)
--   - product-fit gaps (what prospect asked for, we don't ship)
--   - suggested follow-up actions (concrete, owner-able)
--
-- The full structured object lives in `insights` (jsonb). We also surface
-- the three list fields the dashboard renders most often (objections,
-- pain_points, buying_signals) as text[] columns so the future
-- /sales-calls/[id]/insights page can filter without unpacking jsonb on
-- every render.
--
-- `analyzed_at` doubles as the cache key  -  the upload route skips the
-- LLM call when this column is non-null.

alter table rgaios_sales_calls
  add column if not exists insights        jsonb,
  add column if not exists objections      text[] not null default '{}',
  add column if not exists pain_points     text[] not null default '{}',
  add column if not exists buying_signals  text[] not null default '{}',
  add column if not exists analyzed_at     timestamptz;

create index if not exists rgaios_sales_calls_analyzed_idx
  on rgaios_sales_calls (organization_id, analyzed_at desc nulls last);
