-- Per-user OAuth connections. Pedro hit a real bug: a single Claude Max
-- token was shared across every user in the org because connections were
-- keyed (organization_id, provider_config_key). When Chris/Dilan opened
-- their dashboards they used Pedro's Anthropic account, which rate-limited
-- (429) the moment more than one human poked the system in parallel.
--
-- Add an optional user_id so each member can wire their own OAuth grant.
-- Legacy rows (user_id IS NULL) still work as the org-wide fallback for
-- non-interactive paths (cron, drain server) that don't have a user
-- session in scope. Reader prefers the per-user row when both exist.
--
-- The unique constraint widens to (org, user_id, provider_config_key,
-- agent_id) so Pedro and Dilan can both have a claude-max row in the
-- same org without colliding.

alter table rgaios_connections
  add column if not exists user_id uuid references rgaios_users(id) on delete cascade;

create index if not exists idx_rgaios_connections_user
  on rgaios_connections(organization_id, user_id, provider_config_key)
  where user_id is not null;

-- Replace the (org, provider, agent) unique index from 0024 with a wider
-- one that includes user_id. user_id IS NULL rows stay one-per-(org,
-- provider, agent), per-user rows are unique within (org, user_id,
-- provider, agent).
do $$
begin
  if exists (
    select 1 from pg_indexes
    where indexname = 'rgaios_connections_org_provider_agent_uniq'
  ) then
    execute 'drop index rgaios_connections_org_provider_agent_uniq';
  end if;
end $$;

create unique index if not exists rgaios_connections_org_user_provider_agent_uniq
  on rgaios_connections(
    organization_id,
    coalesce(user_id::text, ''),
    provider_config_key,
    coalesce(agent_id::text, '')
  );
