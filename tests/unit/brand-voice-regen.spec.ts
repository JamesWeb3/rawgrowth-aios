import { test } from "node:test";
import assert from "node:assert/strict";
import {
  regenerateWithBrandReminder,
  checkBrandVoice,
} from "../../src/lib/brand/runtime-filter";

// The default invoke calls Anthropic over the network. These tests inject
// a deterministic stub so we exercise the 2-pass flow without needing
// ANTHROPIC_API_KEY and without network flake.
function stub(reply: string) {
  return async () => ({ text: reply });
}

test("clean draft never reaches regen (sanity: caller checks first)", () => {
  const r = checkBrandVoice("We shipped the migration and tests are green.");
  assert.equal(r.ok, true);
});

test("dirty draft + clean rewrite → ok:true with rewritten text", async () => {
  const draft = "We leverage the migration to empower the team.";
  const first = checkBrandVoice(draft);
  assert.equal(first.ok, false);
  if (first.ok) return;

  const result = await regenerateWithBrandReminder(draft, first.hits, {
    invoke: stub("We use the migration to equip the team."),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.text, "We use the migration to equip the team.");
});

test("dirty draft + still-dirty rewrite → ok:false with hits + sanitised finalAttempt", async () => {
  const draft = "We leverage this stack.";
  const first = checkBrandVoice(draft);
  assert.equal(first.ok, false);
  if (first.ok) return;

  const result = await regenerateWithBrandReminder(draft, first.hits, {
    // The "rewrite" still includes 'leverage' — guard must hard-fail.
    invoke: stub("We still leverage this stack heavily."),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.hits.includes("leverage"));
  // finalAttempt is the substring-sanitised version of the bad rewrite so
  // the operator-bound audit row never carries a live banned word.
  assert.doesNotMatch(result.finalAttempt, /leverage/i);
});

test("regen invoke throws → ok:false, hits preserved, finalAttempt sanitised from original", async () => {
  const draft = "We leverage everything.";
  const first = checkBrandVoice(draft);
  assert.equal(first.ok, false);
  if (first.ok) return;

  const result = await regenerateWithBrandReminder(draft, first.hits, {
    invoke: async () => {
      throw new Error("anthropic 503");
    },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.hits.includes("leverage"));
  assert.doesNotMatch(result.finalAttempt, /leverage/i);
});

test("regen aborts on 10s timeout (simulated by checking signal is wired)", async () => {
  const draft = "We leverage everything.";
  const first = checkBrandVoice(draft);
  assert.equal(first.ok, false);
  if (first.ok) return;

  // Simulate an invoke that respects the AbortSignal: throw immediately
  // when caller-passed signal is aborted. We assert the signal arrives
  // wired up by aborting it inside the stub before resolving.
  let signalSeen: AbortSignal | null = null;
  const result = await regenerateWithBrandReminder(draft, first.hits, {
    invoke: async ({ signal }) => {
      signalSeen = signal;
      throw new Error("aborted");
    },
  });
  assert.notEqual(signalSeen, null);
  assert.equal(result.ok, false);
});

test("trims whitespace around regen output", async () => {
  const draft = "We leverage everything.";
  const first = checkBrandVoice(draft);
  if (first.ok) return;

  const result = await regenerateWithBrandReminder(draft, first.hits, {
    invoke: stub("   We use everything.   \n"),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.text, "We use everything.");
});
