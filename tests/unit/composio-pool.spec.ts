import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

/**
 * Unit tests for src/lib/composio/proxy.ts (PR 4 pool rotation).
 *
 * Boundary mocks:
 *   - globalThis.fetch intercepts BOTH the Supabase REST call inside
 *     listComposioTokensForUser AND the outbound Composio executeAction
 *     request. The router below dispatches per-URL.
 *   - We never mock composioCall / listComposioTokensForUser / the
 *     getConnection fallback - the SUT is the rotation logic itself.
 *
 * Cooldown caveat: the in-process CONNECTION_COOLDOWN map persists for
 * the lifetime of the module. Each test uses unique nango_connection_id
 * values so cold marks from earlier tests can't bleed in.
 */

type FetchLike = typeof fetch;
const realFetch: FetchLike = globalThis.fetch;

type CapturedRequest = {
  url: string;
  method: string;
  body: string | null;
};

const ENV_KEYS = [
  "COMPOSIO_API_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetchRouter(
  router: (req: CapturedRequest) => Response | Promise<Response>,
): { calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  (globalThis as { fetch: FetchLike }).fetch = (async (
    input: unknown,
    init?: RequestInit,
  ) => {
    const url =
      typeof input === "string"
        ? input
        : (input as { url: string }).url ?? String(input);
    const method = (init?.method ?? "GET").toString().toUpperCase();
    const body =
      init?.body == null
        ? null
        : typeof init.body === "string"
          ? init.body
          : String(init.body);
    const req = { url, method, body };
    calls.push(req);
    return router(req);
  }) as unknown as FetchLike;
  return { calls };
}

function restoreFetch() {
  (globalThis as { fetch: FetchLike }).fetch = realFetch;
}

/**
 * Build a fake rgaios_connections row with the minimum fields the
 * proxy reads. Casts loosely - the proxy doesn't validate the full
 * supabase row shape.
 */
function fakeRow(opts: {
  id: string;
  nangoConnectionId: string;
  userId?: string | null;
  status?: string;
}): Record<string, unknown> {
  return {
    id: opts.id,
    organization_id: "org-1",
    provider_config_key: "composio:gmail",
    nango_connection_id: opts.nangoConnectionId,
    display_name: opts.id,
    status: opts.status ?? "connected",
    metadata: {},
    agent_id: null,
    user_id: opts.userId ?? null,
    connected_at: new Date(0).toISOString(),
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  process.env.COMPOSIO_API_KEY = "test-composio-key";
  // crypto.ts derives the encryption key from JWT_SECRET. The
  // resolveComposioApiKey precedence test exercises encryptSecret /
  // tryDecryptSecret round-tripping a per-org key, so we need a
  // deterministic secret in the test process.
  process.env.JWT_SECRET = "test-jwt-secret-for-composio-pool-spec";
});

afterEach(() => {
  restoreFetch();
});

test("composioCall: missing COMPOSIO_API_KEY throws clear error", async () => {
  const snap = snapshotEnv();
  try {
    delete process.env.COMPOSIO_API_KEY;
    // No per-org key row either - resolveComposioApiKey hits Supabase
    // for the row, finds none, then falls through to the env (also
    // missing), so composioCall must surface the "missing" error.
    installFetchRouter((req) => {
      if (req.url.includes("/rest/v1/rgaios_connections")) {
        // Either the per-org key lookup or the pool list - return
        // empty so resolution + pool both come up dry.
        return jsonResponse([]);
      }
      return jsonResponse(null);
    });
    const { composioCall } = await import("@/lib/composio/proxy");
    await assert.rejects(
      () =>
        composioCall("org-1", {
          appKey: "gmail",
          action: "GMAIL_SEND_EMAIL",
          input: {},
        }),
      (err: Error) =>
        /Composio API key missing/.test(err.message) ||
        /COMPOSIO_API_KEY missing/.test(err.message),
    );
  } finally {
    restoreEnv(snap);
  }
});

test("resolveComposioApiKey: per-org key beats env when present", async () => {
  const snap = snapshotEnv();
  try {
    process.env.COMPOSIO_API_KEY = "env-fleet-key";
    // Per-org row stores an encryptable key. We use the real
    // encryptSecret/tryDecryptSecret pair so this round-trips.
    const { encryptSecret } = await import("@/lib/crypto");
    const encrypted = encryptSecret("per-org-tenant-key");
    installFetchRouter((req) => {
      if (req.url.includes("/rest/v1/rgaios_connections")) {
        // Both the precedence lookup AND any subsequent pool list see
        // a row that contains the encrypted api_key. Our resolver
        // filters by provider_config_key='composio-key' so the same
        // mock works across the two queries.
        return jsonResponse([
          {
            metadata: { api_key: encrypted },
          },
        ]);
      }
      return jsonResponse(null);
    });
    const { resolveComposioApiKey } = await import("@/lib/composio/proxy");
    const key = await resolveComposioApiKey("org-1");
    assert.equal(
      key,
      "per-org-tenant-key",
      "per-org row beats COMPOSIO_API_KEY env",
    );
  } finally {
    restoreEnv(snap);
  }
});

test("resolveComposioApiKey: falls back to env when no per-org row", async () => {
  const snap = snapshotEnv();
  try {
    process.env.COMPOSIO_API_KEY = "env-fleet-key";
    installFetchRouter((req) => {
      if (req.url.includes("/rest/v1/rgaios_connections")) {
        return jsonResponse([]); // no per-org row
      }
      return jsonResponse(null);
    });
    const { resolveComposioApiKey } = await import("@/lib/composio/proxy");
    const key = await resolveComposioApiKey("org-1");
    assert.equal(key, "env-fleet-key");
  } finally {
    restoreEnv(snap);
  }
});

test("single per-user row: fast path, one Composio call, no rotation", async () => {
  const snap = snapshotEnv();
  try {
    const composioCalls: CapturedRequest[] = [];
    installFetchRouter((req) => {
      if (req.url.includes("backend.composio.dev")) {
        composioCalls.push(req);
        return jsonResponse({ ok: true, data: "single-row-result" });
      }
      if (req.url.includes("/rest/v1/rgaios_connections")) {
        // Pool-listing query returns the single per-user row.
        return jsonResponse([
          fakeRow({
            id: "row-A",
            nangoConnectionId: "nango-fast-1",
            userId: "user-1",
          }),
        ]);
      }
      return jsonResponse(null);
    });

    const { composioCall } = await import("@/lib/composio/proxy");
    const out = await composioCall<{ ok: boolean; data: string }>(
      "org-1",
      { appKey: "gmail", action: "GMAIL_SEND_EMAIL", input: { to: "x@y.z" } },
      "user-1",
    );
    assert.deepEqual(out, { ok: true, data: "single-row-result" });
    assert.equal(composioCalls.length, 1, "single Composio call, no rotation");
    const body = JSON.parse(composioCalls[0].body ?? "{}");
    assert.equal(body.connected_account_id, "nango-fast-1");
    assert.equal(body.user_id, "user-1", "per-user entityId");
    assert.deepEqual(body.arguments, { to: "x@y.z" });
  } finally {
    restoreEnv(snap);
  }
});

test("two per-user rows: rotates from row A to row B on 429", async () => {
  const snap = snapshotEnv();
  // Silence the route's expected console.warn for the rotation log.
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const composioCalls: CapturedRequest[] = [];
    let composioCallIdx = 0;
    installFetchRouter((req) => {
      if (req.url.includes("backend.composio.dev")) {
        composioCalls.push(req);
        composioCallIdx += 1;
        // First call (row A) returns 429.
        if (composioCallIdx === 1) {
          return new Response("Too Many Requests", { status: 429 });
        }
        // Second call (row B) succeeds.
        return jsonResponse({ ok: true, data: "row-B-wins" });
      }
      if (req.url.includes("/rest/v1/rgaios_connections")) {
        // Both per-user rows for same user.
        return jsonResponse([
          fakeRow({
            id: "row-A",
            nangoConnectionId: "nango-pool-A",
            userId: "user-1",
          }),
          fakeRow({
            id: "row-B",
            nangoConnectionId: "nango-pool-B",
            userId: "user-1",
          }),
        ]);
      }
      return jsonResponse(null);
    });

    const { composioCall } = await import("@/lib/composio/proxy");
    const out = await composioCall<{ ok: boolean; data: string }>(
      "org-1",
      { appKey: "gmail", action: "GMAIL_SEND_EMAIL", input: {} },
      "user-1",
    );
    assert.equal(out.data, "row-B-wins", "second row's payload returned");
    assert.equal(composioCalls.length, 2, "exactly two Composio attempts");
    // Verify the rotation actually used different connection ids.
    const ids = composioCalls.map((c) => {
      const b = JSON.parse(c.body ?? "{}");
      return b.connected_account_id;
    });
    assert.deepEqual(ids, ["nango-pool-A", "nango-pool-B"]);
  } finally {
    console.warn = origWarn;
    restoreEnv(snap);
  }
});

test("1 per-user + 1 org-wide row: per-user wins on first pass", async () => {
  const snap = snapshotEnv();
  try {
    const composioCalls: CapturedRequest[] = [];
    installFetchRouter((req) => {
      if (req.url.includes("backend.composio.dev")) {
        composioCalls.push(req);
        return jsonResponse({ ok: true });
      }
      if (req.url.includes("/rest/v1/rgaios_connections")) {
        // Order from supabase doesn't matter - the proxy sorts.
        return jsonResponse([
          fakeRow({
            id: "row-orgwide",
            nangoConnectionId: "nango-orgwide",
            userId: null,
          }),
          fakeRow({
            id: "row-mine",
            nangoConnectionId: "nango-mine",
            userId: "user-1",
          }),
        ]);
      }
      return jsonResponse(null);
    });

    const { composioCall } = await import("@/lib/composio/proxy");
    await composioCall(
      "org-1",
      { appKey: "gmail", action: "GMAIL_SEND_EMAIL", input: {} },
      "user-1",
    );
    assert.equal(composioCalls.length, 1, "first attempt succeeds, no rotation");
    const body = JSON.parse(composioCalls[0].body ?? "{}");
    assert.equal(
      body.connected_account_id,
      "nango-mine",
      "per-user row beats org-wide row",
    );
    assert.equal(body.user_id, "user-1");
  } finally {
    restoreEnv(snap);
  }
});

test("listComposioTokensForUser: per-user rows first, then org-wide, deterministic by id", async () => {
  const snap = snapshotEnv();
  try {
    installFetchRouter((req) => {
      if (req.url.includes("/rest/v1/rgaios_connections")) {
        // Intentionally unsorted: we'll assert the proxy resorts.
        return jsonResponse([
          fakeRow({ id: "z-orgwide", nangoConnectionId: "n1", userId: null }),
          fakeRow({ id: "b-mine", nangoConnectionId: "n2", userId: "user-1" }),
          fakeRow({ id: "a-other", nangoConnectionId: "n3", userId: "user-2" }),
          fakeRow({ id: "a-mine", nangoConnectionId: "n4", userId: "user-1" }),
        ]);
      }
      return jsonResponse(null);
    });

    const { listComposioTokensForUser } = await import(
      "@/lib/composio/proxy"
    );
    const rows = await listComposioTokensForUser(
      "org-1",
      "composio:gmail",
      "user-1",
    );
    const ids = rows.map((r) => r.id);
    // Caller's per-user rows first (a-mine before b-mine by id sort),
    // then other-user rows, then org-wide (null) row.
    assert.deepEqual(ids, ["a-mine", "b-mine", "a-other", "z-orgwide"]);
  } finally {
    restoreEnv(snap);
  }
});

test("all rows cold + sibling fresh row -> fresh fires first", async () => {
  const snap = snapshotEnv();
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const composioCalls: CapturedRequest[] = [];
    let listCallCount = 0;
    let succeedingCallId: string | null = null;

    installFetchRouter((req) => {
      if (req.url.includes("backend.composio.dev")) {
        composioCalls.push(req);
        const b = JSON.parse(req.body ?? "{}");
        // 429 every row except the one we mark "fresh".
        if (b.connected_account_id === succeedingCallId) {
          return jsonResponse({ ok: true, marker: "fresh-wins" });
        }
        return new Response("Too Many Requests", { status: 429 });
      }
      if (req.url.includes("/rest/v1/rgaios_connections")) {
        listCallCount += 1;
        return jsonResponse([
          fakeRow({
            id: "row-cold-1",
            nangoConnectionId: "nango-cold-A",
            userId: "user-cold",
          }),
          fakeRow({
            id: "row-cold-2",
            nangoConnectionId: "nango-cold-B",
            userId: "user-cold",
          }),
        ]);
      }
      return jsonResponse(null);
    });

    const { composioCall } = await import("@/lib/composio/proxy");

    // Pass 1: both rows 429, both marked cold. Pool exhausts.
    succeedingCallId = null;
    await assert.rejects(() =>
      composioCall(
        "org-1",
        { appKey: "gmail", action: "GMAIL_SEND_EMAIL", input: {} },
        "user-cold",
      ),
    );
    // Each row tried exactly ONCE: pass 1 attempts both fresh rows,
    // both 429, both marked cold + recorded in `attempted`; pass 2's
    // filter skips already-attempted rows so it re-runs nothing and
    // the pool fails fast = 2 calls. (Pre-fix this was 4 - pass 2's
    // `() => true` filter re-ran the rows pass 1 already failed.)
    assert.equal(composioCalls.length, 2);

    // Pass 2: still both cold (60s TTL). But now we add a third row
    // that's brand-new (fresh). Fresh row should fire first.
    composioCalls.length = 0;
    listCallCount = 0;
    succeedingCallId = "nango-fresh-NEW";
    installFetchRouter((req) => {
      if (req.url.includes("backend.composio.dev")) {
        composioCalls.push(req);
        const b = JSON.parse(req.body ?? "{}");
        if (b.connected_account_id === succeedingCallId) {
          return jsonResponse({ ok: true, marker: "fresh-wins" });
        }
        return new Response("Too Many Requests", { status: 429 });
      }
      if (req.url.includes("/rest/v1/rgaios_connections")) {
        listCallCount += 1;
        return jsonResponse([
          fakeRow({
            id: "row-cold-1",
            nangoConnectionId: "nango-cold-A",
            userId: "user-cold",
          }),
          fakeRow({
            id: "row-cold-2",
            nangoConnectionId: "nango-cold-B",
            userId: "user-cold",
          }),
          fakeRow({
            id: "row-fresh",
            nangoConnectionId: "nango-fresh-NEW",
            userId: "user-cold",
          }),
        ]);
      }
      return jsonResponse(null);
    });

    const out = await composioCall<{ marker: string }>(
      "org-1",
      { appKey: "gmail", action: "GMAIL_SEND_EMAIL", input: {} },
      "user-cold",
    );
    assert.equal(out.marker, "fresh-wins");
    // Fresh row should be the FIRST attempt (cold rows skipped on
    // pass 1). With deterministic id sort: row-cold-1, row-cold-2,
    // row-fresh. Cold filter skips the first two -> fresh fires first.
    assert.equal(
      composioCalls[0].body && JSON.parse(composioCalls[0].body).connected_account_id,
      "nango-fresh-NEW",
      "fresh row fires before cold siblings on pass 1",
    );
    assert.equal(
      composioCalls.length,
      1,
      "fresh row succeeded on first attempt - no extra calls",
    );
  } finally {
    console.warn = origWarn;
    restoreEnv(snap);
  }
});

test("pool exhausted: all 401 -> last upstream error bubbles (not generic 'not connected')", async () => {
  const snap = snapshotEnv();
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    let composioCallIdx = 0;
    installFetchRouter((req) => {
      if (req.url.includes("backend.composio.dev")) {
        composioCallIdx += 1;
        return new Response(
          `unauthorized #${composioCallIdx}`,
          { status: 401 },
        );
      }
      if (req.url.includes("/rest/v1/rgaios_connections")) {
        return jsonResponse([
          fakeRow({
            id: "row-1",
            nangoConnectionId: "nango-401-A",
            userId: "user-x",
          }),
          fakeRow({
            id: "row-2",
            nangoConnectionId: "nango-401-B",
            userId: "user-x",
          }),
        ]);
      }
      return jsonResponse(null);
    });

    const { composioCall } = await import("@/lib/composio/proxy");
    await assert.rejects(
      () =>
        composioCall(
          "org-1",
          { appKey: "gmail", action: "GMAIL_SEND_EMAIL", input: {} },
          "user-x",
        ),
      (err: Error) => {
        // Must be the upstream Composio HTTP error, not the generic
        // pool-exhausted string.
        assert.match(err.message, /401/);
        assert.match(err.message, /unauthorized/);
        assert.doesNotMatch(
          err.message,
          /pool exhausted/,
          "lastErr surfaces, not the synthetic pool message",
        );
        return true;
      },
    );
  } finally {
    console.warn = origWarn;
    restoreEnv(snap);
  }
});

test("non-401/429 error bubbles immediately, no rotation", async () => {
  const snap = snapshotEnv();
  try {
    let composioCallIdx = 0;
    installFetchRouter((req) => {
      if (req.url.includes("backend.composio.dev")) {
        composioCallIdx += 1;
        // 400 = bad input. Shouldn't rotate; sibling row would 400 too.
        return new Response("missing required field 'to'", { status: 400 });
      }
      if (req.url.includes("/rest/v1/rgaios_connections")) {
        return jsonResponse([
          fakeRow({
            id: "row-1",
            nangoConnectionId: "nango-400-A",
            userId: "user-y",
          }),
          fakeRow({
            id: "row-2",
            nangoConnectionId: "nango-400-B",
            userId: "user-y",
          }),
        ]);
      }
      return jsonResponse(null);
    });

    const { composioCall } = await import("@/lib/composio/proxy");
    await assert.rejects(
      () =>
        composioCall(
          "org-1",
          { appKey: "gmail", action: "GMAIL_SEND_EMAIL", input: {} },
          "user-y",
        ),
      (err: Error) => /400/.test(err.message) && /missing required/.test(err.message),
    );
    assert.equal(
      composioCallIdx,
      1,
      "non-401/429 must bubble immediately - no rotation",
    );
  } finally {
    restoreEnv(snap);
  }
});

test("single-row fast path: row in status='pending' raises clear error (pre-PR4 parity)", async () => {
  const snap = snapshotEnv();
  try {
    // listComposioTokensForUser filters by status='connected' so pending
    // rows are excluded from the pool. The fast path then falls back to
    // getConnection() which returns ALL statuses. Verify the
    // pre-PR-4-shaped error message survives.
    let composioCallCount = 0;
    installFetchRouter((req) => {
      if (req.url.includes("backend.composio.dev")) {
        composioCallCount += 1;
        return jsonResponse({ ok: true });
      }
      if (req.url.includes("/rest/v1/rgaios_connections")) {
        // Pool query (status=connected filter): empty result.
        // Fallback getConnection query: returns the pending row.
        const isStatusFilter = req.url.includes("status=eq.connected");
        if (isStatusFilter) return jsonResponse([]);
        // getConnection's per-user query then null-user query.
        return jsonResponse(
          fakeRow({
            id: "pending-row",
            nangoConnectionId: "nango-pending",
            userId: null,
            status: "pending",
          }),
        );
      }
      return jsonResponse(null);
    });

    const { composioCall } = await import("@/lib/composio/proxy");
    await assert.rejects(
      () =>
        composioCall("org-1", {
          appKey: "gmail",
          action: "GMAIL_SEND_EMAIL",
          input: {},
        }),
      (err: Error) =>
        /status='pending'/.test(err.message) &&
        /finish OAuth/.test(err.message),
    );
    assert.equal(composioCallCount, 0, "no Composio call for pending row");
  } finally {
    restoreEnv(snap);
  }
});

test("composioCall passes opts.input verbatim to Composio executeAction", async () => {
  const snap = snapshotEnv();
  try {
    type Captured = { url: string; body: string | null };
    const captured: Captured[] = [];
    installFetchRouter((req) => {
      if (req.url.includes("backend.composio.dev")) {
        captured.push({ url: req.url, body: req.body });
        return jsonResponse({ ok: true });
      }
      if (req.url.includes("/rest/v1/rgaios_connections")) {
        return jsonResponse([
          fakeRow({
            id: "verbatim-row",
            nangoConnectionId: "nango-verbatim",
            userId: "user-vb",
          }),
        ]);
      }
      return jsonResponse(null);
    });

    const { composioCall } = await import("@/lib/composio/proxy");
    const input = {
      to: "alice@example.com",
      subject: "test",
      body: "hi",
      nested: { foo: ["a", "b"] },
    };
    await composioCall(
      "org-1",
      { appKey: "gmail", action: "GMAIL_SEND_EMAIL", input },
      "user-vb",
    );
    assert.equal(captured.length, 1);
    assert.match(captured[0].url, /\/tools\/execute\/GMAIL_SEND_EMAIL$/);
    const body = JSON.parse(captured[0].body ?? "{}");
    assert.deepEqual(body.arguments, input, "input passed through unchanged");
    assert.equal(body.user_id, "user-vb");
    assert.equal(body.connected_account_id, "nango-verbatim");
  } finally {
    restoreEnv(snap);
  }
});
