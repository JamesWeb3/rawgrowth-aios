import test from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// FLEX VOICE FIX (Chris feedback 2026-05-17, B audit Top 5):
// the preamble lied about agent capability ("CANNOT change agent's
// role/department/title - there is no tool") which made agents
// refuse to use agents_update even though it exists. It also leaked
// Pedro's name as the gatekeeper. And agents_update's MCP input
// schema was missing system_prompt + max_tokens even though the
// underlying queries.ts:75 already wrote them.

const PREAMBLE_SRC = readFileSync(
  resolve(__dirname, "../../src/lib/agent/preamble.ts"),
  "utf8",
);
const AGENTS_TOOL_SRC = readFileSync(
  resolve(__dirname, "../../src/lib/mcp/tools/agents.ts"),
  "utf8",
);
const TG_TOKEN_ROUTE_SRC = readFileSync(
  resolve(__dirname, "../../src/app/api/connections/agent-telegram/[id]/token/route.ts"),
  "utf8",
);

test("preamble no longer says 'I CANNOT change an agent's role' as a blanket lie", () => {
  // The hardcoded I-CANNOT line trained the model to refuse
  // agents_update even though the tool exists. We replaced the line
  // with the CAN-do version that documents the real capability.
  assert.ok(
    !/There is no tool for that - it is operator UI work/.test(PREAMBLE_SRC),
    "the old 'There is no tool for that' lie must be removed",
  );
  assert.match(
    PREAMBLE_SRC,
    /I CAN edit my own \+ my peers' agent rows[\s\S]*?agents_update tool/,
    "preamble must explicitly tell the agent about agents_update",
  );
});

test("preamble does not leak Pedro's name as gatekeeper", () => {
  // The infra-escalation line previously said "ping Pedro" verbatim,
  // which leaked Pedro's name to every client and signalled there IS
  // a gatekeeper. Replaced with "platform administrator".
  assert.ok(
    !/ping Pedro/.test(PREAMBLE_SRC),
    "preamble must not name Pedro as the gatekeeper anymore",
  );
  assert.ok(
    !/Pedro's rule/.test(PREAMBLE_SRC),
    "preamble must not attribute rules to Pedro by name anymore",
  );
});

test("preamble keeps the wholesale-restructure soft-block but uses agents_update for persona edits", () => {
  // Wholesale restructure (creating departments, firing agents) still
  // belongs in the UI. But persona / prompt / behaviour edits to an
  // existing agent are in-scope for agents_update.
  assert.match(
    PREAMBLE_SRC,
    /Persona \/ prompt \/ behaviour edits to an existing agent ARE in scope: call agents_update/,
  );
});

test("agents_update MCP schema exposes system_prompt + max_tokens", () => {
  // Schema gap that was the loudest "client can't self-fix" symptom.
  // The handler at queries.ts:75 already wrote these fields - just
  // the MCP input schema was hiding them.
  assert.match(
    AGENTS_TOOL_SRC,
    /system_prompt:\s*\{\s*type:\s*"string"/,
    "system_prompt must be listed in agents_update inputSchema",
  );
  assert.match(
    AGENTS_TOOL_SRC,
    /max_tokens:\s*\{\s*type:\s*"number"/,
    "max_tokens must be listed in agents_update inputSchema",
  );
  // Handler must consume both - tests/unit pins the wiring so a
  // future schema add without handler wiring fails loudly.
  assert.match(
    AGENTS_TOOL_SRC,
    /if \(args\.system_prompt !== undefined\)[\s\S]*?patch\.systemPrompt/,
    "agents_update handler must thread system_prompt into the queries.ts patch",
  );
  assert.match(
    AGENTS_TOOL_SRC,
    /if \(args\.max_tokens !== undefined\)[\s\S]*?patch\.maxTokens = n;/,
    "agents_update handler must thread max_tokens into the queries.ts patch",
  );
});

test("agent-telegram bot token reveal is self-serve for owner/admin", () => {
  // Was Pedro-only (isAdmin home org = ADMIN_ORG_ID). Now owner /
  // admin of the active org can reveal their own bot token without
  // a platform-operator ticket.
  assert.match(
    TG_TOKEN_ROUTE_SRC,
    /import \{ getOrgContext, getActiveOrgRole \} from "@\/lib\/auth\/admin"/,
  );
  assert.match(
    TG_TOKEN_ROUTE_SRC,
    /const allowed = ctx\.isAdmin \|\| role === "owner" \|\| role === "admin";/,
  );
});
