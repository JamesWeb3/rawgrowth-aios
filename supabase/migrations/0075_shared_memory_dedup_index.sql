-- Shared memory dedup originally tried to move into a partial unique
-- index keyed on (organization_id, lower-prefix, scope-join). Three
-- attempts failed under the self-hosted postgres:16 image:
--   1. stored generated columns                  - "not immutable"
--   2. stored generated columns w/ COLLATE "C"   - "not immutable"
--   3. partial unique EXPRESSION index w/ COLLATE - "functions in
--      index expression must be marked IMMUTABLE"
--
-- The shipped image's lower() / substring() / array_to_string()
-- functions are NOT IMMUTABLE despite COLLATE "C" wrapping. Likely
-- needs a CREATE FUNCTION ... IMMUTABLE wrapper or a Postgres
-- version bump - both out of scope for the hotfix that has to land
-- now to unblock prod.
--
-- For this revision, 0075 is a no-op. The JS-side dedup in
-- src/lib/memory/shared.ts still runs the 500-row scan + JS find;
-- correctness preserved, performance unchanged from pre-P0-2. The
-- index can be retried in a follow-up migration once we ship an
-- IMMUTABLE shared_memory_dedup_key(text, text[]) plpgsql function.
--
-- Cleanup any half-applied state from the prior FAILED apply
-- attempts. Both DROPs are no-ops on a fresh DB.

alter table rgaios_shared_memory drop column if exists fact_prefix;
alter table rgaios_shared_memory drop column if exists scope_key;
drop index if exists uq_rgaios_shared_memory_dedup_active;
