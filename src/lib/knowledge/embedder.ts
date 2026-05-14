import OpenAI from "openai";
import { createHash } from "node:crypto";

/**
 * Embeddings provider abstraction. Four backends, selected at runtime
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
 *   stub              -  deterministic SHA-256 hash of the input text
 *   spread across 384 floats in [-1, 1] then zero-padded to 1536d. NOT
 *   semantically useful  -  used as the automatic fallback when fastembed
 *   native modules fail to load (e.g. Vercel serverless workers, where
 *   onnxruntime-node + @anush008/tokenizers .node binaries are not
 *   resolvable at runtime). Keeps ingest alive so rows still land; real
 *   retrieval falls back to keyword search at the small corpus sizes
 *   v3 ships with. Set EMBEDDING_PROVIDER=stub to force it explicitly.
 *
 * fastembed, voyage and stub all zero-pad to the existing pgvector(1536)
 * column. Within a single-provider corpus this preserves cosine
 * similarity exactly (extra zero dims contribute 0 to both dot product
 * and L2 norm), so the column + ivfflat index keep working without a
 * schema migration. Do NOT mix providers inside one organization's
 * corpus  -  flip per-VPS, then backfill if you switch later.
 *
 * Provenance: embedBatchWithProvider / embedOneWithProvider return the
 * resolved provider alongside the vectors so callers can stamp the
 * rgaios_*_chunks.embedding_provider column (migration 0073) per row.
 * This is what makes the "stub fallback poisoned the corpus" failure
 * auditable instead of silent - a corpus with mixed providers is now
 * a `group by embedding_provider` query away from being visible. New
 * ingest paths SHOULD use the *WithProvider variants and persist the
 * provider. embedBatch / embedOne are kept as thin
 * provider-dropping wrappers so existing call sites still compile.
 *
 * Stub fallback is LOUD, not once-per-process: every batch that routes
 * through the stub because fastembed's native modules failed emits a
 * console.error with a running count. Set EMBEDDING_STRICT=1 to make
 * the stub fallback THROW instead - a half-broken VPS then fails the
 * ingest loudly rather than corrupting RAG with zero-signal vectors
 * (per the "do NOT mix providers" rule above). EMBEDDING_PROVIDER=stub
 * is still an explicit, allowed choice and is never blocked by strict
 * mode - strict mode only guards the *involuntary* fallback.
 *
 * Fails loud if the selected provider's API key is missing (openai /
 * voyage). The upload route catches and turns that into a per-file
 * warning so the file blob still lands in storage and can be
 * backfilled later. fastembed never throws for a missing key  -  on
 * native-load failure it falls back to the stub (or throws under
 * EMBEDDING_STRICT=1).
 */

const OPENAI_MODEL = "text-embedding-3-large";
const OPENAI_DIMENSIONS = 1536;

const VOYAGE_MODEL = "voyage-3-large";
const VOYAGE_NATIVE_DIMENSIONS = 1024;
const VOYAGE_ENDPOINT = "https://api.voyageai.com/v1/embeddings";

const FASTEMBED_NATIVE_DIMENSIONS = 384;
const STUB_NATIVE_DIMENSIONS = 384;

const TARGET_DIMENSIONS = 1536;
const BATCH = 96;

export type EmbeddingProvider = "fastembed" | "openai" | "voyage" | "stub";

/**
 * A batch of 1536d vectors plus the provider that actually produced
 * them. `provider` is the RESOLVED backend, not the requested one: when
 * EMBEDDING_PROVIDER=fastembed but the native modules fail to load and
 * the batch routes through the stub, `provider` is "stub". Callers
 * persist this into rgaios_*_chunks.embedding_provider so a corpus that
 * silently picked up zero-signal stub rows is auditable after the fact.
 */
export type EmbeddedBatch = {
  vectors: number[][];
  provider: EmbeddingProvider;
};

/** Single-text counterpart of EmbeddedBatch. */
export type EmbeddedOne = {
  vector: number[];
  provider: EmbeddingProvider;
};

function selectedProvider(): EmbeddingProvider {
  const raw = (process.env.EMBEDDING_PROVIDER ?? "fastembed")
    .toLowerCase()
    .trim();
  if (raw === "voyage") return "voyage";
  if (raw === "openai") return "openai";
  if (raw === "stub") return "stub";
  if (raw === "" || raw === "fastembed") return "fastembed";
  throw new Error(
    `Unknown EMBEDDING_PROVIDER='${raw}'. Use 'fastembed' (default), 'openai', 'voyage', or 'stub'.`,
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

async function embedBatchOpenAI(inputs: string[]): Promise<EmbeddedBatch> {
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
  return { vectors: all, provider: "openai" };
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

/**
 * Deterministic stub embedder. SHA-256 of the input text is expanded
 * with sequential counter rounds to fill 384 floats in [-1, 1], then
 * zero-padded to 1536d via padToTarget. Same input always yields the
 * same vector (idempotent re-ingest), but two distinct inputs produce
 * uncorrelated vectors  -  there is no semantic signal here. This path
 * exists so /api/data/ingest stays alive on Vercel serverless workers
 * where the fastembed ONNX native binaries cannot be resolved. RAG
 * retrieval falls back to keyword scan at the small corpus sizes v3
 * ships with; semantic search re-enables when the operator sets
 * EMBEDDING_PROVIDER=openai or voyage.
 */
function stubVector(text: string): number[] {
  const out = new Array<number>(STUB_NATIVE_DIMENSIONS);
  let counter = 0;
  let cursor = 0;
  while (cursor < STUB_NATIVE_DIMENSIONS) {
    const digest = createHash("sha256")
      .update(`${counter}:${text}`)
      .digest();
    // 32 bytes per round, two bytes per float -> 16 floats per round.
    for (let i = 0; i + 1 < digest.length && cursor < STUB_NATIVE_DIMENSIONS; i += 2) {
      const u16 = (digest[i] << 8) | digest[i + 1];
      // map [0, 65535] -> [-1, 1]
      out[cursor++] = (u16 / 65535) * 2 - 1;
    }
    counter += 1;
  }
  return padToTarget(out);
}

function embedBatchStub(inputs: string[]): number[][] {
  return inputs.map(stubVector);
}

// Running count of involuntary stub fallbacks this process. Unlike the
// old once-per-process boolean, this never goes quiet: every poisoned
// batch is accounted for in the logs so an operator grepping for
// "[embedder]" sees the full blast radius, not just the first hit.
let _fastembedFallbackCount = 0;

function strictModeEnabled(): boolean {
  const raw = (process.env.EMBEDDING_STRICT ?? "").toLowerCase().trim();
  return raw === "1" || raw === "true" || raw === "yes";
}

/**
 * Handle an involuntary fastembed -> stub fallback. Under
 * EMBEDDING_STRICT=1 this THROWS so the ingest fails loudly instead of
 * writing zero-signal vectors into a corpus that also holds real ones.
 * Otherwise it emits a per-call console.error (with a running count)
 * and lets the caller route the batch through the stub - but the
 * caller MUST then stamp embedding_provider='stub' on those rows so
 * the poison is at least labelled.
 */
function handleFastembedFallback(err: unknown, batchSize: number): void {
  _fastembedModel = null;
  _fastembedFallbackCount += 1;
  const reason = err instanceof Error ? err.message : String(err);
  if (strictModeEnabled()) {
    throw new Error(
      `[embedder] fastembed unavailable and EMBEDDING_STRICT=1 - refusing to write ${batchSize} stub (zero-signal) vectors into the corpus. Set EMBEDDING_PROVIDER=openai or voyage, or unset EMBEDDING_STRICT to allow labelled stub fallback (reason: ${reason})`,
    );
  }
  console.error(
    `[embedder] fastembed unavailable, falling back to STUB embeddings for ${batchSize} chunk(s) ` +
      `(fallback #${_fastembedFallbackCount} this process). These rows carry ZERO semantic signal and ` +
      `will be stamped embedding_provider='stub' - configure EMBEDDING_PROVIDER=openai or voyage and ` +
      `re-ingest for real semantic search, or set EMBEDDING_STRICT=1 to fail ingest instead (reason: ${reason})`,
  );
}

async function embedBatchFastembed(inputs: string[]): Promise<EmbeddedBatch> {
  let model: FastembedModel;
  try {
    model = await fastembedModel();
  } catch (err) {
    // Native ONNX / tokenizer modules missing or unloadable (typical on
    // Vercel serverless). Drop the cached promise so a later environment
    // with the binaries available can retry, then route this batch
    // through the stub path so ingest does not 500 - unless strict mode
    // is on, in which case handleFastembedFallback throws.
    handleFastembedFallback(err, inputs.length);
    return { vectors: embedBatchStub(inputs), provider: "stub" };
  }
  try {
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
    return { vectors: out, provider: "fastembed" };
  } catch (err) {
    // First-call inference failures (e.g. native .node side-load throws
    // lazily inside embed()) get the same treatment: loud per-call
    // error (or throw under strict mode), fall back to the stub.
    handleFastembedFallback(err, inputs.length);
    return { vectors: embedBatchStub(inputs), provider: "stub" };
  }
}

async function embedBatchVoyage(inputs: string[]): Promise<EmbeddedBatch> {
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
  return { vectors: all, provider: "voyage" };
}

/**
 * Embed a batch and report which backend actually produced the vectors.
 * This is the provenance-aware entry point - new ingest paths should
 * call this and persist `provider` into the chunk row's
 * embedding_provider column (migration 0073) so an involuntary stub
 * fallback is labelled instead of silently poisoning the corpus.
 *
 * `provider` is the RESOLVED backend: a fastembed request that fell
 * back to the stub reports "stub" here, not "fastembed".
 */
export async function embedBatchWithProvider(
  inputs: string[],
): Promise<EmbeddedBatch> {
  // Empty input short-circuits BEFORE selectedProvider(): an empty batch
  // needs no backend, and selectedProvider() throws on a misconfigured
  // EMBEDDING_PROVIDER - embedBatch([]) must stay a safe no-op even on a
  // hostile env. The reported provider is the configured default and is
  // never used (no vectors), so we don't pay the throw to compute it.
  if (inputs.length === 0) return { vectors: [], provider: "fastembed" };
  const provider = selectedProvider();
  if (provider === "voyage") return embedBatchVoyage(inputs);
  if (provider === "openai") return embedBatchOpenAI(inputs);
  if (provider === "stub") {
    return { vectors: embedBatchStub(inputs), provider: "stub" };
  }
  // fastembed: embedBatchFastembed resolves the real provider itself
  // ("fastembed" on success, "stub" on involuntary fallback).
  return embedBatchFastembed(inputs);
}

/** Single-text counterpart of embedBatchWithProvider. */
export async function embedOneWithProvider(
  text: string,
): Promise<EmbeddedOne> {
  const { vectors, provider } = await embedBatchWithProvider([text]);
  return { vector: vectors[0], provider };
}

/**
 * Provider-dropping wrapper. Kept so existing call sites that only need
 * the vectors keep compiling unchanged. Prefer embedBatchWithProvider
 * for any path that writes rows - the dropped `provider` is exactly the
 * provenance that makes a stub-poisoned corpus auditable.
 */
export async function embedBatch(inputs: string[]): Promise<number[][]> {
  const { vectors } = await embedBatchWithProvider(inputs);
  return vectors;
}

/** Provider-dropping wrapper around embedOneWithProvider. */
export async function embedOne(text: string): Promise<number[]> {
  const { vector } = await embedOneWithProvider(text);
  return vector;
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
  _fastembedFallbackCount = 0;
}
