import { test } from "node:test";
import assert from "node:assert/strict";

import {
  extractChatMemoryFact,
  interpretFactReply,
} from "../../src/lib/agent/chat-memory";

/**
 * Unit tests for src/lib/agent/chat-memory.ts.
 *
 * The Haiku call inside extractChatMemoryFact is a side effect we
 * deliberately do not mock - generateText is an ESM named export and
 * patching it across paths is brittle. Instead, the side-effect-free
 * parsing rules live in interpretFactReply and we test those directly;
 * the wrapper's deterministic guards (no API key / empty inputs) are
 * also covered without an LLM round-trip.
 */

test("interpretFactReply: NONE marker returns null", () => {
  assert.equal(interpretFactReply("NONE"), null);
  assert.equal(interpretFactReply("NONE."), null);
  assert.equal(interpretFactReply("none!"), null);
  assert.equal(interpretFactReply("  NONE  "), null);
});

test("interpretFactReply: empty / whitespace returns null", () => {
  assert.equal(interpretFactReply(""), null);
  assert.equal(interpretFactReply("   "), null);
  assert.equal(interpretFactReply("\n\n"), null);
});

test("interpretFactReply: number-bearing fact is returned verbatim", () => {
  const r = interpretFactReply(
    "Top reel by comments in the last 10 days is @aiwithremy with 6669 comments.",
  );
  assert.ok(r);
  assert.match(r, /6669/);
  assert.match(r, /aiwithremy/);
});

test("interpretFactReply: matched leading/trailing quotes are stripped", () => {
  assert.equal(
    interpretFactReply('"Operator prefers PT-BR."'),
    "Operator prefers PT-BR.",
  );
  assert.equal(
    interpretFactReply("'Posts use minimalist tone.'"),
    "Posts use minimalist tone.",
  );
});

test("interpretFactReply: caps at 300 chars", () => {
  const long = "x".repeat(500);
  const r = interpretFactReply(long);
  assert.ok(r);
  assert.equal(r.length, 300);
});

test("extractChatMemoryFact: no API key returns null without calling LLM", async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const r = await extractChatMemoryFact(
      "What is the top reel?",
      "The top reel has 6669 comments.",
    );
    assert.equal(r, null);
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});

test("extractChatMemoryFact: empty user message returns null", async () => {
  process.env.ANTHROPIC_API_KEY ??= "sk-test-not-used";
  const r = await extractChatMemoryFact("", "anything");
  assert.equal(r, null);
});

test("extractChatMemoryFact: empty assistant reply returns null", async () => {
  process.env.ANTHROPIC_API_KEY ??= "sk-test-not-used";
  const r = await extractChatMemoryFact("anything", "");
  assert.equal(r, null);
});
