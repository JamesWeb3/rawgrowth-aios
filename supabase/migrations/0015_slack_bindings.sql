-- Channel → agent bindings for the Slack integration.
--
-- Each row says: when {trigger_type} happens in {slack_channel_id}
-- of {slack_team_id}, fire {agent_id} and send the output to
-- {output_type}/{output_config}, optionally with {prompt_template}
-- guiding what the agent does with the content.
--
-- Kept in its own table (rather than stuffed into the org's slack
-- connection metadata) so a single workspace can have many bindings
-- and we can query efficiently per (team, channel).

create table if not exists rgaios_slack_bindings (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references rgaios_organizations(id) on delete cascade,
  slack_team_id     text not null,
  slack_channel_id  text not null,
  slack_channel_name text,
  agent_id          uuid not null references rgaios_agents(id) on delete cascade,
  trigger_type      text not null check (trigger_type in (
                      'new_message', 'new_file', 'app_mention', 'transcript'
                    )),
  output_type       text not null check (output_type in (
                      'slack_thread', 'slack_channel', 'dm_user', 'gmail'
                    )),
  output_config     jsonb not null default '{}'::jsonb,
  prompt_template   text,
  enabled           boolean not null default true,
  created_at        timestamptz not null default now(),
  last_fired_at     timestamptz
);

create index if not exists idx_rgaios_slack_bindings_team_channel
  on rgaios_slack_bindings(slack_team_id, slack_channel_id, enabled)
  where enabled = true;

create index if not exists idx_rgaios_slack_bindings_org
  on rgaios_slack_bindings(organization_id);
