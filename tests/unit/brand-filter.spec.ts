import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBrandVoice } from "../../src/lib/brand/runtime-filter";

test("clean text passes", () => {
  const r = checkBrandVoice("We shipped the migration and wrote tests.");
  assert.equal(r.ok, true);
});

test("banned word flagged and rewritten", () => {
  const r = checkBrandVoice("We leverage this stack.");
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(r.hits.includes("leverage"));
  assert.match(r.rewritten, /use/);
  assert.doesNotMatch(r.rewritten, /leverage/i);
});

test("multiple hits surfaced", () => {
  const r = checkBrandVoice("This revolutionary synergy will empower teams.");
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(r.hits.length >= 3);
});

test("case preserved on first letter", () => {
  const r = checkBrandVoice("Leverage this.");
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.rewritten, /^Use/);
});

test("word boundary: 'leveraged' still matches because regex is gi on exact token 'leverage'", () => {
  // 'leveraged' contains 'leverage' + 'd' — \b..\b on 'leverage' does NOT match
  // because 'd' is a word char. So 'leveraged' is safe.
  const r = checkBrandVoice("We leveraged nothing.");
  assert.equal(r.ok, true);
});

test("multi-word phrase matched with flexible whitespace", () => {
  const r = checkBrandVoice("This is a  game-changer.");
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(r.hits.includes("game-changer"));
});

test("empty string passes", () => {
  const r = checkBrandVoice("");
  assert.equal(r.ok, true);
});
