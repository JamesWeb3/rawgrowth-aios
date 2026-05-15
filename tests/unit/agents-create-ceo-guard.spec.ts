import { test } from "node:test";
import assert from "node:assert/strict";

// Set Supabase env vars eagerly. agents.ts pulls supabaseAdmin (only
// used by agents_update / agents_fire), but the proxy reads env at
// import time, so we satisfy it here. The CEO guard we are testing
// returns BEFORE any DB / supabase call so no client mocking is needed.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-key";

/**
 * Unit test for GAP #19 - agents_create role:"ceo" privilege guard.
 *
 * agents_update already rejects role:"ceo" promotions from MCP
 * (src/lib/mcp/tools/agents.ts:308-312). agents_create had the same
 * gap: any MCP caller could spawn a brand-new agent with role:"ceo",
 * which grants the orchestrator surface + JSON COMMANDS authority.
 *
 * The guard fires before createAgent() is called, so we don't need
 * to mock Supabase - if the guard regresses, this test will surface
 * a different failure mode (e.g. an unmocked DB write attempt) and
 * we'd notice. We only assert the textError shape here.
 *
 * tsx loader treats the alias-resolved `@/lib/mcp/registry` and the
 * relative `../registry` import inside agents.ts as distinct module
 * specifiers UNLESS we import the alias version first. Mirroring the
 * composio-router.spec.ts ordering hack.
 */
const REGISTRY_FIRST = import("@/lib/mcp/registry").then(() =>
  import("@/lib/mcp/tools/agents"),
);

async function ensureAgentsLoaded(): Promise<void> {
  await REGISTRY_FIRST;
}

test("agents_create with role:ceo + non-admin caller is rejected", async () => {
  await ensureAgentsLoaded();
  const { callTool } = await import("@/lib/mcp/registry");

  // skipApprovalGate bypasses the central isWrite approvals queue
  // (registry.ts:152-189). We are testing the handler-local CEO guard,
  // not the approvals gate - those are layered defenses, both desired.
  // Without skipApprovalGate the test would queue an approval row
  // (fetch failed in unit env) and never reach the handler at all.
  const result = await callTool(
    "agents_create",
    { name: "Mallory", role: "ceo" },
    {
      organizationId: "00000000-0000-0000-0000-000000000001",
      skipApprovalGate: true,
    },
  );

  assert.equal(result.isError, true, "expected isError:true on CEO rejection");
  const body = result.content.map((c) => c.text).join("\n");
  assert.match(
    body,
    /role:"ceo" is an operator action/i,
    `expected operator-action rejection message, got: ${body}`,
  );
  // Make sure the error isn't from the generic VALID_ROLES check - the
  // CEO guard must fire AFTER role validation succeeds (ceo IS a
  // valid role) but BEFORE createAgent runs.
  assert.doesNotMatch(
    body,
    /role must be one of/i,
    "guard should not collide with the VALID_ROLES error",
  );
});
