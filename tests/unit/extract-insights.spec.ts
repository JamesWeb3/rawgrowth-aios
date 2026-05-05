import { test } from "node:test";
import assert from "node:assert/strict";

import { parseInsightReply } from "../../src/lib/sales-calls/extract-insights";

/**
 * Unit tests for the LLM-reply parsing path. We test `parseInsightReply`
 * directly because it's the only piece with non-trivial logic - the
 * outer `extractInsights` is a thin wrapper that calls chatComplete and
 * forwards the text. Mocking `chatComplete` (an ESM named export) is
 * brittle; testing the pure parser keeps the suite hermetic.
 *
 * Coverage:
 *   1. Clean JSON   ->  full SalesCallInsights returned.
 *   2. Fenced JSON  ->  fences stripped, parsed.
 *   3. Object embedded in prose  ->  extracted by isolateJson().
 *   4. Garbage prose  ->  graceful fail with _error.
 *   5. Empty reply   ->  _error 'empty model reply'.
 *   6. Wrong shape (array, primitive)  ->  _error.
 *   7. List clamping (>5 items, >200 chars).
 */

test("parseInsightReply: clean JSON produces full insight bundle", () => {
  const r = parseInsightReply(
    JSON.stringify({
      objections: ["Already using Mixpanel", "Six weeks is too slow"],
      painPoints: ["Attribution across channels"],
      buyingSignals: ["When could we start a pilot?"],
      stuckPoints: ["Rep deferred to engineering"],
      productFitGaps: ["Snowflake export"],
      suggestedActions: ["Send roadmap doc by Friday"],
    }),
  );
  assert.equal(r._error, undefined);
  assert.deepEqual(r.objections, [
    "Already using Mixpanel",
    "Six weeks is too slow",
  ]);
  assert.equal(r.suggestedActions[0], "Send roadmap doc by Friday");
});

test("parseInsightReply: markdown fences are stripped", () => {
  const r = parseInsightReply(
    "```json\n" +
      JSON.stringify({
        objections: ["fenced reply works"],
        painPoints: [],
        buyingSignals: [],
        stuckPoints: [],
        productFitGaps: [],
        suggestedActions: [],
      }) +
      "\n```",
  );
  assert.equal(r._error, undefined);
  assert.deepEqual(r.objections, ["fenced reply works"]);
});

test("parseInsightReply: JSON embedded in prose is extracted", () => {
  const r = parseInsightReply(
    'Here is your JSON: {"objections":["embedded"],"painPoints":[],"buyingSignals":[],"stuckPoints":[],"productFitGaps":[],"suggestedActions":[]} thanks!',
  );
  assert.equal(r._error, undefined);
  assert.deepEqual(r.objections, ["embedded"]);
});

test("parseInsightReply: garbage prose returns graceful _error", () => {
  const r = parseInsightReply("I'm sorry, I can't help with that.");
  assert.ok(r._error, "expected an _error");
  assert.deepEqual(r.objections, []);
});

test("parseInsightReply: empty reply returns 'empty model reply'", () => {
  const r = parseInsightReply("");
  assert.equal(r._error, "empty model reply");
});

test("parseInsightReply: wrong shape (array) returns _error", () => {
  const r = parseInsightReply("[1,2,3]");
  assert.ok(r._error, "expected an _error for array reply");
});

test("parseInsightReply: clamps to 5 items and 200 chars per item", () => {
  const r = parseInsightReply(
    JSON.stringify({
      objections: ["a", "b", "c", "d", "e", "f", "g"],
      painPoints: ["x".repeat(300)],
      buyingSignals: [],
      stuckPoints: [],
      productFitGaps: [],
      suggestedActions: [],
    }),
  );
  assert.equal(r.objections.length, 5);
  assert.equal(r.painPoints[0].length, 200);
});

test("parseInsightReply: skips non-string entries silently", () => {
  const r = parseInsightReply(
    JSON.stringify({
      objections: ["valid", 42, null, "another"],
      painPoints: [],
      buyingSignals: [],
      stuckPoints: [],
      productFitGaps: [],
      suggestedActions: [],
    }),
  );
  assert.deepEqual(r.objections, ["valid", "another"]);
});
