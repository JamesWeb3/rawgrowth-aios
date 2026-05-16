-- Shared memory dedup moved into a partial unique index. Prior path in
-- src/lib/memory/shared.ts fetched up to 500 active rows per write and
-- ran a JS .find() to detect duplicates - O(N) per insert and racey
-- under concurrent writes (two writes can pass the JS check at the
-- same time and both insert the same fact).
--
-- This migration:
--   1. Adds two STORED generated columns that mirror the JS dedup
--      key functions:
--        fact_prefix - lower(substring(trim(fact) from 1 for 80))
--                      mirrors prefixKey() in shared.ts.
--        scope_key   - array_to_string(scope, '|')
--                      mirrors scopeKey() (pure join). The JS layer
--                      pre-sorts via normalizeScope() before insert.
--                      A subquery (ARRAY(SELECT unnest ORDER BY 1))
--                      would let the DB sort itself, but generated-
--                      column expressions cannot contain subqueries,
--                      so the canonical-sort guarantee lives in the
--                      single JS insert surface. Any direct-SQL write
--                      that bypasses addSharedMemory must also send a
--                      sorted scope array.
--   2. Adds a partial unique index over the three-tuple, restricted to
--      non-archived rows so revisions (archived_at set, supersedes_id
--      pointing at the replacement) do not trip the constraint.
--
-- Both generated expressions are IMMUTABLE so Postgres accepts them in
-- a STORED generated column without further marking.

-- COLLATE "C" is REQUIRED: without it Postgres 16+ rejects the
-- generated column with "generation expression is not immutable",
-- because lower() / array_to_string() are only marked IMMUTABLE for
-- collation-deterministic input. The C collation is byte-level and
-- always deterministic. The downstream JS helpers (prefixKey /
-- scopeKey in shared.ts) also produce ASCII-lower output so the
-- equality semantics line up.

alter table rgaios_shared_memory
  add column if not exists fact_prefix text
    generated always as (lower(substring(trim(fact) from 1 for 80)) collate "C") stored;

alter table rgaios_shared_memory
  add column if not exists scope_key text
    generated always as ((array_to_string(scope, '|')) collate "C") stored;

create unique index if not exists uq_rgaios_shared_memory_dedup_active
  on rgaios_shared_memory (organization_id, fact_prefix, scope_key)
  where archived_at is null;
