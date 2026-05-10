import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { KNOWN_DEPARTMENT_SLUGS } from "../../src/lib/auth/dept-acl";

/**
 * Guards against drift between `KNOWN_DEPARTMENT_SLUGS` (consumed by the
 * invite + insights routes) and the `DEFAULT_AGENT_SEED` department slugs
 * defined in src/lib/agents/seed.ts. Read the seed file as text instead of
 * importing it, so this test stays free of the supabase + ingest module
 * graph that seed.ts pulls in.
 */
test("KNOWN_DEPARTMENT_SLUGS matches DEFAULT_AGENT_SEED departments", () => {
  const seedPath = join(__dirname, "../../src/lib/agents/seed.ts");
  const seedSrc = readFileSync(seedPath, "utf8");
  // Match each `department: "<slug>",` line inside DEFAULT_AGENT_SEED -
  // the trailing comma anchors on the const-object form and skips the
  // DepartmentSeed type union (which uses ` | ` between literals).
  const matches = [...seedSrc.matchAll(/department:\s*"([a-z][a-z0-9_-]*)",/g)];
  const seedSlugs = [...new Set(matches.map((m) => m[1]))].sort();
  const knownSlugs = [...KNOWN_DEPARTMENT_SLUGS].sort();
  assert.deepEqual(
    knownSlugs,
    seedSlugs,
    "Update src/lib/auth/dept-acl.ts KNOWN_DEPARTMENT_SLUGS when adding a department in src/lib/agents/seed.ts (or vice versa)",
  );
});
