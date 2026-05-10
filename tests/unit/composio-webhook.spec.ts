import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

/**
 * Unit tests for src/app/api/webhooks/composio/route.ts (PR 4 webhook).
 *
 * Boundary mocks:
 *   - globalThis.fetch intercepts Supabase REST calls. Each fetch
 *     handler captures the body / URL so assertions can inspect what
 *     the route would have written to the DB.
 *   - We never touch composio's HTTP API in these tests; the webhook is
 *     receive-only.
 *
 * The route handler itself (verifySignature, pickConnectionId, encrypt
 * + audit-log writes) is the SUT and is exercised end-to-end - we only
 * stub the external boundaries (HTTP -> Supabase, env vars).
 */

type FetchLike = typeof fetch;
const realFetch: FetchLike = globalThis.fetch;

type CapturedRequest = {
  url: string;
  method: string;
  body: string | null;
  headers: Record<string, string>;
};

const ENV_KEYS = [
  "COMPOSIO_WEBHOOK_SECRET",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "JWT_SECRET",
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

/** Capture every fetch call and respond per the supplied router. */
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
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string> | Headers;
      if (h instanceof Headers) {
        h.forEach((v, k) => (headers[k.toLowerCase()] = v));
      } else {
        for (const [k, v] of Object.entries(h)) {
          headers[k.toLowerCase()] = String(v);
        }
      }
    }
    const req = { url, method, body, headers };
    calls.push(req);
    return router(req);
  }) as unknown as FetchLike;
  return { calls };
}

function restoreFetch() {
  (globalThis as { fetch: FetchLike }).fetch = realFetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Build a NextRequest carrying an HMAC-SHA256 signature header so the
 * route's verifySignature passes. headerStyle controls "hex" vs
 * "sha256=hex".
 */
async function makeRequest(
  body: string,
  secret: string,
  opts: {
    headerStyle?: "hex" | "prefixed" | "missing" | "tampered";
    overrideSignature?: string;
  } = {},
) {
  const { NextRequest } = await import("next/server");
  const sig = crypto
    .createHmac("sha256", secret)
    .update(body, "utf8")
    .digest("hex");
  const headers: Record<string, string> = { "content-type": "application/json" };
  const style = opts.headerStyle ?? "hex";
  if (opts.overrideSignature !== undefined) {
    headers["x-composio-signature"] = opts.overrideSignature;
  } else if (style === "hex") {
    headers["x-composio-signature"] = sig;
  } else if (style === "prefixed") {
    headers["x-composio-signature"] = `sha256=${sig}`;
  } else if (style === "tampered") {
    headers["x-composio-signature"] = sig.replace(/^./, "0");
  }
  return new NextRequest("https://example.com/api/webhooks/composio", {
    method: "POST",
    body,
    headers,
  });
}

beforeEach(() => {
  // Ensure each test starts from a known-clean env before mutating.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  process.env.JWT_SECRET = "test-jwt-secret-for-encryption-key-derivation";
  process.env.COMPOSIO_WEBHOOK_SECRET = "test-webhook-secret";
});

afterEach(() => {
  restoreFetch();
});

test("missing COMPOSIO_WEBHOOK_SECRET responds 401 with reason='secret unset'", async () => {
  const snap = snapshotEnv();
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    delete process.env.COMPOSIO_WEBHOOK_SECRET;
    installFetchRouter(() => {
      throw new Error("route should never reach Supabase when secret is unset");
    });
    const { POST } = await import("@/app/api/webhooks/composio/route");
    const req = await makeRequest("{}", "irrelevant");
    const res = await POST(req);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.deepEqual(body, { ok: false, reason: "secret unset" });
  } finally {
    console.warn = origWarn;
    restoreEnv(snap);
  }
});

test("bad signature responds 401 with reason='bad signature' and never touches DB", async () => {
  const snap = snapshotEnv();
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const router = installFetchRouter(() => {
      throw new Error("DB must not be hit when signature fails");
    });
    const { POST } = await import("@/app/api/webhooks/composio/route");
    const req = await makeRequest(
      JSON.stringify({ type: "connection.revoked" }),
      "test-webhook-secret",
      { headerStyle: "tampered" },
    );
    const res = await POST(req);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.deepEqual(body, { ok: false, reason: "bad signature" });
    assert.equal(router.calls.length, 0);
  } finally {
    console.warn = origWarn;
    restoreEnv(snap);
  }
});

test("missing signature header responds 401", async () => {
  const snap = snapshotEnv();
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    installFetchRouter(() => jsonResponse(null));
    const { POST } = await import("@/app/api/webhooks/composio/route");
    const req = await makeRequest(
      JSON.stringify({ type: "connection.revoked" }),
      "test-webhook-secret",
      { headerStyle: "missing" },
    );
    const res = await POST(req);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.reason, "bad signature");
  } finally {
    console.warn = origWarn;
    restoreEnv(snap);
  }
});

test("hex digest header AND sha256=<hex> header both verify", async () => {
  const snap = snapshotEnv();
  const origInfo = console.info;
  console.info = () => {};
  try {
    // Both styles should pass verification and reach the unknown-event
    // branch (no DB writes for an unknown type).
    installFetchRouter(() => jsonResponse(null));
    const { POST } = await import("@/app/api/webhooks/composio/route");

    const body = JSON.stringify({ type: "future.unknown.event" });
    for (const headerStyle of ["hex", "prefixed"] as const) {
      const req = await makeRequest(body, "test-webhook-secret", {
        headerStyle,
      });
      const res = await POST(req);
      assert.equal(
        res.status,
        200,
        `header style ${headerStyle} should verify and ack`,
      );
      const j = await res.json();
      assert.equal(j.ok, true);
      assert.equal(j.ignored, "future.unknown.event");
    }
  } finally {
    console.info = origInfo;
    restoreEnv(snap);
  }
});

test("verification path uses crypto.timingSafeEqual (length mismatch returns false safely)", async () => {
  // Cover the timing-safe path: a header that's the wrong length must
  // return false WITHOUT throwing (timingSafeEqual would throw on
  // unequal-length buffers, route guards via timingSafeHexEqual).
  const snap = snapshotEnv();
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    installFetchRouter(() => jsonResponse(null));
    const { POST } = await import("@/app/api/webhooks/composio/route");
    const req = await makeRequest("{}", "test-webhook-secret", {
      overrideSignature: "abc123", // far shorter than 64 hex chars
    });
    const res = await POST(req);
    assert.equal(res.status, 401, "short signature must fail closed, not throw");
  } finally {
    console.warn = origWarn;
    restoreEnv(snap);
  }
});

test("connection.revoked flips status='error' and writes audit row", async () => {
  // The route does (1) SELECT row by nango_connection_id to learn its
  // primary key + org_id, (2) UPDATE keyed on row.id, (3) INSERT audit.
  // Two-step lookup-then-update prevents cross-tenant updates if
  // nango_connection_id values were ever non-unique. This test handles
  // GET (the lookup) AND PATCH (the keyed update) in the same router.
  const snap = snapshotEnv();
  try {
    const updates: { url: string; body: string | null }[] = [];
    const inserts: { url: string; body: string | null }[] = [];

    installFetchRouter((req) => {
      if (req.url.includes("/rest/v1/rgaios_connections")) {
        if (req.method === "GET") {
          // Lookup the row before update.
          return jsonResponse([
            { id: "row-1", organization_id: "org-1" },
          ]);
        }
        if (req.method === "PATCH") {
          updates.push({ url: req.url, body: req.body });
          return jsonResponse([{ id: "row-1" }]);
        }
      }
      if (req.url.includes("/rest/v1/rgaios_audit_log")) {
        if (req.method === "POST") {
          inserts.push({ url: req.url, body: req.body });
          return jsonResponse(null, 201);
        }
      }
      return jsonResponse(null);
    });

    const { POST } = await import("@/app/api/webhooks/composio/route");
    const body = JSON.stringify({
      type: "connection.revoked",
      connectionId: "conn-abc",
    });
    const req = await makeRequest(body, "test-webhook-secret");
    const res = await POST(req);
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.ok, true);
    assert.equal(j.type, "connection.revoked");
    assert.equal(j.row_id, "row-1");

    assert.equal(updates.length, 1, "exactly one update to rgaios_connections");
    assert.match(
      updates[0].body ?? "",
      /"status":"error"/,
      "update body sets status='error'",
    );
    // Update is keyed on the primary key (row.id), not the
    // nango_connection_id - cross-tenant safety mentioned in source.
    assert.match(
      updates[0].url,
      /id=eq\.row-1/,
      "PATCH targets row primary key",
    );
    assert.equal(inserts.length, 1, "exactly one audit insert");
    const auditBody = JSON.parse(inserts[0].body ?? "{}");
    assert.equal(auditBody.kind, "composio_connection_revoked");
    assert.equal(auditBody.actor_type, "system");
    assert.equal(auditBody.actor_id, "composio-webhook");
    assert.equal(auditBody.detail.connection_id, "conn-abc");
    assert.equal(auditBody.detail.row_id, "row-1");
  } finally {
    restoreEnv(snap);
  }
});

test("connection.revoked for unknown connectionId logs unknown_id audit row, no UPDATE", async () => {
  // PR-4 hardening: if the SELECT returns no row, the route writes a
  // distinct audit kind ('composio_connection_revoked_unknown_id') so
  // ops can spot a misconfigured webhook target without polluting the
  // main revoked log. No UPDATE issued.
  const snap = snapshotEnv();
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const updates: { method: string }[] = [];
    let unknownAuditBody: string | null = null;
    installFetchRouter((req) => {
      if (req.url.includes("/rest/v1/rgaios_connections")) {
        if (req.method === "GET") return jsonResponse([]); // not found
        if (req.method === "PATCH") {
          updates.push({ method: req.method });
          return jsonResponse([]);
        }
      }
      if (req.url.includes("/rest/v1/rgaios_audit_log") && req.method === "POST") {
        unknownAuditBody = req.body;
        return jsonResponse(null, 201);
      }
      return jsonResponse(null);
    });
    const { POST } = await import("@/app/api/webhooks/composio/route");
    const body = JSON.stringify({
      type: "connection.revoked",
      connectionId: "ghost-conn",
    });
    const req = await makeRequest(body, "test-webhook-secret");
    const res = await POST(req);
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.row_id, null);
    assert.equal(updates.length, 0, "no PATCH for unknown row");
    assert.ok(unknownAuditBody);
    const a = JSON.parse(unknownAuditBody!);
    assert.equal(a.kind, "composio_connection_revoked_unknown_id");
    assert.equal(a.organization_id, null);
  } finally {
    console.warn = origWarn;
    restoreEnv(snap);
  }
});

test("connection.refreshed rotates encrypted access_token and preserves sibling metadata", async () => {
  const snap = snapshotEnv();
  try {
    let capturedUpdateBody: string | null = null;
    let capturedAuditBody: string | null = null;

    installFetchRouter((req) => {
      if (req.url.includes("/rest/v1/rgaios_connections")) {
        if (req.method === "GET") {
          // existing-row lookup before the update
          return jsonResponse([
            {
              id: "row-2",
              organization_id: "org-2",
              metadata: {
                display_name: "Work Gmail",
                scopes: ["gmail.readonly"],
                access_token: "enc:v1:OLDTOKEN",
              },
            },
          ]);
        }
        if (req.method === "PATCH") {
          capturedUpdateBody = req.body;
          return jsonResponse([{ id: "row-2" }]);
        }
      }
      if (
        req.url.includes("/rest/v1/rgaios_audit_log") &&
        req.method === "POST"
      ) {
        capturedAuditBody = req.body;
        return jsonResponse(null, 201);
      }
      return jsonResponse(null);
    });

    const { POST } = await import("@/app/api/webhooks/composio/route");
    const body = JSON.stringify({
      type: "connection.refreshed",
      connectionId: "conn-xyz",
      payload: {
        access_token: "ya29.NEW_PLAINTEXT_TOKEN",
        refresh_token: "1//refresh-new",
        expires_at: 1234567890,
      },
    });
    const req = await makeRequest(body, "test-webhook-secret");
    const res = await POST(req);
    assert.equal(res.status, 200);

    assert.ok(capturedUpdateBody, "update body captured");
    const updateJson = JSON.parse(capturedUpdateBody!);
    assert.equal(
      updateJson.status,
      "connected",
      "refresh restores status='connected'",
    );
    const meta = updateJson.metadata as Record<string, unknown>;
    // Sibling fields preserved
    assert.equal(meta.display_name, "Work Gmail");
    assert.deepEqual(meta.scopes, ["gmail.readonly"]);
    // Token rotated AND encrypted (enc:v1: prefix from src/lib/crypto)
    assert.notEqual(meta.access_token, "enc:v1:OLDTOKEN");
    assert.match(
      String(meta.access_token),
      /^enc:v1:/,
      "access_token written as encrypted blob, not plaintext",
    );
    assert.doesNotMatch(
      String(meta.access_token),
      /ya29\.NEW_PLAINTEXT_TOKEN/,
      "plaintext token never persisted",
    );
    assert.match(String(meta.refresh_token), /^enc:v1:/);
    assert.equal(meta.expires_at, 1234567890);

    assert.ok(capturedAuditBody, "audit body captured");
    const auditJson = JSON.parse(capturedAuditBody!);
    assert.equal(auditJson.kind, "composio_connection_refreshed");
    assert.equal(auditJson.detail.rotated_refresh_token, true);
  } finally {
    restoreEnv(snap);
  }
});

test("action.failed appends an audit row with the full event detail", async () => {
  const snap = snapshotEnv();
  try {
    let capturedAuditBody: string | null = null;
    installFetchRouter((req) => {
      if (req.url.includes("/rest/v1/rgaios_connections") && req.method === "GET") {
        return jsonResponse([{ organization_id: "org-3" }]);
      }
      if (req.url.includes("/rest/v1/rgaios_audit_log") && req.method === "POST") {
        capturedAuditBody = req.body;
        return jsonResponse(null, 201);
      }
      return jsonResponse(null);
    });

    const { POST } = await import("@/app/api/webhooks/composio/route");
    const event = {
      type: "action.failed",
      connectionId: "conn-fail-1",
      action: "GMAIL_SEND_EMAIL",
      error: "rate_limit",
    };
    const req = await makeRequest(
      JSON.stringify(event),
      "test-webhook-secret",
    );
    const res = await POST(req);
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.type, "action.failed");
    assert.ok(capturedAuditBody);
    const a = JSON.parse(capturedAuditBody!);
    assert.equal(a.kind, "composio_action_failed");
    assert.equal(a.organization_id, "org-3");
    assert.deepEqual(a.detail.event, event);
  } finally {
    restoreEnv(snap);
  }
});

test("unknown event type acks 200 with ignored=<type> and writes nothing", async () => {
  const snap = snapshotEnv();
  const origInfo = console.info;
  console.info = () => {};
  try {
    const router = installFetchRouter(() => jsonResponse(null));
    const { POST } = await import("@/app/api/webhooks/composio/route");
    const req = await makeRequest(
      JSON.stringify({ type: "totally.new.event", connectionId: "x" }),
      "test-webhook-secret",
    );
    const res = await POST(req);
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.deepEqual(j, { ok: true, ignored: "totally.new.event" });
    assert.equal(router.calls.length, 0, "no DB calls for unknown type");
  } finally {
    console.info = origInfo;
    restoreEnv(snap);
  }
});

test("internal handler error still returns 200 with reason='handler error'", async () => {
  const snap = snapshotEnv();
  // Silence the expected console.error from the route's catch branch.
  const origErr = console.error;
  console.error = () => {};
  try {
    // Stub supabase to return the existing row with old token so
    // refreshed branch enters the encryptSecret call. Then unset
    // JWT_SECRET so encryptSecret throws inside the try block - that
    // exercises the route's catch path AND returns 200.
    delete process.env.JWT_SECRET;
    installFetchRouter((req) => {
      if (req.url.includes("/rest/v1/rgaios_connections") && req.method === "GET") {
        return jsonResponse([
          {
            id: "row-die",
            organization_id: "org-die",
            metadata: {},
          },
        ]);
      }
      return jsonResponse(null);
    });
    const { POST } = await import("@/app/api/webhooks/composio/route");
    const req = await makeRequest(
      JSON.stringify({
        type: "connection.refreshed",
        connectionId: "c-die",
        payload: { access_token: "tok" },
      }),
      "test-webhook-secret",
    );
    const res = await POST(req);
    assert.equal(res.status, 200, "must ack so Composio stops retrying");
    const j = await res.json();
    assert.equal(j.ok, false);
    assert.equal(j.reason, "handler error");
  } finally {
    console.error = origErr;
    restoreEnv(snap);
  }
});

test("connectionId resolves from event.connectionId, event.data.connectionId, event.data.connection_id", async () => {
  const snap = snapshotEnv();
  try {
    const seenIds: string[] = [];
    installFetchRouter((req) => {
      if (
        req.url.includes("/rest/v1/rgaios_connections") &&
        req.method === "GET"
      ) {
        // Pre-update SELECT carries the nango_connection_id filter.
        const m = req.url.match(/nango_connection_id=eq\.([^&]+)/);
        if (m) seenIds.push(decodeURIComponent(m[1]));
        return jsonResponse([{ id: "r", organization_id: "o" }]);
      }
      if (
        req.url.includes("/rest/v1/rgaios_connections") &&
        req.method === "PATCH"
      ) {
        return jsonResponse([{ id: "r" }]);
      }
      if (
        req.url.includes("/rest/v1/rgaios_audit_log") &&
        req.method === "POST"
      ) {
        return jsonResponse(null, 201);
      }
      return jsonResponse(null);
    });

    const { POST } = await import("@/app/api/webhooks/composio/route");
    const cases: Array<{ label: string; payload: unknown; expected: string }> = [
      {
        label: "top-level",
        payload: { type: "connection.revoked", connectionId: "id-top" },
        expected: "id-top",
      },
      {
        label: "data.connectionId",
        payload: {
          type: "connection.revoked",
          data: { connectionId: "id-camel" },
        },
        expected: "id-camel",
      },
      {
        label: "data.connection_id",
        payload: {
          type: "connection.revoked",
          data: { connection_id: "id-snake" },
        },
        expected: "id-snake",
      },
    ];
    for (const c of cases) {
      const req = await makeRequest(
        JSON.stringify(c.payload),
        "test-webhook-secret",
      );
      const res = await POST(req);
      assert.equal(res.status, 200, `${c.label}: 200`);
    }
    assert.deepEqual(
      seenIds,
      ["id-top", "id-camel", "id-snake"],
      "all three connectionId shapes resolved",
    );
  } finally {
    restoreEnv(snap);
  }
});

test("missing connectionId on revoked event acks 200 with ignored='no connectionId'", async () => {
  const snap = snapshotEnv();
  // Silence the expected console.warn.
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const router = installFetchRouter(() => jsonResponse(null));
    const { POST } = await import("@/app/api/webhooks/composio/route");
    const req = await makeRequest(
      JSON.stringify({ type: "connection.revoked" }),
      "test-webhook-secret",
    );
    const res = await POST(req);
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.deepEqual(j, { ok: true, ignored: "no connectionId" });
    assert.equal(router.calls.length, 0);
  } finally {
    console.warn = origWarn;
    restoreEnv(snap);
  }
});

test("event.id idempotency: prior audit row short-circuits with duplicate=true", async () => {
  // PR-4 idempotency guard: Composio retries on timeout / non-2xx.
  // The handler dedups by looking up event.id in audit_log first; if a
  // matching row exists we ack immediately without re-running side
  // effects (avoids double status flips + duplicate audit rows).
  const snap = snapshotEnv();
  try {
    let dbCalls = 0;
    let dedupQuerySeen = false;
    installFetchRouter((req) => {
      dbCalls += 1;
      if (
        req.url.includes("/rest/v1/rgaios_audit_log") &&
        req.method === "GET" &&
        req.url.includes("composio_event_id")
      ) {
        dedupQuerySeen = true;
        // Prior event already in the audit log.
        return jsonResponse([{ id: "audit-prior" }]);
      }
      // Anything else (would be the actual side effects) signals a bug.
      throw new Error(
        `unexpected fetch after dedup: ${req.method} ${req.url}`,
      );
    });
    const { POST } = await import("@/app/api/webhooks/composio/route");
    const body = JSON.stringify({
      id: "evt-12345",
      type: "connection.revoked",
      connectionId: "conn-dup",
    });
    const req = await makeRequest(body, "test-webhook-secret");
    const res = await POST(req);
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.deepEqual(j, { ok: true, duplicate: true });
    assert.ok(dedupQuerySeen, "dedup query must have run");
    assert.equal(dbCalls, 1, "exactly one DB call (the dedup lookup)");
  } finally {
    restoreEnv(snap);
  }
});

test("bad JSON body responds 200 with reason='bad json' (no retry storm)", async () => {
  const snap = snapshotEnv();
  try {
    installFetchRouter(() => jsonResponse(null));
    const { POST } = await import("@/app/api/webhooks/composio/route");
    const req = await makeRequest("{not-json,,,", "test-webhook-secret");
    const res = await POST(req);
    assert.equal(res.status, 200, "ack so Composio stops retrying");
    const j = await res.json();
    assert.deepEqual(j, { ok: false, reason: "bad json" });
  } finally {
    restoreEnv(snap);
  }
});
