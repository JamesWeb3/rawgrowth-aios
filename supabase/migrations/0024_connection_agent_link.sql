-- Per-agent Telegram bots. rgaios_connections already exists (0001) with
-- a unique (organization_id, provider_config_key). That unique blocks v3's
-- "one Telegram bot per department manager" shape, so we:
--
--   1. Add nullable agent_id (FK to rgaios_agents).
--   2. Replace the unique constraint with one that considers agent_id
--      (null agent_id = org-wide integration; bound agent_id = per-agent).
--   3. Add a status enum extension 'pending_token' so we can seed rows
--      on brand-approval before the user has pasted a BotFather token.

alter table rgaios_connections
  add column if not exists agent_id uuid references rgaios_agents(id) on delete cascade;

create index if not exists idx_rgaios_connections_agent
  on rgaios_connections(organization_id, agent_id)
  where agent_id is not null;

do $$
begin
  if exists (
    select 1 from pg_indexes
    where indexname = 'rgaios_connections_organization_id_provider_config_key_key'
       or indexname = 'rgaios_connections_org_provider_unique'
  ) then
    execute 'alter table rgaios_connections
             drop constraint if exists rgaios_connections_organization_id_provider_config_key_key';
  end if;
end $$;

-- Null agent_id rows are org-wide integrations (Gmail, Slack bot, etc).
-- Duplicated provider keys allowed only when differentiated by agent_id.
create unique index if not exists rgaios_connections_org_provider_agent_uniq
  on rgaios_connections(organization_id, provider_config_key, coalesce(agent_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Loosen status check if it exists, keeping the existing values.
alter table rgaios_connections
  drop constraint if exists rgaios_connections_status_check;

alter table rgaios_connections
  add constraint rgaios_connections_status_check
    check (status in ('connected', 'error', 'disconnected', 'pending_token'));
