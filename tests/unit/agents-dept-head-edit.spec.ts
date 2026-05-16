import test from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// HOTFIX 1 (triage 2026-05-17 / FLEX VOICE FIX 4): dept-head agents
// previously had the same wide MCP guard as the CEO. T9 acceptance
// test "Kasia (dept-head) self-adds Gmail integration" failed
// because integrations / status / department were ALL locked behind
// the same array. Narrow:
//   role === "ceo"           -> full lock minus name/title/desc/budget
//   is_department_head true  -> only role / reports_to / department locked,
//                               integrations + status + everything else open
//
// These specs pin the agents.ts source so the guard cannot silently
// widen again. Live behavior tested separately via T9 playwright walk.

const AGENTS_SRC = readFileSync(
  resolve(__dirname, "../../src/lib/mcp/tools/agents.ts"),
  "utf8",
);

test("agents_update keeps the full CEO guard array (high-blast surface)", () => {
  // CEO row stays operator-managed. The wide array prevents an MCP
  // caller from rewiring the Atlas / CEO agent's plumbing.
  assert.match(
    AGENTS_SRC,
    /if \(target\.role === "ceo"\)[\s\S]*?guarded = \["role", "reports_to", "integrations", "department", "status"\]/,
    "CEO branch must still guard the full array",
  );
});

test("agents_update narrows dept-head guard to role + reports_to + department only", () => {
  // FIX 4 unlocks integrations + status for dept-heads so a Marketing
  // Manager can wire its own Gmail without a Pedro ticket. role +
  // reports_to + department stay locked because they reshape the org
  // tree and belong in /agents UI.
  assert.match(
    AGENTS_SRC,
    /} else if \(target\.is_department_head === true\)[\s\S]*?guarded = \["role", "reports_to", "department"\]/,
    "dept-head branch must guard ONLY role + reports_to + department",
  );
});

test("dept-head guard branch is a separate else-if (not a combined OR with ceo)", () => {
  // The pre-fix code had `if (target.role === "ceo" || target.is_department_head === true)`
  // which collapsed both into the wide-array path. Confirm the branches
  // are split so a future edit can't accidentally re-combine them.
  assert.ok(
    !/target\.role === "ceo" \|\| target\.is_department_head/.test(AGENTS_SRC),
    "ceo and is_department_head must be checked in SEPARATE branches",
  );
});

test("error message documents what dept-heads CAN edit (operator UX)", () => {
  // The error string an agent sees when it tries a locked field needs
  // to tell it WHAT it CAN still edit, otherwise the model gives up.
  // The string must list integrations / status / system_prompt /
  // max_tokens explicitly so the agent knows to retry with the right
  // field.
  assert.match(
    AGENTS_SRC,
    /is a department head[\s\S]*?integrations \/ status \/ name \/ title \/ description \/ budget \/ system_prompt \/ max_tokens stay editable from MCP/,
  );
});
