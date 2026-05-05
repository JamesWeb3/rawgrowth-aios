import { supabaseAdmin } from "@/lib/supabase/server";
import { chunkText } from "@/lib/knowledge/chunker";
import { embedBatch, embedOne, toPgVector } from "@/lib/knowledge/embedder";

/**
 * Plan §7. Helpers around rgaios_company_chunks (migration 0042) - the
 * single Supabase vector store Chris specced as "everything about their
 * business in one place." Used by:
 *   - sales-call ingest (plan §12) to push transcript chunks
 *   - brand-profile generate to mirror the markdown profile
 *   - scrape worker to mirror best-performing snapshots
 *   - the MCP company_query tool (plan §7 + §10 CEO routing)
 *   - any future ingest path
 *
 * The store is org-scoped. Service role bypasses RLS; we still pass
 * org_id explicitly to the match RPC so a future role-based query path
 * (RLS-on) keeps working without code change.
 */

export type CompanyChunkSource =
  | "intake"
  | "brand_profile"
  | "scrape"
  | "onboarding_doc"
  | "sales_call"
  | "agent_file_mirror";

export type CompanyChunkMatch = {
  id: string;
  source: CompanyChunkSource | string;
  sourceId: string | null;
  chunkText: string;
  similarity: number;
  metadata: Record<string, unknown> | null;
};

/**
 * Chunk + embed + insert. Idempotent on (organization_id, source,
 * source_id, chunk_index): callers re-running for the same source row
 * delete-then-reinsert via deleteCompanyChunksFor first if the content
 * changed. We do NOT auto-dedupe by content hash; the caller owns
 * idempotency keys because each source has different freshness rules.
 */
export async function ingestCompanyChunk(input: {
  orgId: string;
  source: CompanyChunkSource | string;
  sourceId?: string | null;
  text: string;
  metadata?: Record<string, unknown>;
}): Promise<{ chunkCount: number; tokenCount: number }> {
  const trimmed = input.text?.trim();
  if (!trimmed) return { chunkCount: 0, tokenCount: 0 };

  const chunks = chunkText(trimmed);
  if (chunks.length === 0) return { chunkCount: 0, tokenCount: 0 };

  // Chunk shape from chunker.ts is {index, content} - NOT {text, tokenCount}.
  // Earlier passes used the wrong field names and the insert silently
  // landed null content + threw NOT NULL violations the caller swallowed.
  //
  // The embedder may transparently route through the stub backend
  // (fastembed native unavailable on Vercel serverless). Stub vectors
  // are still 1536d so toPgVector slots them in unchanged; if the
  // embedder ever returns a missing slot we substitute a zero-padded
  // placeholder so the row still lands and the operator can backfill
  // by re-running ingest under EMBEDDING_PROVIDER=openai or voyage.
  const embeddings = await embedBatch(chunks.map((c) => c.content));
  const zeroVector = new Array<number>(1536).fill(0);
  const rows = chunks.map((c, idx) => ({
    organization_id: input.orgId,
    source: input.source,
    source_id: input.sourceId ?? null,
    chunk_index: idx,
    content: c.content,
    token_count: Math.round(c.content.length / 4),
    embedding: toPgVector(embeddings[idx] ?? zeroVector),
    metadata: input.metadata ?? {},
  }));

  const { error } = await supabaseAdmin().from("rgaios_company_chunks").insert(rows);
  if (error) {
    throw new Error(`ingestCompanyChunk: ${error.message}`);
  }
  const tokenCount = rows.reduce((sum, r) => sum + r.token_count, 0);
  return { chunkCount: rows.length, tokenCount };
}

/**
 * Delete every chunk for a given (org, source, source_id) tuple. Used
 * before re-ingesting a brand profile new version, a refreshed scrape
 * snapshot, or a re-transcribed sales call. Idempotent.
 */
export async function deleteCompanyChunksFor(input: {
  orgId: string;
  source: CompanyChunkSource | string;
  sourceId: string;
}): Promise<{ deleted: number }> {
  const { count, error } = await supabaseAdmin()
    .from("rgaios_company_chunks")
    .delete({ count: "exact" })
    .eq("organization_id", input.orgId)
    .eq("source", input.source)
    .eq("source_id", input.sourceId);
  if (error) {
    throw new Error(`deleteCompanyChunksFor: ${error.message}`);
  }
  return { deleted: count ?? 0 };
}

/**
 * Cosine top-K against the company corpus. Wraps the
 * rgaios_match_company_chunks RPC defined in migration 0042. Returns
 * results pre-shaped for the MCP tool surface.
 */
export async function matchCompanyChunks(
  orgId: string,
  query: string,
  k = 5,
): Promise<CompanyChunkMatch[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const embedding = await embedOne(trimmed);
  // RPC isn't in the generated Database types yet (added in migration
  // 0042 after the codegen ran). Cast args + result to bypass the
  // 'never' inference until the next type regen.
  const { data, error } = await supabaseAdmin().rpc(
    "rgaios_match_company_chunks" as never,
    {
      p_org_id: orgId,
      p_query_embedding: toPgVector(embedding),
      p_match_count: Math.max(1, Math.min(k, 25)),
      p_min_similarity: 0.0,
    } as never,
  );
  if (error) {
    throw new Error(`matchCompanyChunks: ${error.message}`);
  }
  type Row = {
    id: string;
    source: string;
    source_id: string | null;
    chunk_text: string;
    similarity: number;
    metadata: Record<string, unknown> | null;
  };
  return ((data ?? []) as Row[]).map(
    (row): CompanyChunkMatch => ({
      id: row.id,
      source: row.source,
      sourceId: row.source_id,
      chunkText: row.chunk_text,
      similarity: row.similarity,
      metadata: row.metadata,
    }),
  );
}

/**
 * Convenience: ingest a generated brand-profile markdown into the
 * company corpus tagged source='brand_profile'. Caller passes the
 * profile row id so re-generation can deleteCompanyChunksFor the same
 * source_id before re-ingesting.
 */
export async function mirrorBrandProfile(
  orgId: string,
  profileId: string,
  markdown: string,
): Promise<void> {
  await deleteCompanyChunksFor({
    orgId,
    source: "brand_profile",
    sourceId: profileId,
  });
  await ingestCompanyChunk({
    orgId,
    source: "brand_profile",
    sourceId: profileId,
    text: markdown,
    metadata: { kind: "brand_profile_markdown" },
  });
}
