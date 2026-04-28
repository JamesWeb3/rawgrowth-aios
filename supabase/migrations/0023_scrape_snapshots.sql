-- v3 onboarding scrape pipeline. After brand profile is approved we hit
-- the client's own socials + three user-supplied competitor domains and
-- store what we got so the brand-profile prompt has real context on next
-- regen and so the dashboard unlock gate (/api/dashboard/gate) can wait
-- on scrape completion.
--
-- pgvector column is used by later RAG work (0024+). Nullable today.

create extension if not exists vector;

create table if not exists rgaios_scrape_snapshots (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references rgaios_organizations(id) on delete cascade,
  kind            text not null check (kind in ('social', 'competitor', 'site')),
  url             text not null,
  title           text,
  content         text,
  embedding       vector(1536),
  status          text not null default 'pending'
                    check (status in ('pending', 'running', 'succeeded', 'failed', 'blocked')),
  error           text,
  scraped_at      timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_rgaios_scrape_snapshots_org
  on rgaios_scrape_snapshots(organization_id);

create index if not exists idx_rgaios_scrape_snapshots_status
  on rgaios_scrape_snapshots(organization_id, status);

alter table rgaios_scrape_snapshots enable row level security;
alter table rgaios_scrape_snapshots force row level security;
drop policy if exists rgaios_v3_scrape_snapshots_org_isolation on rgaios_scrape_snapshots;
create policy rgaios_v3_scrape_snapshots_org_isolation on rgaios_scrape_snapshots
  using (organization_id = rgaios_current_org_id())
  with check (organization_id = rgaios_current_org_id());
