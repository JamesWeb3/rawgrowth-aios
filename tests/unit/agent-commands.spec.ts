import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// Set env vars eagerly so module-level reads see valid values when
// agent-commands + its proxy deps load.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-key";
process.env.COMPOSIO_API_KEY ??= "test-composio-key";

/**
 * Unit tests for src/lib/agent/agent-commands.ts (PR B - Atlas chat
 * JSON commands). Mirrors the boundary-mocking pattern used by
 * tests/unit/composio-pool.spec.ts and tests/unit/composio-router.spec.ts:
 *
 *   - globalThis.fetch intercepts every outbound HTTP call. The router
 *     dispatches per-URL so a single test can answer:
 *       * Supabase REST (rgaios_agents lookup, rgaios_routines insert,
 *         rgaios_routine_runs insert, audit log insert)
 *       * Composio v3 tools/execute call (only when the test exercises
 *         a tool_call command)
 *   - We never mock extractAndExecuteCommands itself - the SUT is the
 *     parsing + dispatch logic + speaker authority gate.
 */

type FetchLike = typeof fetch;
const realFetch: FetchLike = globalThis.fetch;

type CapturedRequest = {
  url: string;
  method: string;
  body: string | null;
};

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

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  process.env.COMPOSIO_API_KEY = "test-composio-key";
});

afterEach(() => {
  restoreFetch();
});

test("extractAndExecuteCommands: no <command> blocks → no-op, reply unchanged", async () => {
  installFetchRouter(() => jsonResponse(null));
  const { extractAndExecuteCommands } = await import(
    "@/lib/agent/agent-commands"
  );
  const out = await extractAndExecuteCommands({
    orgId: "org-1",
    speakerAgentId: "agent-1",
    reply: "Just a friendly chat reply with no commands.",
  });
  assert.equal(out.results.length, 0);
  assert.equal(
    out.visibleReply,
    "Just a friendly chat reply with no commands.",
  );
});

test("extractAndExecuteCommands: sub-agent (not Atlas, not head) is rejected, blocks stripped", async () => {
  installFetchRouter((req) => {
    if (req.url.includes("/rest/v1/rgaios_agents")) {
      // speaker lookup returns a sub-agent
      return jsonResponse({
        id: "agent-sub",
        role: "marketer",
        is_department_head: false,
        name: "Junior Marketer",
      });
    }
    if (req.url.includes("/rest/v1/rgaios_audit_log")) {
      return jsonResponse([]);
    }
    return jsonResponse(null);
  });
  const { extractAndExecuteCommands } = await import(
    "@/lib/agent/agent-commands"
  );
  const reply = `Sure, on it.

<command type="agent_invoke">
{ "agent": "Sales Manager", "task": "do the thing" }
</command>`;
  const out = await extractAndExecuteCommands({
    orgId: "org-1",
    speakerAgentId: "agent-sub",
    reply,
  });
  assert.equal(out.visibleReply, "Sure, on it.");
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].ok, false);
  assert.match(out.results[0].summary, /not Atlas or a department head/);
});

test("extractAndExecuteCommands: Atlas tool_call invokes Composio v3 execute", async () => {
  let composioHit = false;
  let composioBody: Record<string, unknown> | null = null;
  installFetchRouter((req) => {
    if (req.url.includes("backend.composio.dev/api/v3/tools/execute/")) {
      composioHit = true;
      composioBody = req.body ? JSON.parse(req.body) : null;
      return jsonResponse({ ok: true, message_id: "slack_42" });
    }
    if (req.url.includes("/rest/v1/rgaios_agents")) {
      // speaker lookup → Atlas
      return jsonResponse({
        id: "atlas-1",
        role: "ceo",
        is_department_head: true,
        name: "Atlas",
      });
    }
    if (req.url.includes("/rest/v1/rgaios_connections")) {
      // Composio per-org key lookup (resolveComposioApiKey) returns
      // empty so we fall back to the env-set test key.
      // pool list for execution returns a connected row.
      return jsonResponse([
        {
          id: "conn-slack",
          organization_id: "org-1",
          provider_config_key: "composio:slack",
          nango_connection_id: "nango-slack-1",
          display_name: "Slack",
          status: "connected",
          metadata: {},
          agent_id: null,
          user_id: "user-atlas",
          connected_at: new Date(0).toISOString(),
        },
      ]);
    }
    if (req.url.includes("/rest/v1/rgaios_audit_log")) {
      return jsonResponse([]);
    }
    return jsonResponse(null);
  });
  const { extractAndExecuteCommands } = await import(
    "@/lib/agent/agent-commands"
  );
  const reply = `Posting to Slack now.

<command type="tool_call">
{ "tool": "composio_use_tool",
  "args": { "app": "slack", "action": "SLACK_SEND_MESSAGE",
            "input": { "channel": "#general", "text": "hi team" } } }
</command>`;
  const out = await extractAndExecuteCommands({
    orgId: "org-1",
    speakerAgentId: "atlas-1",
    reply,
    callerUserId: "user-atlas",
  });
  assert.equal(out.visibleReply, "Posting to Slack now.");
  assert.equal(out.results.length, 1, "one command result");
  assert.equal(out.results[0].ok, true, `got: ${out.results[0].summary}`);
  assert.equal(out.results[0].type, "tool_call");
  assert.ok(composioHit, "Composio v3 endpoint must have been called");
  // `composioBody` is only assigned inside the fetch-router callback, so
  // TS control-flow narrows it away here. Re-bind through an explicit type.
  const body = composioBody as {
    user_id?: string;
    connected_account_id?: string;
    arguments?: unknown;
  } | null;
  assert.equal(body?.user_id, "user-atlas");
  assert.equal(body?.connected_account_id, "nango-slack-1");
  assert.deepEqual(body?.arguments, {
    channel: "#general",
    text: "hi team",
  });
});

test("extractAndExecuteCommands: tool_call rejects destructive actions on the chat surface too", async () => {
  installFetchRouter((req) => {
    if (req.url.includes("/rest/v1/rgaios_agents")) {
      return jsonResponse({
        id: "atlas-1",
        role: "ceo",
        is_department_head: true,
        name: "Atlas",
      });
    }
    if (req.url.includes("/rest/v1/rgaios_audit_log")) {
      return jsonResponse([]);
    }
    if (req.url.includes("backend.composio.dev")) {
      throw new Error("destructive action must NEVER reach Composio");
    }
    return jsonResponse(null);
  });
  const { extractAndExecuteCommands } = await import(
    "@/lib/agent/agent-commands"
  );
  const reply = `Wiping the lead list.

<command type="tool_call">
{ "tool": "composio_use_tool",
  "args": { "app": "hubspot", "action": "HUBSPOT_DELETE_CONTACT",
            "input": { "id": "123" } } }
</command>`;
  const out = await extractAndExecuteCommands({
    orgId: "org-1",
    speakerAgentId: "atlas-1",
    reply,
    callerUserId: "user-atlas",
  });
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].ok, false);
  assert.match(out.results[0].summary, /denylist|destructive/);
});

test("extractAndExecuteCommands: malformed JSON in command body surfaces a clear error", async () => {
  installFetchRouter((req) => {
    if (req.url.includes("/rest/v1/rgaios_agents")) {
      return jsonResponse({
        id: "atlas-1",
        role: "ceo",
        is_department_head: true,
        name: "Atlas",
      });
    }
    if (req.url.includes("/rest/v1/rgaios_audit_log")) {
      return jsonResponse([]);
    }
    return jsonResponse(null);
  });
  const { extractAndExecuteCommands } = await import(
    "@/lib/agent/agent-commands"
  );
  const reply = `Doing it.

<command type="tool_call">
{ this is not json at all }
</command>`;
  const out = await extractAndExecuteCommands({
    orgId: "org-1",
    speakerAgentId: "atlas-1",
    reply,
    callerUserId: "user-atlas",
  });
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].ok, false);
  assert.match(out.results[0].summary, /not valid JSON/);
});

test("extractAndExecuteCommands: unknown command type produces explicit rejection", async () => {
  installFetchRouter((req) => {
    if (req.url.includes("/rest/v1/rgaios_agents")) {
      return jsonResponse({
        id: "atlas-1",
        role: "ceo",
        is_department_head: true,
        name: "Atlas",
      });
    }
    if (req.url.includes("/rest/v1/rgaios_audit_log")) {
      return jsonResponse([]);
    }
    return jsonResponse(null);
  });
  const { extractAndExecuteCommands } = await import(
    "@/lib/agent/agent-commands"
  );
  const reply = `Working on it.

<command type="self_destruct">
{ "fuse": 5 }
</command>`;
  const out = await extractAndExecuteCommands({
    orgId: "org-1",
    speakerAgentId: "atlas-1",
    reply,
    callerUserId: "user-atlas",
  });
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].ok, false);
  assert.match(out.results[0].summary, /unknown command type/);
});

test("extractBareJsonCommands: classifies bare {tool, args} for MCP-direct tool names (Kasia screenshot leak repro)", async () => {
  const { extractBareJsonCommands } = await import("@/lib/agent/agent-commands");
  const reply =
    'Odpalam scraper na pillar AI creators.\n\n' +
    '{ "tool": "apify_run_actor", "args": { "actor_id": "apify/instagram-reel-scraper", "run_input": { "username": ["advicewithjean","aiwithremy"], "resultsLimit": 15 } } } ' +
    '{ "tool": "apify_run_actor", "args": { "actor_id": "apify/instagram-reel-scraper", "run_input": { "username": ["natalie.marie.ai","thedankoe"], "resultsLimit": 15 } } }\n\n' +
    'Po powrocie filtruję timestamp >= now-7d.';
  const blocks = extractBareJsonCommands(reply);
  assert.equal(blocks.length, 2, "both apify_run_actor blocks must be detected");
  assert.equal(blocks[0].type, "tool_call");
  assert.equal(blocks[1].type, "tool_call");
  // The body must still be valid JSON the dispatcher can parse.
  const parsed = JSON.parse(blocks[0].body) as { tool: string; args: unknown };
  assert.equal(parsed.tool, "apify_run_actor");
});

test("extractBareJsonCommands: still recognises bare composio_use_tool shape (no regression)", async () => {
  const { extractBareJsonCommands } = await import("@/lib/agent/agent-commands");
  const reply =
    'Sending the message:\n{ "tool": "composio_use_tool", "args": { "app": "slack", "action": "SLACK_SEND_MESSAGE", "input": { "channel": "#a", "text": "hi" } } }\nDone.';
  const blocks = extractBareJsonCommands(reply);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "tool_call");
});

test("extractBareJsonCommands: agent_invoke shape still classified", async () => {
  const { extractBareJsonCommands } = await import("@/lib/agent/agent-commands");
  const reply = 'Dispatching:\n{ "agent": "Kasia", "task": "draft 3 hooks" }\nWait.';
  const blocks = extractBareJsonCommands(reply);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "agent_invoke");
});

test("extractBareJsonCommands: rejects non-command JSON (raw result payloads must NOT classify)", async () => {
  const { extractBareJsonCommands } = await import("@/lib/agent/agent-commands");
  // Pure data payload - no tool/agent/title+description+assignee keys.
  const reply = 'Top post stats: {"likes": 320, "comments": 2125, "url": "https://example.com/p/X"}';
  const blocks = extractBareJsonCommands(reply);
  assert.equal(blocks.length, 0, "result JSON must NOT be misclassified as a command");
});

test("extractBareJsonCommands: rejects {tool} without args (incomplete shape)", async () => {
  const { extractBareJsonCommands } = await import("@/lib/agent/agent-commands");
  const reply = '{ "tool": "apify_run_actor" }';
  const blocks = extractBareJsonCommands(reply);
  assert.equal(blocks.length, 0, "incomplete tool shape (no args) must NOT classify");
});

// GAP #20 - composio action names are sometimes CamelCase. The old
// denylist regex required `_` / `-` / start / end boundaries, so the
// CamelCase form `DeleteIssue` slipped past the destructive check and
// would have hit Composio. The fixed regex adds CamelCase boundaries
// (lowercase-letter lookbehind + uppercase-letter lookahead) so the
// CamelCase form is refused at the chat-command surface.
test("extractAndExecuteCommands: tool_call rejects CamelCase destructive action `DeleteIssue` (GAP #20)", async () => {
  installFetchRouter((req) => {
    if (req.url.includes("/rest/v1/rgaios_agents")) {
      return jsonResponse({
        id: "atlas-1",
        role: "ceo",
        is_department_head: true,
        name: "Atlas",
      });
    }
    if (req.url.includes("/rest/v1/rgaios_audit_log")) {
      return jsonResponse([]);
    }
    if (req.url.includes("backend.composio.dev")) {
      throw new Error(
        "CamelCase destructive action must NEVER reach Composio - the denylist must catch DeleteIssue",
      );
    }
    return jsonResponse(null);
  });
  const { extractAndExecuteCommands } = await import(
    "@/lib/agent/agent-commands"
  );
  const reply = `Closing the bug.

<command type="tool_call">
{ "tool": "composio_use_tool",
  "args": { "app": "linear", "action": "DeleteIssue",
            "input": { "id": "LIN-42" } } }
</command>`;
  const out = await extractAndExecuteCommands({
    orgId: "org-1",
    speakerAgentId: "atlas-1",
    reply,
    callerUserId: "user-atlas",
  });
  assert.equal(out.results.length, 1);
  assert.equal(
    out.results[0].ok,
    false,
    "CamelCase DeleteIssue must be refused by the destructive denylist",
  );
  assert.match(out.results[0].summary, /denylist|destructive/);
});
