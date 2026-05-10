import { test } from "node:test";
import assert from "node:assert/strict";

import { needsToolPath } from "../../src/lib/agent/chat-tools";

/**
 * Heuristic gate for the dashboard-chat tool path. The function is
 * deliberately dumb (single regex). These cases lock in:
 *   1. plain conversation → no tool path
 *   2. obvious tool intent → tool path
 *   3. empty / whitespace input is safe (no false positive)
 *   4. case-insensitive matching
 *
 * If the regex needs broadening later, add a positive case here so
 * the change is intentional rather than incidental.
 */

test("needsToolPath: plain greeting does not trigger", () => {
  assert.equal(needsToolPath("hey, how's it going?"), false);
  assert.equal(needsToolPath("what do you think about Q4 strategy?"), false);
  assert.equal(needsToolPath("explain RAG to me"), false);
});

test("needsToolPath: gmail / inbox phrasing triggers", () => {
  assert.ok(needsToolPath("search my gmail for the invoice from acme"));
  assert.ok(needsToolPath("Find that thread in my Gmail"));
  assert.ok(needsToolPath("send james an email saying hi"));
});

test("needsToolPath: slack / notion / hubspot integration phrasing triggers", () => {
  assert.ok(needsToolPath("post to slack #general saying we shipped"));
  assert.ok(needsToolPath("create a page in notion"));
  assert.ok(needsToolPath("list my agents"));
});

test("needsToolPath: empty string is safe", () => {
  assert.equal(needsToolPath(""), false);
  assert.equal(needsToolPath("   "), false);
});

test("needsToolPath: case insensitive", () => {
  assert.ok(needsToolPath("SEARCH my email"));
  assert.ok(needsToolPath("Send a message to kelly"));
});
