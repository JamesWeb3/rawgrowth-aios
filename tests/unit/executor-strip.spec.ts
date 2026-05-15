import test from "node:test";
import { strict as assert } from "node:assert";

import { stripOrchestrationMarkup } from "@/lib/runs/executor";

test("strips wrapped <command> blocks (baseline)", () => {
  const out = stripOrchestrationMarkup(
    'Plan: scrape posts.\n<command type="tool_call">{"tool":"composio_use_tool","args":{}}</command>\nDone.',
  );
  assert.ok(!out.includes("<command"), "wrapped command tag must be stripped");
  assert.ok(!out.includes('"tool"'), "wrapped command body must be stripped");
  assert.match(out, /Plan: scrape posts\./);
  assert.match(out, /Done\./);
});

test("strips bare-JSON tool block with non-composio tool name (Kasia leak repro)", () => {
  const reply = [
    "Odpalam scraper na pillar AI creators - batch równolegle.",
    "",
    '{ "tool": "apify_run_actor", "args": { "actor_id": "apify/instagram-reel-scraper", "run_input": { "username": ["a","b"], "resultsLimit": 15 } } }',
    "",
    "Po powrocie batchy filtruję timestamp >= now-7d.",
  ].join("\n");
  const out = stripOrchestrationMarkup(reply);
  assert.ok(!out.includes('"tool":'), `bare JSON must be stripped, got:\n${out}`);
  assert.ok(!out.includes("apify_run_actor"), "tool name leaked into visible text");
  assert.match(out, /Odpalam scraper/);
  assert.match(out, /Po powrocie batchy/);
});

test("strips multiple adjacent bare-JSON tool blocks", () => {
  const reply = [
    "Batch plan:",
    '{ "tool": "apify_run_actor", "args": { "username": ["x"] } } { "tool": "apify_run_actor", "args": { "username": ["y"] } }',
    "End.",
  ].join("\n");
  const out = stripOrchestrationMarkup(reply);
  assert.ok(!out.includes('"tool"'), "all bare JSON tool blocks must be stripped");
  assert.match(out, /Batch plan:/);
  assert.match(out, /End\./);
});

test("strips bare-JSON agent_invoke shape", () => {
  const out = stripOrchestrationMarkup(
    'Now dispatching:\n{ "agent": "Kasia", "task": "draft 3 hooks" }\nWait for her output.',
  );
  assert.ok(!out.includes('"agent"'), "agent_invoke JSON must be stripped");
  assert.ok(!out.includes('"task"'), "task JSON must be stripped");
  assert.match(out, /Now dispatching:/);
  assert.match(out, /Wait for her output\./);
});

test("strips a fenced ```json``` tool block (fence consumed too)", () => {
  const reply = "Here is the call:\n```json\n{ \"tool\": \"apify_run_actor\", \"args\": {} }\n```\nDone.";
  const out = stripOrchestrationMarkup(reply);
  assert.ok(!out.includes("```"), "fence must be consumed too");
  assert.ok(!out.includes('"tool"'), "fenced bare JSON must be stripped");
  assert.match(out, /Here is the call:/);
  assert.match(out, /Done\./);
});

test("preserves legitimate JSON-like text that is NOT a command shape", () => {
  const reply =
    'Here is the result: {"likes": 320, "comments": 2125, "url": "https://example.com"}\nUse it.';
  const out = stripOrchestrationMarkup(reply);
  // No tool/agent/title+description+assignee keys -> must be kept.
  assert.match(out, /"likes": 320/);
  assert.match(out, /"comments": 2125/);
});

test("idempotent on a clean reply", () => {
  const reply = "Top post: Zwolniłam ChatGPT - 320 likes / 2125 comments.";
  assert.equal(stripOrchestrationMarkup(reply), reply.trim());
});
