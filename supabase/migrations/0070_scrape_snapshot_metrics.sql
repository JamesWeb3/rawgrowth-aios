-- 0070: Restore the dropped Apify engagement metrics on
-- rgaios_scrape_snapshots.
--
-- The Apify drain worker (src/lib/scrape/worker.ts) pulls rich
-- per-item data from three actors: Facebook ads (run dates, platforms,
-- recency rank), YouTube top videos (view/like/comment counts,
-- duration, channel, view rank) and Instagram top posts (like/comment
-- counts, post type, engagement rank + score). Migration 0023 only
-- gave the table title/content/status columns, so every drain insert
-- that tried to land those metrics 400'd against the live schema. A
-- prior tsc-cleanup pass papered over the error by dropping the fields
-- from the insert entirely - so it compiles, but the engagement data
-- the media-buyer / copy agents are supposed to cite is no longer
-- persisted at all. (The "migration 0041" the worker comments
-- referenced never existed.)
--
-- Fix: a single `metrics jsonb` column. The three actors return
-- heterogeneous shapes (an FB ad has no view_count, an IG post has no
-- duration), so typed scalar columns would be mostly-null and need a
-- fresh migration per new metric. One jsonb blob keyed by kind is
-- flexible, future-proof, and matches how src/lib/scrape/sources.ts
-- already groups each item's `metrics` object.
--
-- Additive + idempotent: `add column if not exists` with a non-null
-- default of '{}' so existing rows backfill cleanly and a re-run is a
-- no-op. Nothing is dropped or rewritten.

alter table rgaios_scrape_snapshots
  add column if not exists metrics jsonb not null default '{}'::jsonb;

comment on column rgaios_scrape_snapshots.metrics is
  'Apify per-item engagement metrics + metadata, shape varies by kind. ads: start_date, end_date, platforms, recency_rank. yt_top: view_count, like_count, comment_count, duration_seconds, published_at, channel_name, view_rank. ig_top: like_count, comment_count, type, posted_at, display_url, engagement_rank, engagement_score. Written by src/lib/scrape/worker.ts. {} for the plain fetch path (social/competitor/site).';
