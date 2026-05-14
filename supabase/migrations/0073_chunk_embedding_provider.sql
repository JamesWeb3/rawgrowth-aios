-- Per-row embedding provenance.
--
-- src/lib/knowledge/embedder.ts has a stub fallback: when the fastembed
-- ONNX native modules fail to load (e.g. Vercel serverless workers), the
-- batch silently routes through embedBatchStub, which returns SHA-256
-- derived vectors with ZERO semantic signal. Those landed in the SAME
-- embedding column as real fastembed/openai/voyage vectors with nothing
-- recording which backend produced each row. A half-broken VPS could
-- therefore poison an organization's corpus with a mix of real and
-- garbage vectors and no query could tell them apart.
--
-- This column lets every ingest path stamp the resolved provider per
-- row ('fastembed' | 'openai' | 'voyage' | 'stub'). Nullable so existing
-- rows (pre-0073) read back as NULL = "unknown / pre-provenance"; new
-- writes always set it. An operator can now:
--   - audit:    select embedding_provider, count(*) ... group by 1
--   - backfill: delete where embedding_provider = 'stub', re-ingest
-- without guessing which rows are real.
--
-- Applies to both tables that receive embedder output:
--   - rgaios_agent_file_chunks  (per-agent file ingest, ingest.ts)
--   - rgaios_company_chunks     (cross-source corpus, company-corpus.ts)

alter table rgaios_agent_file_chunks
  add column if not exists embedding_provider text;

alter table rgaios_company_chunks
  add column if not exists embedding_provider text;

-- Partial indexes so the "find the poisoned rows" audit query stays
-- cheap as corpora grow. Only stub rows are indexed - the common case
-- (a clean single-provider corpus) keeps these tiny or empty.
create index if not exists idx_rgaios_agent_file_chunks_stub_provider
  on rgaios_agent_file_chunks (organization_id)
  where embedding_provider = 'stub';

create index if not exists idx_rgaios_company_chunks_stub_provider
  on rgaios_company_chunks (organization_id)
  where embedding_provider = 'stub';
