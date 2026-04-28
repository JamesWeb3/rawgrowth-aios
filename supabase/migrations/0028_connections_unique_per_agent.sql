-- Ensure idempotent telegram seeding under concurrent calls.
-- Without this, parallel approveBrandProfile + dashboard/gate retries
-- (and the new /api/connections/telegram/seed-agent route) can race:
-- both pass the "row exists?" check, both attempt insert, one wins
-- and the other crashes against the COALESCE-based unique index from
-- 0024 with a confusing log line.
--
-- 0024 already has a unique on
--   (organization_id, provider_config_key, COALESCE(agent_id, '00...'))
-- which is correct but expression-based, so supabase-js .upsert()
-- with onConflict cannot target it cleanly. We add a plain partial
-- unique on raw columns (agent_id is not null) so callers can do
--   .upsert(..., { onConflict: 'organization_id,agent_id,provider_config_key',
--                  ignoreDuplicates: true })
-- and rely on Postgres to swallow the conflict atomically.
--
-- Partial on `agent_id is not null` because org-wide integrations
-- (Gmail, Slack bot, etc.) keep using the COALESCE index from 0024.

create unique index if not exists rgaios_connections_org_agent_provider_key
  on rgaios_connections (organization_id, agent_id, provider_config_key)
  where agent_id is not null;
