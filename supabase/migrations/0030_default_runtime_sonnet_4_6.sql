-- v3: bump default agent runtime to claude-sonnet-4-6.
-- Existing rows on claude-sonnet-4-5 keep their value (no backfill);
-- only new agents created without an explicit runtime get 4.6.

alter table rgaios_agents
  alter column runtime set default 'claude-sonnet-4-6';
