-- Onboarding state on the organization row. Ported from the portal's
-- clients.{onboarding_completed, onboarding_step, messaging_*} columns;
-- in v3 one org = one trial client, so the state lives on rgaios_organizations.

alter table rgaios_organizations
  add column if not exists onboarding_completed boolean not null default false,
  add column if not exists onboarding_step int not null default 1,
  add column if not exists messaging_channel text,
  add column if not exists messaging_handle text,
  add column if not exists slack_workspace_url text,
  add column if not exists slack_channel_name text,
  add column if not exists current_month int;
