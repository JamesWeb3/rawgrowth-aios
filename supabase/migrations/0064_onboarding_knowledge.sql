-- RAG-based onboarding chat context. The onboarding chat route was
-- pushing an 88kb SYSTEM_PROMPT plus 23 verbose tool descriptions on
-- EVERY Anthropic call, which 429'd the per-minute input rate limit
-- after a few turns. Move the bulky section playbooks and per-tool
-- "long" descriptions into a vector-indexed knowledge table; the route
-- then queries top-K chunks per user turn instead of shipping the
-- whole prompt every time.
--
-- Shape mirrors rgaios_company_chunks (0042) at the column level so
-- the same embedder + matcher patterns apply. Differences:
--
--   - Org-agnostic: this knowledge is the same for every tenant (it's
--     the assistant's playbook, not client data), so no
--     organization_id column and no RLS policy. Service-role inserts +
--     reads only.
--   - Native 384d embeddings (BAAI/bge-small-en-v1.5 from fastembed).
--     We don't pad to 1536 here because nothing else queries this
--     table cross-corpus - the route holds its own embed-and-match
--     code path.
--   - kind discriminator so a single retrieval can return either
--     section instructions (long-form playbook chunks) or tool
--     descriptions (long-form tool docs the model can reach for when
--     it needs detail beyond the slim 30-char schema description).
--   - section_id optional pointer so the route can boost retrieval
--     toward the section the client is currently in.
--
-- Idempotent: safe to re-run. Seeding is a separate script
-- (scripts/seed-onboarding-knowledge.ts) that truncates and re-fills.

create extension if not exists vector;

create table if not exists rgaios_onboarding_knowledge (
  id          uuid primary key default gen_random_uuid(),
  -- 'section_instruction' | 'tool_description' | 'rule'
  kind        text not null,
  -- e.g. 'section_1', 'section_2_basicInfo', 'tool:save_questionnaire_section'.
  -- Nullable for global rules that aren't scoped to one section.
  section_id  text,
  content     text not null,
  embedding   vector(384),
  created_at  timestamptz not null default now()
);

create index if not exists idx_rgaios_onboarding_knowledge_kind
  on rgaios_onboarding_knowledge (kind);

create index if not exists idx_rgaios_onboarding_knowledge_section
  on rgaios_onboarding_knowledge (section_id);

-- ivfflat for cosine similarity search. lists=50 is plenty: we expect
-- under 100 rows total (1 per section + 1 per tool + a handful of
-- global rules), so the index is overkill but matches the pattern
-- used elsewhere and keeps query plans consistent.
create index if not exists idx_rgaios_onboarding_knowledge_embedding
  on rgaios_onboarding_knowledge
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 50);

-- Top-K cosine retrieval. Service-role-only; no RLS. Returns the
-- chunk content plus its kind/section so the caller can format the
-- injected context block.
create or replace function rgaios_match_onboarding_knowledge(
  p_query_embedding  vector(384),
  p_match_count      int default 5,
  p_min_similarity   float default 0.0,
  p_section_id       text default null
)
returns table (
  id          uuid,
  kind        text,
  section_id  text,
  content     text,
  similarity  float
)
language sql stable as $$
  select
    k.id,
    k.kind,
    k.section_id,
    k.content,
    1.0 - (k.embedding <=> p_query_embedding) as similarity
  from rgaios_onboarding_knowledge k
  where k.embedding is not null
    and 1.0 - (k.embedding <=> p_query_embedding) >= p_min_similarity
    -- When a section_id is passed, slightly bias toward in-section
    -- chunks by including them unconditionally (similarity floor still
    -- applies). Out-of-section chunks compete on similarity alone.
    and (p_section_id is null or k.section_id = p_section_id or k.section_id is null or true)
  order by
    case when p_section_id is not null and k.section_id = p_section_id then 0 else 1 end,
    k.embedding <=> p_query_embedding
  limit greatest(p_match_count, 1)
$$;
