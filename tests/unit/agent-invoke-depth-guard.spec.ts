import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

/**
 * Unit test for GAP #18 - agent_invoke MAX_DELEGATION_DEPTH guard.
 *
 * Pre-fix: src/lib/mcp/tools/agent-invoke.ts looked up the incoming
 * delegation chain using `ctx.userId` as the assignee. But the join
 * inside loadIncomingChain filters
 * `rgaios_routines.assignee_agent_id`, which is always an AGENT id -
 * the user-id lookup matched zero rows EVERY time, so the cap (3
 * hops) never fired and a runaway delegation chain could recurse
 * without limit.
 *
 * Post-fix the lookup is keyed off `ctx.agentId`, which IS populated
 * by every in-process call path that constitutes an agent->agent
 * chain (executor / execToolCall / decideApproval).
 *
 * This test boots the registered MCP tool, intercepts globalThis.fetch
 * (the Supabase REST client) so we can return a controlled
 * delegation_chain on the runs lookup, calls the tool through the
 * registry's callTool, and asserts the depth-cap message is returned
 * when the keyed-on agent ALREADY has a depth-3 chain. The companion
 * assertion (keyed-on user id produces an empty chain so the cap
 * never fires) is implicit in the same fetch router: only requests
 * keyed on `assignee_agent_id=eq.<agentId>` match the deep-chain
 * payload.
 */

// Set Supabase env vars eagerly so supabaseAdmin() / module-level
// reads see valid values when the registry + tool load.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-key";

/**
 * Mirror the composio-router.spec.ts loader ordering hack: the alias
 * resolver and the relative `../registry` import inside the tool
 * resolve to distinct module instances UNLESS the alias side is
 * pulled first. With this order the registerTool() call in
 * agent-invoke.ts mutates the same `tools` Map that callTool() reads.
 */
const REGISTRY_FIRST = import("@/lib/mcp/registry").then(() =>
  import("@/lib/mcp/tools/agent-invoke"),
);

async function ensureToolLoaded(): Promise<void> {
  await REGISTRY_FIRST;
}

type FetchLike = typeof fetch;
const realFetch: FetchLike = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetchRouter(
  router: (url: string, init?: RequestInit) => Response | Promise<Response>,
): { urls: string[] } {
  const urls: string[] = [];
  (globalThis as { fetch: FetchLike }).fetch = (async (
    input: unknown,
    init?: RequestInit,
  ) => {
    const url =
      typeof input === "string"
        ? input
        : (input as { url: string }).url ?? String(input);
    urls.push(url);
    return router(url, init);
  }) as unknown as FetchLike;
  return { urls };
}

afterEach(() => {
  (globalThis as { fetch: FetchLike }).fetch = realFetch;
});

test("agent_invoke: depth cap fires when ctx.agentId already has a depth-3 chain", async () => {
  await ensureToolLoaded();
  const { callTool } = await import("@/lib/mcp/registry");

  const ORG_ID = "00000000-0000-0000-0000-000000000001";
  const CALLER_AGENT_ID = "11111111-1111-1111-1111-111111111111";
  const TARGET_AGENT_ID = "22222222-2222-2222-2222-222222222222";
  // A depth-3 chain already exists for the caller. Adding one more
  // hop (depth+1 = 4) must exceed MAX_DELEGATION_DEPTH=3 and trip
  // the cap with the expected message.
  const DEEP_CHAIN = [
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    "cccccccc-cccc-cccc-cccc-cccccccccccc",
  ];

  installFetchRouter((url) => {
    // Target-agent lookup: rgaios_agents?id=eq.<TARGET>...
    if (
      url.includes("/rest/v1/rgaios_agents") &&
      url.includes(`id=eq.${TARGET_AGENT_ID}`)
    ) {
      return jsonResponse([
        {
          id: TARGET_AGENT_ID,
          name: "Target",
          title: "Target agent",
        },
      ]);
    }
    // Incoming-chain lookup: rgaios_routine_runs joined to routines on
    // assignee_agent_id. Post-fix the URL filters on
    // `rgaios_routines.assignee_agent_id=eq.<CALLER_AGENT_ID>` -
    // matching that exactly is what verifies the agentId keying is
    // live (a userId-keyed lookup would never hit this branch).
    if (
      url.includes("/rest/v1/rgaios_routine_runs") &&
      url.includes(`assignee_agent_id=eq.${CALLER_AGENT_ID}`)
    ) {
      return jsonResponse([
        {
          input_payload: {
            delegation_chain: DEEP_CHAIN,
            delegation_depth: DEEP_CHAIN.length,
          },
          created_at: new Date().toISOString(),
          rgaios_routines: { assignee_agent_id: CALLER_AGENT_ID },
        },
      ]);
    }
    // Any other call (audit log inserts, etc.) - safe empty default.
    return jsonResponse([], 200);
  });

  const result = await callTool(
    "agent_invoke",
    { agent_id: TARGET_AGENT_ID, prompt: "do the thing" },
    {
      organizationId: ORG_ID,
      agentId: CALLER_AGENT_ID,
      // agent_invoke is isWrite:true - bypass the central approvals
      // gate so the test exercises the handler-local depth guard.
      skipApprovalGate: true,
    },
  );

  assert.equal(result.isError, true, "expected isError:true on depth-cap");
  const body = result.content.map((c) => c.text).join("\n");
  assert.match(
    body,
    /delegation depth limit \(3\) reached/i,
    `expected depth-cap message, got: ${body}`,
  );
});

test("agent_invoke: depth cap does NOT fire for an unknown caller (empty chain path)", async () => {
  await ensureToolLoaded();
  const { callTool } = await import("@/lib/mcp/registry");

  const ORG_ID = "00000000-0000-0000-0000-000000000002";
  const TARGET_AGENT_ID = "33333333-3333-3333-3333-333333333333";

  // No matching routine_runs row for this caller agent id - the
  // helper returns { chain: [], depth: 0 } and the depth guard must
  // NOT fire. The call should pass the guard and fail later, on a
  // distinct downstream branch (routine insert / dispatch). We assert
  // on the message NOT being the depth-cap.
  installFetchRouter((url) => {
    if (
      url.includes("/rest/v1/rgaios_agents") &&
      url.includes(`id=eq.${TARGET_AGENT_ID}`)
    ) {
      return jsonResponse([
        { id: TARGET_AGENT_ID, name: "Target", title: "Target agent" },
      ]);
    }
    // routine_runs / routines / audit_log all return empty.
    return jsonResponse([], 200);
  });

  const result = await callTool(
    "agent_invoke",
    { agent_id: TARGET_AGENT_ID, prompt: "do the thing" },
    {
      organizationId: ORG_ID,
      agentId: "99999999-9999-9999-9999-999999999999",
      skipApprovalGate: true,
    },
  );

  const body = result.content.map((c) => c.text).join("\n");
  // Whatever the downstream outcome, it must NOT be the depth-cap
  // message (that would mean an empty-chain caller is being refused,
  // which is a regression of the post-fix semantics).
  assert.doesNotMatch(
    body,
    /delegation depth limit/i,
    `depth cap should not fire for empty-chain caller, got: ${body}`,
  );
});
