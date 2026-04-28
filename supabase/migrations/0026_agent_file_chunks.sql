-- Embeddings for per-agent file chunks. Queried by the knowledge_query
-- MCP tool (new in D10) to pull top-K chunks for the agent Claude is
-- currently acting as. pgvector enabled in 0023.
--
-- 1536-dim vectors match text-embedding-3-large truncated to 1536 and
-- OpenAI's cheaper text-embedding-3-small. Switching the backing model
-- does not require a schema change as long as we keep 1536 dims.

create table if not exists rgaios_agent_file_chunks (
  id           uuid primary key default gen_random_uuid(),
  file_id      uuid not null references rgaios_agent_files(id) on delete cascade,
  organization_id uuid not null references rgaios_organizations(id) on delete cascade,
  agent_id     uuid not null references rgaios_agents(id) on delete cascade,
  chunk_index  int not null,
  content      text not null,
  token_count  int,
  embedding    vector(1536),
  created_at   timestamptz not null default now()
);

create index if not exists idx_rgaios_agent_file_chunks_agent
  on rgaios_agent_file_chunks(organization_id, agent_id);

create index if not exists idx_rgaios_agent_file_chunks_embedding
  on rgaios_agent_file_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 50);

alter table rgaios_agent_file_chunks enable row level security;
alter table rgaios_agent_file_chunks force row level security;
drop policy if exists rgaios_v3_agent_file_chunks_org_isolation on rgaios_agent_file_chunks;
create policy rgaios_v3_agent_file_chunks_org_isolation on rgaios_agent_file_chunks
  using (organization_id = rgaios_current_org_id())
  with check (organization_id = rgaios_current_org_id());
