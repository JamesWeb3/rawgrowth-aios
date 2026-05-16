import test from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ALWAYS_GATE_TOOLS,
  shouldGateTool,
  type GateContext,
} from "@/lib/mcp/approval-gate";

// P0-5 S3: unify the three divergent gate copies behind shouldGateTool().
//
// The helper itself is pure-ish (touches supabase, which we stub via the
// module under test's behavior). For unit coverage we exercise:
//   1. The skipApprovalGate short-circuit (decideApproval re-dispatch).
//   2. The ALWAYS_GATE_TOOLS allow-list.
//   3. The isWrite=false branch (reads never gate).
//   4. The contract that approvals_gate_all callers fail CLOSED.
//   5. The integration: registry.ts and composio-router.ts both import
//      shouldGateTool() so behavior cannot drift.

test("ALWAYS_GATE_TOOLS keeps the irreversible supabase write set", () => {
  // High-blast tools that ignore org policy. Drop one of these by
  // mistake and arbitrary SQL starts running unattended.
  assert.ok(ALWAYS_GATE_TOOLS.has("supabase_run_sql"));
  assert.ok(ALWAYS_GATE_TOOLS.has("supabase_apply_migration"));
  assert.ok(ALWAYS_GATE_TOOLS.has("supabase_create_project"));
});

test("shouldGateTool short-circuits on ctx.skipApprovalGate", async () => {
  // decideApproval re-runs an approved row through the same dispatch.
  // The flag tells us 'a human already cleared this; do not re-queue'.
  const ctx: GateContext = { organizationId: "org-1", skipApprovalGate: true };
  const decision = await shouldGateTool(ctx, "supabase_run_sql", true);
  assert.equal(decision.gate, false);
  assert.equal(decision.source, "skip");
});

test("shouldGateTool gates ALWAYS_GATE_TOOLS even for read-only ctx", async () => {
  // The always-list ignores isWrite intentionally: even if someone
  // mismarks supabase_run_sql as a read, the gate must still fire.
  const ctx: GateContext = { organizationId: "org-1" };
  const decision = await shouldGateTool(ctx, "supabase_run_sql", false);
  assert.equal(decision.gate, true);
  assert.equal(decision.source, "always-gate");
  assert.match(decision.reason, /high-blast/);
});

test("shouldGateTool lets non-write tools pass without policy read", async () => {
  // A read-only tool that is not in ALWAYS_GATE_TOOLS must never hit
  // the policy table. That keeps every read fast and survives a
  // policy-table outage cleanly.
  const ctx: GateContext = { organizationId: "org-1" };
  const decision = await shouldGateTool(ctx, "company_query", false);
  assert.equal(decision.gate, false);
  assert.equal(decision.source, "ungated");
});

test("approval-gate helper has the documented decision surface", () => {
  // Pin the public shape so registry.ts + composio-router.ts can rely
  // on it. Adding a field is fine; renaming a field needs the callers
  // updated.
  const src = readFileSync(
    resolve(__dirname, "../../src/lib/mcp/approval-gate.ts"),
    "utf8",
  );
  assert.match(src, /export const ALWAYS_GATE_TOOLS = new Set<string>/);
  assert.match(src, /export async function shouldGateTool\(/);
  assert.match(src, /export type GateDecision = {[\s\S]*?gate: boolean;[\s\S]*?source:/);
  // Fail-closed contract: any throw / error in the policy read returns
  // gate=true. Drop this and the security parity argument falls apart.
  assert.match(src, /failed: true/);
});

test("registry.ts + composio-router.ts both import shouldGateTool from the shared helper", () => {
  // Audit so a future inline copy of the gate logic gets caught by the
  // unit suite before it ships.
  const registry = readFileSync(
    resolve(__dirname, "../../src/lib/mcp/registry.ts"),
    "utf8",
  );
  const composio = readFileSync(
    resolve(__dirname, "../../src/lib/mcp/tools/composio-router.ts"),
    "utf8",
  );
  // Match either a sole-import or a multi-name import line that
  // includes shouldGateTool - registry.ts now also imports
  // ALWAYS_GATE_TOOLS for its hot-path pre-filter.
  assert.match(
    registry,
    /import { [^}]*\bshouldGateTool\b[^}]* } from "\.\/approval-gate"/,
  );
  assert.match(
    composio,
    /import { [^}]*\bshouldGateTool\b[^}]* } from "\.\.\/approval-gate"/,
  );
  // Neither file may re-implement orgGatesAllWrites locally.
  assert.ok(
    !/async function orgGatesAllWrites/.test(registry),
    "registry.ts must not redefine orgGatesAllWrites",
  );
  // Inline DB read of approvals_gate_all is the thing that drifted.
  // The literal string can still appear in comments + log messages -
  // what must NOT come back is a direct supabaseAdmin().from(...).
  // select("approvals_gate_all") call outside the shared helper.
  assert.ok(
    !/\.select\(\s*"approvals_gate_all"\s*\)/.test(composio),
    "composio-router.ts must not directly select approvals_gate_all anymore",
  );
  assert.ok(
    !/\.select\(\s*"approvals_gate_all"\s*\)/.test(registry),
    "registry.ts must not directly select approvals_gate_all anymore",
  );
});
