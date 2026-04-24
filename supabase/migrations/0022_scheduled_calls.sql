-- Ported from the portal's scheduled_calls. Monthly cadence calls the
-- operator schedules for the client (kickoff, week-4 review, etc).
-- Used in the onboarding flow's Calendly handoff step.

create table if not exists rgaios_scheduled_calls (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references rgaios_organizations(id) on delete cascade,
  title           text not null,
  month           int not null,
  week            int not null,
  calendly_url    text,
  scheduled_at    bigint,
  completed       boolean not null default false,
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_rgaios_scheduled_calls_org
  on rgaios_scheduled_calls(organization_id);

alter table rgaios_scheduled_calls enable row level security;
alter table rgaios_scheduled_calls force row level security;
drop policy if exists rgaios_v3_scheduled_calls_org_isolation on rgaios_scheduled_calls;
create policy rgaios_v3_scheduled_calls_org_isolation on rgaios_scheduled_calls
  using (organization_id = rgaios_current_org_id())
  with check (organization_id = rgaios_current_org_id());
