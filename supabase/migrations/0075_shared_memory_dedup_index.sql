-- Shared memory dedup via a partial unique EXPRESSION index. Prior
-- attempts used STORED generated columns wrapped in COLLATE "C",
-- but the self-hosted Postgres image (postgres:16 with default
-- en_US.UTF-8 cluster collation) refused both expression-level and
-- column-level COLLATE clauses with "generation expression is not
-- immutable", even though equivalent ad-hoc ADD COLUMN succeeded
-- when run by hand. Expression indexes are more permissive: they
-- accept any IMMUTABLE-ish expression because the result is stored
-- in the index pages at write time, never recomputed for query.
--
-- The index alone is enough for the dedup contract:
--   - addSharedMemory() tries the INSERT
--   - on 23505 (unique violation) it falls back to a SELECT keyed by
--     the same expression and bumps importance on the colliding row
-- The JS expression must MATCH the index expression byte-for-byte
-- or PG will not pick the index path. See src/lib/memory/shared.ts
-- prefixKey() + scopeKey() helpers.
--
-- COLLATE "C" forces byte-level comparison so the index is stable
-- across cluster locales and matches the JS lower() output.
--
-- Cleanup any half-applied state from prior FAILED apply attempts.

alter table rgaios_shared_memory drop column if exists fact_prefix;
alter table rgaios_shared_memory drop column if exists scope_key;
drop index if exists uq_rgaios_shared_memory_dedup_active;

create unique index if not exists uq_rgaios_shared_memory_dedup_active
  on rgaios_shared_memory (
    organization_id,
    (lower(substring(trim(fact) from 1 for 80)) collate "C"),
    ((array_to_string(scope, '|')) collate "C")
  )
  where archived_at is null;
