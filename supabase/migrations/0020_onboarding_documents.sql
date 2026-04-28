-- Ported from the portal's documents table. Files the client uploads
-- during onboarding (logos, brand guidelines, reference assets). Stored
-- in Supabase Storage; this row holds the metadata.

create table if not exists rgaios_onboarding_documents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references rgaios_organizations(id) on delete cascade,
  type            text not null default 'other'
                    check (type in ('logo', 'guideline', 'asset', 'other')),
  storage_url     text not null,
  filename        text not null,
  size            int not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists idx_rgaios_onboarding_documents_org
  on rgaios_onboarding_documents(organization_id);

alter table rgaios_onboarding_documents enable row level security;
alter table rgaios_onboarding_documents force row level security;
drop policy if exists rgaios_v3_onboarding_documents_org_isolation on rgaios_onboarding_documents;
create policy rgaios_v3_onboarding_documents_org_isolation on rgaios_onboarding_documents
  using (organization_id = rgaios_current_org_id())
  with check (organization_id = rgaios_current_org_id());
