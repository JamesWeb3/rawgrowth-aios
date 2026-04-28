import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkText } from "../../src/lib/knowledge/chunker";

test("empty input returns empty array", () => {
  assert.deepEqual(chunkText(""), []);
  assert.deepEqual(chunkText("   \n\n  "), []);
});

test("short input returns single chunk", () => {
  const out = chunkText("Hello world.");
  assert.equal(out.length, 1);
  assert.equal(out[0].index, 0);
  assert.equal(out[0].content, "Hello world.");
});

test("long input splits into multiple chunks", () => {
  const para = "This is a paragraph. ".repeat(200); // ~4200 chars
  const out = chunkText(para);
  assert.ok(out.length >= 4, `expected >=4 chunks, got ${out.length}`);
  for (const c of out) {
    // overlap can push over CHUNK_SIZE but not by much
    assert.ok(c.content.length <= 900 + 120 + 10, `chunk ${c.index} too big: ${c.content.length}`);
  }
});

test("chunks are indexed sequentially", () => {
  const text = "Paragraph one.\n\n" + "word ".repeat(300) + "\n\nParagraph three.";
  const out = chunkText(text);
  out.forEach((c, i) => assert.equal(c.index, i));
});

test("overlap preserves context across boundary", () => {
  const text = "A".repeat(800) + "\n\n" + "B".repeat(800) + "\n\n" + "C".repeat(800);
  const out = chunkText(text);
  assert.ok(out.length >= 2);
  // second chunk starts with tail of first
  if (out.length >= 2) {
    const tail = out[0].content.slice(-120);
    assert.ok(out[1].content.startsWith(tail.slice(0, 50)), "overlap not preserved");
  }
});

test("CRLF normalized to LF", () => {
  const out = chunkText("line one.\r\nline two.");
  assert.equal(out.length, 1);
  assert.doesNotMatch(out[0].content, /\r/);
});

test("single oversized word forces hard cut", () => {
  const text = "x".repeat(2500);
  const out = chunkText(text);
  assert.ok(out.length >= 3, `expected hard-cut into >=3, got ${out.length}`);
});
