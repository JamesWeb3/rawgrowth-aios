-- Sales-call ingestion: Fireflies auto-sync.
--
-- Chris's ask (May 4): "should automatically connect to Fireflies and
-- auto-load into Supabase". v0 left fireflies/loom URL pastes as
-- status='error' with `url ingestion not yet implemented`. This migration
-- adds the schema bits the new /api/sales-calls/fireflies/poll route
-- needs to dedupe and trace where each call came from.
--
-- - source         text default 'manual': how the row landed here. The
--                  upload route stays 'manual' for human uploads. The
--                  Fireflies poller writes 'fireflies'. Future polls
--                  (gong, granola, fathom) reuse the same column.
-- - fireflies_id   text unique: the Fireflies transcript id. Unique so
--                  the poller can idempotently replay across calls
--                  without inserting duplicates.
--
-- The Fireflies API key lives in rgaios_connections under
-- provider_config_key='fireflies', metadata.api_key encrypted via
-- src/lib/crypto.encryptSecret.

alter table rgaios_sales_calls
  add column if not exists source       text not null default 'manual',
  add column if not exists fireflies_id text;

create unique index if not exists rgaios_sales_calls_fireflies_id_uniq
  on rgaios_sales_calls (fireflies_id)
  where fireflies_id is not null;

create index if not exists rgaios_sales_calls_source_idx
  on rgaios_sales_calls (organization_id, source);
