-- Widen the rgaios_scrape_snapshots.kind CHECK constraint.
--
-- The Apify drain worker (src/lib/scrape/worker.ts) writes kind values
-- 'ads' (Facebook ads), 'yt_top' (YouTube top videos) and 'ig_top'
-- (Instagram top posts). Migration 0023 only allowed
-- 'social' | 'competitor' | 'site', so every Apify drain insert failed
-- the constraint at runtime (400). This widens the allowed set.
--
-- Additive only: the original three values stay valid. Postgres named
-- the inline 0023 check `rgaios_scrape_snapshots_kind_check` by
-- convention (<table>_<column>_check); drop-if-exists + re-add keeps
-- this idempotent and safe to re-run.

alter table rgaios_scrape_snapshots
  drop constraint if exists rgaios_scrape_snapshots_kind_check;

alter table rgaios_scrape_snapshots
  add constraint rgaios_scrape_snapshots_kind_check
  check (kind in ('social', 'competitor', 'site', 'ads', 'yt_top', 'ig_top'));
