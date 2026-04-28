-- Per-agent file attachments. Files live in Supabase Storage bucket
-- 'agent-files'; this table holds metadata + link to the blob.
--
-- Separate from rgaios_onboarding_documents (which is for brand kit
-- uploads during onboarding) and from rgaios_knowledge_files (which
-- is org-wide markdown knowledge). This is the per-agent RAG surface
-- the §9.3 test "agent answers prompt that references uploaded files"
-- runs against.

create table if not exists rgaios_agent_files (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references rgaios_organizations(id) on delete cascade,
  agent_id        uuid not null references rgaios_agents(id) on delete cascade,
  filename        text not null,
  storage_path    text not null,
  mime_type       text not null default 'application/octet-stream',
  size_bytes      bigint not null default 0,
  uploaded_by     uuid references rgaios_users(id) on delete set null,
  uploaded_at     timestamptz not null default now()
);

create index if not exists idx_rgaios_agent_files_agent
  on rgaios_agent_files(organization_id, agent_id);

alter table rgaios_agent_files enable row level security;
alter table rgaios_agent_files force row level security;
drop policy if exists rgaios_v3_agent_files_org_isolation on rgaios_agent_files;
create policy rgaios_v3_agent_files_org_isolation on rgaios_agent_files
  using (organization_id = rgaios_current_org_id())
  with check (organization_id = rgaios_current_org_id());
