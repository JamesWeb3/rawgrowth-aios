import test from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// P0-6 I3: the independent critic in src/lib/agent/agent-commands.ts:1191
// stamps `verification: { verdict: "refine", note }` on the agent_invoke
// result detail. Before this fix, route.ts pass-2 only got the verdict
// inside a body paragraph the model paraphrased away. There was no hard
// rule forcing a re-dispatch.
//
// The chat route now scans commandResults for refine verdicts and
// appends a MANDATORY RE-DISPATCH OR JUSTIFY directive to the pass-2
// preamble. Building the directive end-to-end here would need to spin
// up the full chat route (Supabase, LLM client). Instead the suite reads
// the route source and pins:
//   - the scan happens (refineNotes assembled from commandResults)
//   - the directive string carries the verbs that drive behavior
//   - the directive is appended to the pass-2 extraPreamble

const ROUTE_SRC = readFileSync(
  resolve(__dirname, "../../src/app/api/agents/[id]/chat/route.ts"),
  "utf8",
);

test("chat route scans commandResults for verification.verdict === 'refine'", () => {
  assert.match(
    ROUTE_SRC,
    /const refineNotes = commandResults[\s\S]*?\.verification[\s\S]*?v\.verdict !== "refine"/,
    "refineNotes assembly must read detail.verification and filter to refine",
  );
});

test("refine directive uses the MANDATORY phrasing the orchestrator can not ignore", () => {
  // The phrasing was chosen because the prior 'soft' note ('verification:
  // needs refinement') let the model paraphrase the critic in prose.
  // Hard verbs (MUST EITHER (a) ... OR (b) ...) gate behavior.
  assert.match(ROUTE_SRC, /REFINE-VERDICT - MANDATORY RE-DISPATCH OR JUSTIFY/);
  assert.match(
    ROUTE_SRC,
    /MUST EITHER \(a\) emit ONE follow-on <command> block that re-dispatches/,
  );
  assert.match(
    ROUTE_SRC,
    /OR \(b\) in your visible reply explain in one sentence why the deliverable is acceptable/,
  );
  assert.match(
    ROUTE_SRC,
    /Do NOT silently pass the flagged output to the operator/,
  );
});

test("refine directive is appended to the pass-2 extraPreamble", () => {
  // The append site is the only place the model sees the directive,
  // because pass-2 is the orchestrator's chance to react to results.
  // Drop the append and the new symbol exists but is dead code.
  assert.match(
    ROUTE_SRC,
    /resultsBlock\s*\+\s*\n?\s*refineDirective,/,
    "refineDirective must concatenate onto the pass-2 extraPreamble after resultsBlock",
  );
});

test("refine directive is empty when no commandResult flagged refine", () => {
  // refineNotes.length === 0 -> empty string. Without that we would
  // inject the MANDATORY block on every turn that ran a command,
  // burning context for nothing.
  assert.match(
    ROUTE_SRC,
    /refineNotes\.length > 0[\s\S]*?:\s*""/,
    "directive must collapse to empty string when no refine flag is present",
  );
});
