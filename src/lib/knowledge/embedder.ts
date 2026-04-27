import OpenAI from "openai";

/**
 * Embeddings provider abstraction. Two backends, selected at runtime via
 * EMBEDDING_PROVIDER:
 *
 *   openai (default) — text-embedding-3-large at dims=1536. Matches the
 *   rgaios_agent_file_chunks.embedding vector(1536) column natively.
 *
 *   voyage           — Anthropic-ecosystem alternative for VPS installs
 *   that want to avoid an OpenAI key entirely (Path A Claude Code CLI for
 *   chat + Voyage for RAG). Uses voyage-3-large via plain fetch against
 *   https://api.voyageai.com/v1/embeddings. voyage-3-large only emits
 *   256 / 512 / 1024 (default) / 2048 dims, NOT 1536, so we take the
 *   native 1024d output and zero-pad to 1536. Within a single-provider
 *   corpus this preserves cosine similarity exactly (extra zero dims
 *   contribute 0 to both dot product and L2 norm), so the existing
 *   pgvector(1536) column and ivfflat index keep working without a
 *   schema migration. Do NOT mix providers inside one organization's
 *   corpus — flip per-VPS, then backfill if you switch later.
 *
 * Public contract is unchanged: embedBatch / embedOne / toPgVector with
 * the same shapes the upload route and knowledge_query MCP tool expect.
 *
 * Fails loud if the selected provider's API key is missing. The upload
 * route catches and turns that into a per-file warning so the file blob
 * still lands in storage and can be backfilled later.
 */

const OPENAI_MODEL = "text-embedding-3-large";
const OPENAI_DIMENSIONS = 1536;

const VOYAGE_MODEL = "voyage-3-large";
const VOYAGE_NATIVE_DIMENSIONS = 1024;
const VOYAGE_ENDPOINT = "https://api.voyageai.com/v1/embeddings";

const TARGET_DIMENSIONS = 1536;
const BATCH = 96;

export type EmbeddingProvider = "openai" | "voyage";

function selectedProvider(): EmbeddingProvider {
  const raw = (process.env.EMBEDDING_PROVIDER ?? "openai").toLowerCase().trim();
  if (raw === "voyage") return "voyage";
  if (raw === "" || raw === "openai") return "openai";
  throw new Error(
    `Unknown EMBEDDING_PROVIDER='${raw}'. Use 'openai' (default) or 'voyage'.`,
  );
}

let _openaiClient: OpenAI | null = null;
function openaiClient(): OpenAI {
  if (_openaiClient) return _openaiClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  _openaiClient = new OpenAI({ apiKey });
  return _openaiClient;
}

async function embedBatchOpenAI(inputs: string[]): Promise<number[][]> {
  const all: number[][] = [];
  for (let i = 0; i < inputs.length; i += BATCH) {
    const slice = inputs.slice(i, i + BATCH);
    const res = await openaiClient().embeddings.create({
      model: OPENAI_MODEL,
      dimensions: OPENAI_DIMENSIONS,
      input: slice,
    });
    for (const item of res.data) all.push(item.embedding as number[]);
  }
  return all;
}

/**
 * Pad a 1024d Voyage vector out to 1536d so it slots into the existing
 * pgvector column. Cosine similarity is preserved as long as both query
 * and corpus vectors are padded identically (which they are: every call
 * funnels through this helper).
 */
function padToTarget(v: number[]): number[] {
  if (v.length === TARGET_DIMENSIONS) return v;
  if (v.length > TARGET_DIMENSIONS) {
    throw new Error(
      `Voyage vector ${v.length}d exceeds target ${TARGET_DIMENSIONS}d; refusing to truncate.`,
    );
  }
  const out = new Array<number>(TARGET_DIMENSIONS);
  for (let i = 0; i < v.length; i++) out[i] = v[i];
  for (let i = v.length; i < TARGET_DIMENSIONS; i++) out[i] = 0;
  return out;
}

async function embedBatchVoyage(inputs: string[]): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "VOYAGE_API_KEY not set (required when EMBEDDING_PROVIDER=voyage)",
    );
  }
  const all: number[][] = [];
  for (let i = 0; i < inputs.length; i += BATCH) {
    const slice = inputs.slice(i, i + BATCH);
    const res = await fetch(VOYAGE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: VOYAGE_MODEL,
        input: slice,
        // voyage-3-large default is 1024d. We request explicitly so the
        // contract is stable even if Voyage changes defaults.
        output_dimension: VOYAGE_NATIVE_DIMENSIONS,
        // 'document' is the right hint for chunks; queries use embedOne
        // which still goes through this batch path. Voyage docs say the
        // hint mostly matters for asymmetric retrieval; leaving it as
        // document here is fine because cosine over symmetric encodings
        // is still meaningful, and it keeps the batch path single-shape.
        input_type: "document",
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "<no body>");
      throw new Error(
        `Voyage embeddings HTTP ${res.status}: ${body.slice(0, 500)}`,
      );
    }
    const json = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const data = json.data ?? [];
    if (data.length !== slice.length) {
      throw new Error(
        `Voyage returned ${data.length} vectors for ${slice.length} inputs`,
      );
    }
    for (const item of data) {
      const v = item.embedding;
      if (!Array.isArray(v) || v.length !== VOYAGE_NATIVE_DIMENSIONS) {
        throw new Error(
          `Voyage returned vector of unexpected dim ${v?.length ?? "n/a"} (expected ${VOYAGE_NATIVE_DIMENSIONS})`,
        );
      }
      all.push(padToTarget(v));
    }
  }
  return all;
}

export async function embedBatch(inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) return [];
  const provider = selectedProvider();
  if (provider === "voyage") return embedBatchVoyage(inputs);
  return embedBatchOpenAI(inputs);
}

export async function embedOne(text: string): Promise<number[]> {
  const [v] = await embedBatch([text]);
  return v;
}

/**
 * Postgres pgvector literal format: '[0.1,0.2,...]'. Supabase-js passes
 * strings through untouched for vector columns, so this is the shape
 * inserts/updates expect.
 */
export function toPgVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/**
 * Test-only hook. Lets specs reset the cached OpenAI client when they
 * mutate process.env between cases. Not exported via the package surface
 * for runtime callers; kept here so tests don't need to reach into
 * module internals via dynamic import re-evaluation.
 */
export function __resetClientsForTests(): void {
  _openaiClient = null;
}
