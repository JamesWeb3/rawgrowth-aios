-- Top-K retrieval function used by the knowledge_query MCP tool
-- (src/lib/mcp/tools/agent-knowledge.ts). Takes a query vector +
-- agent + org and returns the K most similar chunks by cosine
-- distance, joined with the filename for citation.
--
-- Declared stable + strict so PostgREST exposes it via RPC.

create or replace function rgaios_match_agent_chunks(
  p_agent_id uuid,
  p_organization_id uuid,
  p_query vector(1536),
  p_top_k int default 8
)
returns table (
  chunk_id uuid,
  file_id uuid,
  filename text,
  chunk_index int,
  content text,
  similarity real
)
language sql stable strict as $$
  select
    c.id as chunk_id,
    c.file_id,
    f.filename,
    c.chunk_index,
    c.content,
    1.0 - (c.embedding <=> p_query)::real as similarity
  from rgaios_agent_file_chunks c
  join rgaios_agent_files f on f.id = c.file_id
  where c.organization_id = p_organization_id
    and c.agent_id = p_agent_id
    and c.embedding is not null
  order by c.embedding <=> p_query
  limit greatest(p_top_k, 1)
$$;

-- pgvector ivfflat index for fast cosine KNN. lists=100 is a reasonable
-- default for orgs with a few thousand chunks; re-tune later if query
-- latency regresses.
create index if not exists idx_rgaios_agent_file_chunks_embedding
  on rgaios_agent_file_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);
