import test from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// P0-3 M3: archiveSharedMemory used to be a dead export - no callers,
// supersedes_id schema-only. This pins the new wiring so it cannot
// silently revert: supersedeSharedMemory exists, the two MCP tools
// register at module load, and the chain mark_old_archived -> insert_new
// -> link_supersedes_id is wired.
//
// The helpers themselves hit Supabase; behavior is exercised in cloud
// smoke. These specs guard the structure.

const SHARED_SRC = readFileSync(
  resolve(__dirname, "../../src/lib/memory/shared.ts"),
  "utf8",
);
const TOOL_SRC = readFileSync(
  resolve(__dirname, "../../src/lib/mcp/tools/shared-memory.ts"),
  "utf8",
);
const TOOL_INDEX_SRC = readFileSync(
  resolve(__dirname, "../../src/lib/mcp/tools/index.ts"),
  "utf8",
);

test("supersedeSharedMemory is exported from src/lib/memory/shared.ts", () => {
  assert.match(
    SHARED_SRC,
    /export async function supersedeSharedMemory\(/,
    "supersedeSharedMemory helper must be exported for callers to wire",
  );
});

test("supersedeSharedMemory enforces org boundary before archiving", () => {
  // Guard against a cross-tenant exploit: a buggy delegate could pass
  // any UUID and otherwise we would happily archive a different org's
  // memory. The .eq("organization_id", input.orgId) on the lookup is
  // load-bearing.
  assert.match(
    SHARED_SRC,
    /\.eq\(\s*"id",\s*input\.oldRowId\s*\)\s*\n?\s*\.eq\(\s*"organization_id",\s*input\.orgId\s*\)/,
    "old-row lookup must filter by BOTH id AND organization_id",
  );
});

test("supersedeSharedMemory archives old + inserts new + links supersedes_id", () => {
  assert.match(SHARED_SRC, /await archiveSharedMemory\(/);
  assert.match(SHARED_SRC, /await addSharedMemory\(/);
  assert.match(
    SHARED_SRC,
    /\.update\(\{ supersedes_id: input\.oldRowId \} as never\)/,
    "the replacement row must be stamped with supersedes_id pointing at the archived row",
  );
});

test("mark_memory_superseded + archive_memory MCP tools register at module load", () => {
  assert.match(
    TOOL_SRC,
    /registerTool\(\{\s*name:\s*"mark_memory_superseded"/,
  );
  assert.match(
    TOOL_SRC,
    /registerTool\(\{\s*name:\s*"archive_memory"/,
  );
  // Both are writes - the P0-5 approval gate must be able to gate them
  // when the org has approvals_gate_all on.
  const writeMatches = TOOL_SRC.match(/isWrite:\s*true/g) ?? [];
  assert.ok(
    writeMatches.length >= 2,
    `both write tools must mark isWrite: true; got ${writeMatches.length}`,
  );
});

test("mark_memory_superseded requires old_row_id + new_fact + surfaces clear errors", () => {
  // Without input validation an agent could call the tool with empty
  // inputs and silently archive nothing. The handler short-circuits to
  // textError so the agent sees the failure and can retry with the
  // correct payload.
  assert.match(TOOL_SRC, /required:\s*\["old_row_id",\s*"new_fact"\]/);
  assert.match(TOOL_SRC, /textError\("old_row_id is required"\)/);
  assert.match(TOOL_SRC, /textError\("new_fact is required"\)/);
});

test("tools/index.ts loads shared-memory module so registerTool side-effects fire", () => {
  assert.match(
    TOOL_INDEX_SRC,
    /import "\.\/shared-memory";/,
    "tools/index.ts must import ./shared-memory or the MCP route will not see the tools",
  );
});
