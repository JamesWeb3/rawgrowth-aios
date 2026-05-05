-- Files unification (Chris feedback May 4): the dashboard had two near-
-- identical sections, /brand and /knowledge, that both boil down to "drop
-- files in here so the agents can read them". Combine into a single /files
-- view, organized by bucket so per-department folders + brand assets +
-- content drafts share one upload UI.
--
-- The bucket is a free-text label rather than an enum so adding a new
-- department later doesn't require a migration. Default 'other' so existing
-- rows backfill cleanly without breaking the /knowledge -> /files redirect
-- on day one.

alter table rgaios_knowledge_files
  add column if not exists bucket text not null default 'other';

-- Constrain to the picker's known categories. New buckets need a migration;
-- that's intentional so the picker UI stays in sync with the data.
alter table rgaios_knowledge_files
  drop constraint if exists rgaios_knowledge_files_bucket_check;
alter table rgaios_knowledge_files
  add constraint rgaios_knowledge_files_bucket_check
  check (bucket in (
    'brand',
    'content',
    'marketing',
    'sales',
    'fulfilment',
    'finance',
    'customer',
    'other'
  ));

create index if not exists rgaios_knowledge_files_bucket_idx
  on rgaios_knowledge_files (organization_id, bucket, uploaded_at desc);
