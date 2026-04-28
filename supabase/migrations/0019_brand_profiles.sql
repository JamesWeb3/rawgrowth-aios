-- Ported from the portal's brand_profiles. Versioned markdown generated
-- from the brand_intake at the end of onboarding. status transitions
-- generating -> ready -> approved. Only approved profiles unlock the
-- dashboard (see /api/dashboard/gate).

create table if not exists rgaios_brand_profiles (
  id             uuid primary key default gen_random_uuid(),
  organization_id uuid not null references rgaios_organizations(id) on delete cascade,
  version        int not null default 1,
  content        text not null default '',
  status         text not null default 'generating'
                   check (status in ('generating', 'ready', 'approved')),
  generated_at   bigint not null,
  approved_at    bigint,
  approved_by    text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_rgaios_brand_profiles_org
  on rgaios_brand_profiles(organization_id);

create index if not exists idx_rgaios_brand_profiles_latest
  on rgaios_brand_profiles(organization_id, version desc);

alter table rgaios_brand_profiles enable row level security;
alter table rgaios_brand_profiles force row level security;
drop policy if exists rgaios_v3_brand_profiles_org_isolation on rgaios_brand_profiles;
create policy rgaios_v3_brand_profiles_org_isolation on rgaios_brand_profiles
  using (organization_id = rgaios_current_org_id())
  with check (organization_id = rgaios_current_org_id());
