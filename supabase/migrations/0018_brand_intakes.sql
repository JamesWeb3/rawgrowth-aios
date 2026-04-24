-- Ported from the portal's brand_intakes + 012_brand_intakes_transcript.
-- 13 JSONB sub-sections capture answers during the AI-assisted onboarding
-- conversation. One row per organization.

create table if not exists rgaios_brand_intakes (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references rgaios_organizations(id) on delete cascade,
  basic_info           jsonb not null default '{}'::jsonb,
  social_presence      jsonb not null default '{}'::jsonb,
  origin_story         jsonb not null default '{}'::jsonb,
  business_model       jsonb not null default '{}'::jsonb,
  target_audience      jsonb not null default '{}'::jsonb,
  goals                jsonb not null default '{}'::jsonb,
  challenges           jsonb not null default '{}'::jsonb,
  brand_voice          jsonb not null default '{}'::jsonb,
  competitors          jsonb not null default '{}'::jsonb,
  content_messaging    jsonb not null default '{}'::jsonb,
  sales                jsonb not null default '{}'::jsonb,
  tools_systems        jsonb not null default '{}'::jsonb,
  additional_context   jsonb not null default '{}'::jsonb,
  call_data            jsonb not null default '{}'::jsonb,
  full_transcript      jsonb,
  submitted_at         bigint,
  created_at           timestamptz not null default now()
);

create unique index if not exists idx_rgaios_brand_intakes_org
  on rgaios_brand_intakes(organization_id);

-- RLS: only callers whose JWT carries this organization_id can see the row.
alter table rgaios_brand_intakes enable row level security;
alter table rgaios_brand_intakes force row level security;
drop policy if exists rgaios_v3_brand_intakes_org_isolation on rgaios_brand_intakes;
create policy rgaios_v3_brand_intakes_org_isolation on rgaios_brand_intakes
  using (organization_id = rgaios_current_org_id())
  with check (organization_id = rgaios_current_org_id());
