-- Ported from the portal's software_access table. Tracks which of the
-- client's platforms (Slack/Meta/GA/etc) have admin access granted.
-- Checklist surfaced in the onboarding chat under "Software access".

create table if not exists rgaios_software_access (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references rgaios_organizations(id) on delete cascade,
  platform        text not null,
  access_type     text not null default 'admin',
  confirmed       boolean not null default false,
  notes           text,
  confirmed_at    timestamptz,
  created_at      timestamptz not null default now(),
  unique (organization_id, platform)
);

create index if not exists idx_rgaios_software_access_org
  on rgaios_software_access(organization_id);

alter table rgaios_software_access enable row level security;
alter table rgaios_software_access force row level security;
drop policy if exists rgaios_v3_software_access_org_isolation on rgaios_software_access;
create policy rgaios_v3_software_access_org_isolation on rgaios_software_access
  using (organization_id = rgaios_current_org_id())
  with check (organization_id = rgaios_current_org_id());
