import { test } from "node:test";
import assert from "node:assert/strict";

import { parseCliToolCalls } from "../../src/lib/llm/provider";

/**
 * Unit tests for the anthropic-cli tool-call extraction path. We test
 * `parseCliToolCalls` directly so no `claude` binary needs to be on PATH.
 * The runAnthropicCli path is a thin wrapper: prompt-build + spawn + parse.
 *
 * The five required cases are covered:
 *   1. Empty tools (no tool_call blocks) - text passes through, no calls.
 *   2. Single valid tool call.
 *   3. Multiple tool calls in order.
 *   4. Invalid JSON inside a tool_call - placeholder with _parseError.
 *   5. Tool calls stripped from the returned `text`.
 */

test("parseCliToolCalls: no blocks returns text untouched and zero tool calls", () => {
  const raw = "Hi - I am replying with plain text only.";
  const { text, toolCalls } = parseCliToolCalls(raw);
  assert.equal(text, raw);
  assert.equal(toolCalls.length, 0);
});

test("parseCliToolCalls: single tool call parsed with valid JSON input", () => {
  const raw = [
    "Sure, capturing your intake now.",
    "```tool_call name=capture_intake",
    '{"section_id":"comm_prefs","data":{"channel":"telegram"}}',
    "```",
  ].join("\n");
  const { toolCalls } = parseCliToolCalls(raw);
  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0].name, "capture_intake");
  assert.equal(toolCalls[0].id, "capture_intake_0");
  assert.deepEqual(toolCalls[0].input, {
    section_id: "comm_prefs",
    data: { channel: "telegram" },
  });
});

test("parseCliToolCalls: multiple tool calls preserved in order with sequential ids", () => {
  const raw = [
    "First I will record this, then advance.",
    "```tool_call name=capture_intake",
    '{"section_id":"comm_prefs"}',
    "```",
    "Now advancing.",
    "```tool_call name=advance_section",
    '{"to":"brand_voice"}',
    "```",
    "Done.",
  ].join("\n");
  const { toolCalls } = parseCliToolCalls(raw);
  assert.equal(toolCalls.length, 2);
  assert.equal(toolCalls[0].name, "capture_intake");
  assert.equal(toolCalls[0].id, "capture_intake_0");
  assert.deepEqual(toolCalls[0].input, { section_id: "comm_prefs" });
  assert.equal(toolCalls[1].name, "advance_section");
  assert.equal(toolCalls[1].id, "advance_section_1");
  assert.deepEqual(toolCalls[1].input, { to: "brand_voice" });
});

test("parseCliToolCalls: invalid JSON surfaces _parseError without crashing", () => {
  const raw = [
    "```tool_call name=set_brand_profile",
    "{not valid json,,,}",
    "```",
  ].join("\n");
  const { toolCalls } = parseCliToolCalls(raw);
  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0].name, "set_brand_profile");
  const input = toolCalls[0].input;
  assert.equal(typeof input._parseError, "string");
  assert.ok((input._parseError as string).length > 0, "non-empty parse-error message");
  assert.equal(input._raw, "{not valid json,,,}");
});

test("parseCliToolCalls: tool_call blocks stripped from returned text", () => {
  const raw = [
    "Got it.",
    "```tool_call name=capture_intake",
    '{"x":1}',
    "```",
    "All set.",
  ].join("\n");
  const { text, toolCalls } = parseCliToolCalls(raw);
  assert.equal(toolCalls.length, 1);
  assert.ok(!text.includes("tool_call"), "no tool_call marker leaks into text");
  assert.ok(!text.includes("```"), "no fence remnants in text");
  assert.ok(text.includes("Got it."));
  assert.ok(text.includes("All set."));
});

test("parseCliToolCalls: unknown-name block still surfaced for caller dispatch", () => {
  // Caller's dispatcher decides the "unknown tool" error; the parser
  // intentionally does not gatekeep against the request-time tool list.
  const raw = [
    "```tool_call name=mystery_tool",
    '{"foo":"bar"}',
    "```",
  ].join("\n");
  const { toolCalls } = parseCliToolCalls(raw);
  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0].name, "mystery_tool");
  assert.deepEqual(toolCalls[0].input, { foo: "bar" });
});
