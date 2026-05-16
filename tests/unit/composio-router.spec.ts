import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// Set env vars eagerly so module-level reads see valid values when
// the router (registers MCP tools) and its proxy deps load.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-key";
process.env.COMPOSIO_API_KEY ??= "test-composio-key";

/**
 * tsx loader treats the alias-resolved `@/lib/mcp/registry` and the
 * relative `../registry` import inside composio-router.ts as distinct
 * module specifiers UNLESS we import the alias version first. Importing
 * the alias side first lets the second (relative) resolution land in
 * the same module cache slot, so registerTool() inside the router
 * mutates the same `tools` Map that listTools() reads back here.
 *
 * Without this ordering hack, the router's tools registration ends up
 * in a phantom module instance and listTools() returns empty.
 */
const REGISTRY_FIRST = import("@/lib/mcp/registry").then(() =>
  import("@/lib/mcp/tools/composio-router"),
);

async function ensureRouterLoaded(): Promise<void> {
  await REGISTRY_FIRST;
}

/**
 * Unit tests for src/lib/mcp/tools/composio-router.ts (PR 2).
 *
 * The module registers two MCP tools at import time:
 *   - composio_use_tool({ app, action, input })
 *   - composio_list_tools({ app? })
 *
 * Boundary mocks:
 *   - globalThis.fetch intercepts BOTH the Composio catalog API
 *     (list_tools) AND the Composio executeAction call (use_tool routes
 *     through composioAction -> composioCall -> fetch).
 *   - listComposioTokensForUser hits Supabase REST; the same fetch
 *     router answers those URLs.
 *
 * The two MCP tool handlers are the SUT - we don't mock them. We do
 * import callTool from the registry to invoke them through the same
 * dispatch path the live MCP route uses.
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

function fakeRow(opts: {
  id: string;
  nangoConnectionId: string;
  userId?: string | null;
}): Record<string, unknown> {
  return {
    id: opts.id,
    organization_id: "org-1",
    provider_config_key: "composio:gmail",
    nango_connection_id: opts.nangoConnectionId,
    display_name: opts.id,
    status: "connected",
    metadata: {},
    agent_id: null,
    user_id: opts.userId ?? null,
    connected_at: new Date(0).toISOString(),
  };
}

beforeEach(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  process.env.COMPOSIO_API_KEY = "test-composio-key";
  await ensureRouterLoaded();
});

afterEach(() => {
  restoreFetch();
});

test("registerTool: both tools are registered with correct shapes", async () => {
  const { listTools } = await import("@/lib/mcp/registry");
  const tools = listTools();
  const list = tools.find((t) => t.name === "composio_list_tools");
  const use = tools.find((t) => t.name === "composio_use_tool");
  assert.ok(list, "composio_list_tools registered");
  assert.ok(use, "composio_use_tool registered");

  // composio_use_tool input schema requires app + action + input
  assert.equal(use!.inputSchema.type, "object");
  assert.deepEqual(
    [...(use!.inputSchema.required ?? [])].sort(),
    ["action", "app", "input"],
  );
  assert.equal(use!.isWrite, true, "use_tool is marked write");

  // composio_list_tools is read-only with optional `app`
  assert.equal(list!.inputSchema.type, "object");
  assert.equal(list!.isWrite, undefined);
  assert.ok(
    "app" in (list!.inputSchema.properties ?? {}),
    "list_tools accepts optional `app`",
  );
});

test("composio_list_tools (no app): hits unfiltered v3 tools endpoint", async () => {
  // The router has a 5-min in-memory cache keyed on
  // `${orgId}:${filter}`. Tests use unique orgIds so a previous test's
  // cached response can't satisfy this one's fetch expectation.
  const router = installFetchRouter((req) => {
    if (req.url.includes("backend.composio.dev/api/v3/tools")) {
      return jsonResponse({
        items: [
          {
            slug: "GMAIL_SEND_EMAIL",
            toolkit: { slug: "gmail" },
            display_name: "Send email",
            description: "Send a Gmail message",
          },
          {
            slug: "SLACK_SEND_MESSAGE",
            toolkit: { slug: "slack" },
            display_name: "Send Slack message",
          },
        ],
      });
    }
    return jsonResponse(null);
  });

  const { callTool } = await import("@/lib/mcp/registry");
  const result = await callTool(
    "composio_list_tools",
    {},
    { organizationId: "org-list-noapp", userId: null },
  );
  assert.equal(result.isError, undefined);
  const text = result.content[0].text;
  assert.match(text, /Composio catalog actions \(2\)/);
  assert.match(text, /GMAIL_SEND_EMAIL/);
  assert.match(text, /SLACK_SEND_MESSAGE/);

  // No `toolkit_slug=` filter on the URL when app is omitted.
  const composioCall = router.calls.find((c) =>
    c.url.includes("backend.composio.dev"),
  );
  assert.ok(composioCall);
  assert.doesNotMatch(composioCall!.url, /toolkit_slug=/);
  assert.equal(composioCall!.headers["x-api-key"], "test-composio-key");
});

test("composio_list_tools (app=gmail): filters via toolkit_slug query param", async () => {
  const router = installFetchRouter((req) => {
    if (req.url.includes("backend.composio.dev/api/v3/tools")) {
      return jsonResponse({
        items: [
          {
            slug: "GMAIL_SEND_EMAIL",
            toolkit: { slug: "gmail" },
            display_name: "Send email",
          },
        ],
      });
    }
    return jsonResponse(null);
  });

  const { callTool } = await import("@/lib/mcp/registry");
  const result = await callTool(
    "composio_list_tools",
    { app: "Gmail" }, // upper-case input must be lowercased
    { organizationId: "org-list-gmail", userId: null },
  );
  assert.equal(result.isError, undefined);
  const text = result.content[0].text;
  assert.match(text, /Composio actions for app "gmail" \(1\)/);

  const composioCall = router.calls.find((c) =>
    c.url.includes("backend.composio.dev"),
  );
  assert.ok(composioCall);
  assert.match(composioCall!.url, /toolkit_slug=gmail/);
});

test("composio_list_tools (app='all'): treated like no filter", async () => {
  const router = installFetchRouter(() =>
    jsonResponse({ items: [] }),
  );
  const { callTool } = await import("@/lib/mcp/registry");
  await callTool(
    "composio_list_tools",
    { app: "all" },
    { organizationId: "org-list-all", userId: null },
  );
  const composioCall = router.calls.find((c) =>
    c.url.includes("backend.composio.dev"),
  );
  assert.ok(composioCall);
  assert.doesNotMatch(composioCall!.url, /toolkit_slug=/);
});

test("composio_list_tools: missing COMPOSIO_API_KEY surfaces textError (no throw)", async () => {
  const snap = snapshotEnv();
  try {
    delete process.env.COMPOSIO_API_KEY;
    installFetchRouter(() => {
      throw new Error("must not hit Composio when API key missing");
    });
    const { callTool } = await import("@/lib/mcp/registry");
    const result = await callTool(
      "composio_list_tools",
      {},
      { organizationId: "org-list-nokey", userId: null },
    );
    // textError shape: isError=true, single text block.
    assert.equal(result.isError, true);
    assert.match(
      result.content[0].text,
      /Composio API key missing|COMPOSIO_API_KEY missing/,
    );
  } finally {
    restoreEnv(snap);
  }
});

test("composio_list_tools: empty catalog returns helpful text (no isError)", async () => {
  installFetchRouter(() => jsonResponse({ items: [] }));
  const { callTool } = await import("@/lib/mcp/registry");
  const result = await callTool(
    "composio_list_tools",
    { app: "hubspot" },
    { organizationId: "org-list-empty", userId: null },
  );
  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /No Composio actions found for app "hubspot"/);
});

test("composio_list_tools: tolerates older `actions` shape alongside `items`", async () => {
  installFetchRouter(() =>
    jsonResponse({
      actions: [
        { name: "LEGACY_ACTION", appName: "legacy" },
      ],
    }),
  );
  const { callTool } = await import("@/lib/mcp/registry");
  const result = await callTool(
    "composio_list_tools",
    {},
    { organizationId: "org-list-legacy", userId: null },
  );
  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /LEGACY_ACTION/);
});

test("composio_list_tools: non-2xx upstream surfaces clean textError", async () => {
  installFetchRouter(() => new Response("forbidden", { status: 403 }));
  const { callTool } = await import("@/lib/mcp/registry");
  const result = await callTool(
    "composio_list_tools",
    {},
    { organizationId: "org-list-403", userId: null },
  );
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /composio_list_tools 403/);
  assert.match(result.content[0].text, /forbidden/);
});

test("composio_list_tools: 5-min cache returns cached actions on second call (no second fetch)", async () => {
  // Silence the [composio_list_tools] cache-hit console.info.
  const origInfo = console.info;
  console.info = () => {};
  try {
    let fetchCount = 0;
    installFetchRouter((req) => {
      if (req.url.includes("backend.composio.dev")) {
        fetchCount += 1;
        return jsonResponse({
          items: [{ enum: "CACHED_ACTION", appName: "x" }],
        });
      }
      return jsonResponse(null);
    });
    const { callTool } = await import("@/lib/mcp/registry");
    const orgId = "org-cache-hit";
    const r1 = await callTool(
      "composio_list_tools",
      {},
      { organizationId: orgId, userId: null },
    );
    const r2 = await callTool(
      "composio_list_tools",
      {},
      { organizationId: orgId, userId: null },
    );
    assert.equal(r1.isError, undefined);
    assert.equal(r2.isError, undefined);
    assert.match(r1.content[0].text, /CACHED_ACTION/);
    assert.match(r2.content[0].text, /CACHED_ACTION/);
    assert.equal(fetchCount, 1, "second call must be served from cache");
  } finally {
    console.info = origInfo;
  }
});

test("composio_use_tool: routes through composioAction with ctx.userId thread", async () => {
  const composioCalls: CapturedRequest[] = [];
  installFetchRouter((req) => {
    if (req.url.includes("backend.composio.dev/api/v3/tools/execute/")) {
      composioCalls.push(req);
      return jsonResponse({ ok: true, message_id: "m_42" });
    }
    if (req.url.includes("/rest/v1/rgaios_connections")) {
      return jsonResponse([
        fakeRow({
          id: "row-route",
          nangoConnectionId: "nango-route-1",
          userId: "user-route",
        }),
      ]);
    }
    return jsonResponse(null);
  });

  const { callTool } = await import("@/lib/mcp/registry");
  const result = await callTool(
    "composio_use_tool",
    {
      app: "gmail",
      action: "GMAIL_SEND_EMAIL",
      input: { to: "x@y.z", subject: "hi", body: "yo" },
    },
    { organizationId: "org-1", userId: "user-route" },
  );
  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /GMAIL_SEND_EMAIL/);
  assert.match(result.content[0].text, /m_42/);

  assert.equal(composioCalls.length, 1);
  assert.match(
    composioCalls[0].url,
    /\/tools\/execute\/GMAIL_SEND_EMAIL$/,
    "v3 URL contains action enum",
  );
  const body = JSON.parse(composioCalls[0].body ?? "{}");
  assert.equal(
    body.user_id,
    "user-route",
    "ctx.userId threaded through to Composio user_id (v3)",
  );
  assert.equal(body.connected_account_id, "nango-route-1");
  // Input passes through verbatim (not transformed) under v3 `arguments`.
  assert.deepEqual(body.arguments, { to: "x@y.z", subject: "hi", body: "yo" });
});

test("composio_use_tool: missing COMPOSIO_API_KEY surfaces textError, doesn't throw", async () => {
  const snap = snapshotEnv();
  try {
    delete process.env.COMPOSIO_API_KEY;
    installFetchRouter((req) => {
      if (req.url.includes("/rest/v1/rgaios_organizations")) {
        // P0-5 S3 unifies the gate read via shouldGateTool(); it runs
        // BEFORE the connection lookup now. Approvals off so execution
        // falls through to the original code path under test.
        return jsonResponse({ approvals_gate_all: false });
      }
      if (req.url.includes("/rest/v1/rgaios_connections")) {
        // Pool listing happens BEFORE the env check inside composioCall;
        // either order is fine - we just need the handler to terminate
        // cleanly with an error result, not throw.
        return jsonResponse([
          fakeRow({
            id: "row-no-key",
            nangoConnectionId: "n",
            userId: "user-x",
          }),
        ]);
      }
      throw new Error("must not hit Composio when API key missing");
    });
    const { callTool } = await import("@/lib/mcp/registry");
    const result = await callTool(
      "composio_use_tool",
      { app: "gmail", action: "GMAIL_SEND_EMAIL", input: {} },
      { organizationId: "org-1", userId: "user-x" },
    );
    assert.equal(result.isError, true);
    assert.match(
      result.content[0].text,
      /Composio API key missing|COMPOSIO_API_KEY missing/,
    );
  } finally {
    restoreEnv(snap);
  }
});

test("composio_use_tool: missing app surfaces 'app is required'", async () => {
  installFetchRouter(() => jsonResponse(null));
  const { callTool } = await import("@/lib/mcp/registry");
  const result = await callTool(
    "composio_use_tool",
    { app: "  ", action: "X", input: {} },
    { organizationId: "org-1", userId: null },
  );
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /app is required/);
});

test("composio_use_tool: missing action surfaces 'action is required'", async () => {
  installFetchRouter(() => jsonResponse(null));
  const { callTool } = await import("@/lib/mcp/registry");
  const result = await callTool(
    "composio_use_tool",
    { app: "gmail", action: "", input: {} },
    { organizationId: "org-1", userId: null },
  );
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /action is required/);
});

test("composio_use_tool: non-object input surfaces clean error (no crash)", async () => {
  installFetchRouter(() => jsonResponse(null));
  const { callTool } = await import("@/lib/mcp/registry");
  for (const bad of [null, "string-input", 42, ["array"]]) {
    const result = await callTool(
      "composio_use_tool",
      { app: "gmail", action: "X", input: bad as unknown },
      { organizationId: "org-1", userId: null },
    );
    assert.equal(result.isError, true, `input=${JSON.stringify(bad)}`);
    assert.match(result.content[0].text, /input must be an object/);
  }
});

test("composio_use_tool: invalid app slug (no rows) surfaces 'isn't connected'", async () => {
  installFetchRouter((req) => {
    if (req.url.includes("/rest/v1/rgaios_connections")) {
      return jsonResponse([]); // no rows for this slug
    }
    return jsonResponse(null);
  });
  const { callTool } = await import("@/lib/mcp/registry");
  const result = await callTool(
    "composio_use_tool",
    { app: "notarealapp", action: "X", input: {} },
    { organizationId: "org-1", userId: "user-x" },
  );
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /notarealapp/);
  assert.match(result.content[0].text, /isn't connected/);
});

test("composio_use_tool: destructive action denylist refuses verbs at _/- boundaries", async () => {
  // Defense-in-depth gate added post-PR4 (commit 429389d). Until an
  // approval-prompt UI ships, the router refuses destructive verbs by
  // regex match before the call ever leaves Node. Verbs:
  // DELETE, DROP, DESTROY, PURGE, REMOVE, WIPE, TRUNCATE.
  //
  // The patterns originally used `\b` boundaries which silently failed
  // on real Composio action enums: `_` is a word character in JS regex,
  // so `\bDELETE\b` does NOT match `GMAIL_DELETE_MESSAGE`. Fixed by
  // anchoring on `(?:^|[_\-])VERB(?:[_\-]|$)` so the denylist actually
  // catches the SCREAMING_SNAKE_CASE enums Composio publishes. This
  // test pins the fix.
  installFetchRouter(() => {
    throw new Error("destructive action must short-circuit before any HTTP");
  });
  const { callTool } = await import("@/lib/mcp/registry");
  // Real-world Composio action enums that the original \b-pattern
  // BYPASSED. These MUST now be denied.
  const mustBeDenied = [
    "DELETE",
    "DROP-LIST",
    "GMAIL_DELETE_MESSAGE",
    "HUBSPOT_DROP_LIST",
    "GITHUB_REMOVE_REPO",
    "DB_TRUNCATE_TABLE",
    "NOTION_DELETE_PAGE",
    "SLACK_REMOVE_USER",
    "LINKEDIN_DELETE_POST",
    "DESTROY_RECORD",
    "PURGE_CACHE",
    "WIPE_DATA",
  ];
  for (const action of mustBeDenied) {
    const result = await callTool(
      "composio_use_tool",
      { app: "x", action, input: {} },
      { organizationId: "org-deny", userId: "user-deny" },
    );
    assert.equal(result.isError, true, `${action} must be denied`);
    assert.match(
      result.content[0].text,
      /denylist/,
      `${action} should hit the denylist text path`,
    );
  }
});

test("composio_use_tool: denylist allows safe actions whose names share a substring", async () => {
  // Anchoring on (?:[_\-]|$) after the verb is what keeps the denylist
  // from false-positive on enums where the verb appears as a substring
  // of a longer word. Pin the safe names so a future regex tightening
  // doesn't quietly break legitimate flows.
  const safeActionsThatRouteToComposio = [
    "GITHUB_DELETED_REPO_LIST", // DELETED, not DELETE
    "GMAIL_SEND_EMAIL",
    "GMAIL_UPDATE_DRAFT",
    "EMAIL_DRAFT_SEND",
    "SLACK_SEND_MESSAGE",
    "HUBSPOT_LIST_CONTACTS",
  ];
  for (const action of safeActionsThatRouteToComposio) {
    let composioHit = false;
    installFetchRouter((req) => {
      if (req.url.includes("backend.composio.dev/api/v3/tools/execute/")) {
        composioHit = true;
        return jsonResponse({ ok: true });
      }
      if (req.url.includes("/rest/v1/rgaios_connections")) {
        return jsonResponse([
          fakeRow({
            id: `row-allow-${action}`,
            nangoConnectionId: `n-${action}`,
            userId: "user-allow",
          }),
        ]);
      }
      return jsonResponse(null);
    });
    const { callTool } = await import("@/lib/mcp/registry");
    const result = await callTool(
      "composio_use_tool",
      { app: "gmail", action, input: {} },
      { organizationId: "org-allow", userId: "user-allow" },
    );
    assert.equal(result.isError, undefined, `${action} must NOT be denied`);
    assert.ok(composioHit, `${action} should have routed through to Composio`);
    assert.doesNotMatch(
      result.content[0].text,
      /denylist/,
      `${action} must not hit the denylist text path`,
    );
  }
});

test("composio_use_tool: large response is truncated to 8000 chars + suffix", async () => {
  const huge = "x".repeat(9000);
  installFetchRouter((req) => {
    if (req.url.includes("backend.composio.dev")) {
      return jsonResponse({ blob: huge });
    }
    if (req.url.includes("/rest/v1/rgaios_connections")) {
      return jsonResponse([
        fakeRow({
          id: "row-trunc",
          nangoConnectionId: "n-trunc",
          userId: "user-t",
        }),
      ]);
    }
    return jsonResponse(null);
  });
  const { callTool } = await import("@/lib/mcp/registry");
  const result = await callTool(
    "composio_use_tool",
    { app: "gmail", action: "DUMP", input: {} },
    { organizationId: "org-1", userId: "user-t" },
  );
  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /\(truncated\)/);
});
