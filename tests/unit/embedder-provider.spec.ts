import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Provider-selection tests for src/lib/knowledge/embedder.ts. The module
 * caches an OpenAI client at import time, so we use __resetClientsForTests
 * between cases that flip env vars. fetch is monkey-patched on globalThis
 * for the voyage path so no real HTTP calls leave the box.
 */

const ENV_KEYS = ["EMBEDDING_PROVIDER", "OPENAI_API_KEY", "VOYAGE_API_KEY"] as const;
function snapshotEnv() {
  const snap: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) snap[k] = process.env[k];
  return snap;
}
function restoreEnv(snap: Record<string, string | undefined>) {
  for (const k of ENV_KEYS) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
}

type FetchLike = typeof fetch;
const realFetch: FetchLike = globalThis.fetch;

function installFetchStub(handler: (req: { url: string; init: RequestInit }) => Response | Promise<Response>) {
  (globalThis as { fetch: FetchLike }).fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as { url: string }).url;
    return handler({ url, init: init ?? {} });
  }) as unknown as FetchLike;
}
function restoreFetch() {
  (globalThis as { fetch: FetchLike }).fetch = realFetch;
}

test("voyage path requires VOYAGE_API_KEY and surfaces a clear error", async () => {
  const snap = snapshotEnv();
  try {
    process.env.EMBEDDING_PROVIDER = "voyage";
    delete process.env.VOYAGE_API_KEY;

    const mod = await import("../../src/lib/knowledge/embedder.ts");
    mod.__resetClientsForTests();

    await assert.rejects(
      () => mod.embedBatch(["hello"]),
      (err: Error) => /VOYAGE_API_KEY not set/.test(err.message),
    );
  } finally {
    restoreEnv(snap);
  }
});

test("voyage path posts to the right endpoint with bearer auth and pads 1024d to 1536d", async () => {
  const snap = snapshotEnv();
  let captured: { url: string; init: RequestInit } | null = null;
  try {
    process.env.EMBEDDING_PROVIDER = "voyage";
    process.env.VOYAGE_API_KEY = "vk-test-1234";

    const fakeVec = Array.from({ length: 1024 }, (_, i) => (i % 2 === 0 ? 0.1 : -0.1));
    installFetchStub(({ url, init }) => {
      captured = { url, init };
      return new Response(
        JSON.stringify({ data: [{ embedding: fakeVec }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const mod = await import("../../src/lib/knowledge/embedder.ts");
    mod.__resetClientsForTests();

    const out = await mod.embedBatch(["hello world"]);

    assert.equal(out.length, 1);
    assert.equal(out[0].length, 1536, "padded to target dim");
    // first 1024 entries match the source vector
    for (let i = 0; i < 1024; i++) assert.equal(out[0][i], fakeVec[i]);
    // tail is zero-padded
    for (let i = 1024; i < 1536; i++) assert.equal(out[0][i], 0);

    assert.ok(captured, "fetch was invoked");
    assert.equal(captured!.url, "https://api.voyageai.com/v1/embeddings");
    const headers = captured!.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer vk-test-1234");
    assert.equal(headers["Content-Type"], "application/json");
    const body = JSON.parse(String(captured!.init.body));
    assert.equal(body.model, "voyage-3-large");
    assert.equal(body.output_dimension, 1024);
    assert.deepEqual(body.input, ["hello world"]);
  } finally {
    restoreFetch();
    restoreEnv(snap);
  }
});

test("voyage path raises if Voyage returns the wrong dimension", async () => {
  const snap = snapshotEnv();
  try {
    process.env.EMBEDDING_PROVIDER = "voyage";
    process.env.VOYAGE_API_KEY = "vk-test-1234";

    installFetchStub(() =>
      new Response(
        JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const mod = await import("../../src/lib/knowledge/embedder.ts");
    mod.__resetClientsForTests();

    await assert.rejects(
      () => mod.embedBatch(["x"]),
      (err: Error) => /unexpected dim/.test(err.message),
    );
  } finally {
    restoreFetch();
    restoreEnv(snap);
  }
});

test("voyage path surfaces non-2xx HTTP errors with the response body", async () => {
  const snap = snapshotEnv();
  try {
    process.env.EMBEDDING_PROVIDER = "voyage";
    process.env.VOYAGE_API_KEY = "vk-bad";

    installFetchStub(() =>
      new Response("invalid api key", { status: 401 }),
    );

    const mod = await import("../../src/lib/knowledge/embedder.ts");
    mod.__resetClientsForTests();

    await assert.rejects(
      () => mod.embedBatch(["x"]),
      (err: Error) => /Voyage embeddings HTTP 401/.test(err.message) && /invalid api key/.test(err.message),
    );
  } finally {
    restoreFetch();
    restoreEnv(snap);
  }
});

test("openai backend still fails loud when its key is missing (explicit opt-in)", async () => {
  const snap = snapshotEnv();
  try {
    process.env.EMBEDDING_PROVIDER = "openai";
    delete process.env.OPENAI_API_KEY;

    const mod = await import("../../src/lib/knowledge/embedder.ts");
    mod.__resetClientsForTests();

    await assert.rejects(
      () => mod.embedBatch(["hello"]),
      (err: Error) => /OPENAI_API_KEY not set/.test(err.message),
    );
  } finally {
    restoreEnv(snap);
  }
});

test("unknown EMBEDDING_PROVIDER value is rejected", async () => {
  const snap = snapshotEnv();
  try {
    process.env.EMBEDDING_PROVIDER = "cohere";

    const mod = await import("../../src/lib/knowledge/embedder.ts");
    mod.__resetClientsForTests();

    await assert.rejects(
      () => mod.embedBatch(["hello"]),
      (err: Error) => /Unknown EMBEDDING_PROVIDER='cohere'/.test(err.message),
    );
  } finally {
    restoreEnv(snap);
  }
});

test("empty input short-circuits without selecting a provider or hitting the network", async () => {
  const snap = snapshotEnv();
  try {
    // Hostile env: invalid provider, no keys. embedBatch([]) must not throw.
    process.env.EMBEDDING_PROVIDER = "garbage";
    delete process.env.OPENAI_API_KEY;
    delete process.env.VOYAGE_API_KEY;

    const mod = await import("../../src/lib/knowledge/embedder.ts");
    mod.__resetClientsForTests();

    const out = await mod.embedBatch([]);
    assert.deepEqual(out, []);
  } finally {
    restoreEnv(snap);
  }
});

test("toPgVector formats arrays as pgvector literal", async () => {
  const mod = await import("../../src/lib/knowledge/embedder.ts");
  assert.equal(mod.toPgVector([0.1, 0.2, -0.3]), "[0.1,0.2,-0.3]");
  assert.equal(mod.toPgVector([]), "[]");
});
