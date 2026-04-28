import OpenAI from "openai";

/**
 * Embeddings provider abstraction. Three backends, selected at runtime
 * via EMBEDDING_PROVIDER:
 *
 *   fastembed (default)  -  BAAI/bge-small-en-v1.5 via fastembed-js (ONNX,
 *   ~250MB RSS, ~33MB model on disk). Native 384d, zero-padded to 1536d.
 *   Zero API key  -  runs entirely inside the Next.js process. Picked as
 *   default per CTO brief §1: "no kill-switch, no third-party billed
 *   key required". Cold-start ~3-5s on first call; subsequent calls
 *   reuse the cached singleton.
 *
 *   openai            -  text-embedding-3-large at dims=1536. Matches the
 *   rgaios_agent_file_chunks.embedding vector(1536) column natively.
 *
 *   voyage            -  Anthropic-ecosystem alternative for VPS installs
 *   that want a managed embedding endpoint without OpenAI. Uses
 *   voyage-3-large via plain fetch against
 *   https://api.voyageai.com/v1/embeddings. Native 1024d, zero-padded
 *   to 1536d.
 *
 * Both fastembed and voyage zero-pad to the existing pgvector(1536)
 * column. Within a single-provider corpus this preserves cosine
 * similarity exactly (extra zero dims contribute 0 to both dot product
 * and L2 norm), so the column + ivfflat index keep working without a
 * schema migration. Do NOT mix providers inside one organization's
 * corpus  -  flip per-VPS, then backfill if you switch later.
 *
 * Public contract is unchanged: embedBatch / embedOne / toPgVector with
 * the same shapes the upload route and knowledge_query MCP tool expect.
 *
 * Fails loud if the selected provider's API key is missing (openai /
 * voyage). The upload route catches and turns that into a per-file
 * warning so the file blob still lands in storage and can be
 * backfilled later. fastembed never throws for a missing key.
 */

const OPENAI_MODEL = "text-embedding-3-large";
const OPENAI_DIMENSIONS = 1536;

const VOYAGE_MODEL = "voyage-3-large";
const VOYAGE_NATIVE_DIMENSIONS = 1024;
const VOYAGE_ENDPOINT = "https://api.voyageai.com/v1/embeddings";

const FASTEMBED_NATIVE_DIMENSIONS = 384;

const TARGET_DIMENSIONS = 1536;
const BATCH = 96;

export type EmbeddingProvider = "fastembed" | "openai" | "voyage";

function selectedProvider(): EmbeddingProvider {
  const raw = (process.env.EMBEDDING_PROVIDER ?? "fastembed")
    .toLowerCase()
    .trim();
  if (raw === "voyage") return "voyage";
  if (raw === "openai") return "openai";
  if (raw === "" || raw === "fastembed") return "fastembed";
  throw new Error(
    `Unknown EMBEDDING_PROVIDER='${raw}'. Use 'fastembed' (default), 'openai', or 'voyage'.`,
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
 * Pad a sub-1536d vector out to 1536d so it slots into the existing
 * pgvector column. Cosine similarity is preserved as long as both query
 * and corpus vectors are padded identically (which they are: every call
 * funnels through this helper).
 */
function padToTarget(v: number[]): number[] {
  if (v.length === TARGET_DIMENSIONS) return v;
  if (v.length > TARGET_DIMENSIONS) {
    throw new Error(
      `Embedding ${v.length}d exceeds target ${TARGET_DIMENSIONS}d; refusing to truncate.`,
    );
  }
  return [...v, ...new Array<number>(TARGET_DIMENSIONS - v.length).fill(0)];
}

// Lazy-loaded singleton for the local fastembed model. Cold-init is
// ~3-5s on first request (downloads ONNX file to FASTEMBED_CACHE_DIR
// and warms the runtime); subsequent calls reuse the same instance and
// cost only the inference time.
type FastembedModel = {
  embed: (
    inputs: string[],
    batchSize?: number,
  ) => AsyncIterable<number[][]>;
};
let _fastembedModel: Promise<FastembedModel> | null = null;

async function fastembedModel(): Promise<FastembedModel> {
  if (_fastembedModel) return _fastembedModel;
  _fastembedModel = (async () => {
    const mod = (await import("fastembed")) as {
      FlagEmbedding: {
        init: (opts: {
          model: string;
          cacheDir?: string;
        }) => Promise<FastembedModel>;
      };
      EmbeddingModel?: { BGESmallENV15: string };
    };
    const modelId = mod.EmbeddingModel?.BGESmallENV15 ?? "BAAI/bge-small-en-v1.5";
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    return mod.FlagEmbedding.init({
      model: modelId,
      // Production VPS writes to /var/lib/rawclaw via the docker volume
      // mount; in dev we fall back to OS tmp so contributors don't need
      // to mkdir as root. Override with FASTEMBED_CACHE_DIR.
      cacheDir:
        process.env.FASTEMBED_CACHE_DIR ??
        path.join(tmpdir(), "rawclaw-fastembed"),
    });
  })();
  return _fastembedModel;
}

async function embedBatchFastembed(inputs: string[]): Promise<number[][]> {
  const model = await fastembedModel();
  const out: number[][] = [];
  for await (const group of model.embed(inputs, Math.min(inputs.length, BATCH))) {
    for (const v of group) {
      if (v.length !== FASTEMBED_NATIVE_DIMENSIONS) {
        throw new Error(
          `fastembed returned vector of unexpected dim ${v.length} (expected ${FASTEMBED_NATIVE_DIMENSIONS})`,
        );
      }
      out.push(padToTarget(v));
    }
  }
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
  if (provider === "openai") return embedBatchOpenAI(inputs);
  return embedBatchFastembed(inputs);
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
 * Fire-and-forget warmup. Boots the fastembed singleton ahead of the
 * first user upload so the operator-visible cold-start (~10s on a
 * fresh VPS — model download + ONNX runtime warm) lands during boot
 * instead of mid-demo. Safe to call multiple times: the singleton
 * promise dedupes. No-op when EMBEDDING_PROVIDER is openai/voyage.
 */
export function warmEmbedder(): void {
  if (selectedProvider() !== "fastembed") return;
  // Dev-mode Turbopack rewrites dynamic require paths to hashed module
  // names that miss the packed runtime, so the warmup import fails with
  // ERR_MODULE_NOT_FOUND on every boot. The actual upload path
  // (embedBatch via /api/agent-files/upload) uses the same dynamic
  // import and resolves fine, since by the time it runs the
  // serverExternalPackages bundle decision is final. Skip warmup in
  // dev to keep the log clean; production (next start) routes through
  // the standalone bundle where the warmup actually warms.
  if (process.env.NODE_ENV !== "production") return;
  fastembedModel().catch((err) => {
    console.warn("[embedder] warmup failed:", (err as Error).message);
  });
}

/**
 * Test-only hook. Lets specs reset the cached OpenAI client when they
 * mutate process.env between cases. Not exported via the package surface
 * for runtime callers; kept here so tests don't need to reach into
 * module internals via dynamic import re-evaluation.
 */
export function __resetClientsForTests(): void {
  _openaiClient = null;
  _fastembedModel = null;
}
