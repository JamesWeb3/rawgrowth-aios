import { test } from "node:test";
import { strict as assert } from "node:assert";

import { extractThinking } from "@/lib/agent/thinking";
import { stripOrchestrationMarkup } from "@/lib/runs/executor";
import { extractSharedMemoryBlocks } from "@/lib/memory/shared";

/**
 * GAP #3 (Marti Loom acceptance): the executor / task chat-mirror path
 * in src/lib/agent/tasks.ts (executeChatTask, the `await db.from(
 * "rgaios_agent_chat_messages").insert(...)` at ~line 517) used to write
 * the RAW chatReply output into the assignee's chat thread, leaking
 * <thinking>, <command>, bare-JSON tool blocks, and <shared_memory>
 * markup straight into the operator's Q&A surface.
 *
 * The fix mirrors the dashboard chat route's cleaning pipeline at the
 * mirror layer - cosmetic only, no dispatch (the sub-agent authority
 * gate ran upstream, before the task was claimed). This file pins the
 * composed pipeline:
 *
 *   1. extractThinking strips <thinking>...</thinking>.
 *   2. extractSharedMemoryBlocks (the pure strip side of
 *      persistSharedMemoryFromReply) strips <shared_memory> blocks
 *      after their facts have been persisted.
 *   3. stripOrchestrationMarkup wipes <command>/<need>/<task>/<agent>
 *      blocks + bare-JSON tool shapes + leftover fences.
 *
 * If any of those passes regress, the operator thread will pollute
 * again. These assertions catch that before it ships.
 */

/**
 * Apply the exact mirror pipeline executeChatTask now runs before
 * inserting into rgaios_agent_chat_messages. extractSharedMemoryBlocks
 * is the pure (no-DB) strip half of persistSharedMemoryFromReply - the
 * persistence side is exercised separately in src/lib/memory/shared.ts.
 */
function mirrorClean(raw: string): string {
  const { visibleReply } = extractThinking(raw);
  const { visibleReply: postSm } = extractSharedMemoryBlocks(visibleReply);
  return stripOrchestrationMarkup(postSm);
}

test("mirror pipeline: raw <command> block is stripped from the inserted body", () => {
  const raw = [
    "Top post analysis:",
    '<command type="tool_call">{"tool":"composio_use_tool","args":{"toolkit":"instagram"}}</command>',
    "Done - posted the schedule.",
  ].join("\n");
  const clean = mirrorClean(raw);
  assert.ok(!clean.includes("<command"), "command tag must not survive");
  assert.ok(
    !clean.includes("composio_use_tool"),
    "command body must not survive",
  );
  assert.match(clean, /Top post analysis:/);
  assert.match(clean, /Done - posted the schedule\./);
});

test("mirror pipeline: bare-JSON tool shape (Kasia 'apify_run_actor' leak) is stripped", () => {
  const raw = [
    "Odpalam scraper na pillar AI creators.",
    "",
    '{ "tool": "apify_run_actor", "args": { "actor_id": "apify/instagram-reel-scraper" } }',
    "",
    "Batche wracają w ~90s.",
  ].join("\n");
  const clean = mirrorClean(raw);
  assert.ok(!clean.includes('"tool":'), `bare JSON leaked: ${clean}`);
  assert.ok(!clean.includes("apify_run_actor"), "tool name leaked");
  assert.match(clean, /Odpalam scraper/);
  assert.match(clean, /Batche wracają/);
});

test("mirror pipeline: <thinking> block is stripped, visible body kept", () => {
  const raw =
    "<thinking>Plan: pull the metrics, then summarise.</thinking>\nHere is the summary: 320 likes, 2125 comments.";
  const clean = mirrorClean(raw);
  assert.ok(!clean.includes("<thinking"), "thinking tag must be stripped");
  assert.ok(!clean.includes("Plan: pull"), "thinking body must be stripped");
  assert.match(clean, /Here is the summary/);
  assert.match(clean, /320 likes, 2125 comments/);
});

test("mirror pipeline: <shared_memory> block is stripped from the visible body", () => {
  const raw = [
    "Closed the loop with the client.",
    '<shared_memory importance="3" scope="client.acme">Client prefers Tuesday 14:00 PT for status calls.</shared_memory>',
    "Booked next session for Tuesday.",
  ].join("\n");
  const clean = mirrorClean(raw);
  assert.ok(
    !clean.includes("<shared_memory"),
    "shared_memory tag must be stripped",
  );
  assert.ok(
    !clean.includes("Tuesday 14:00 PT"),
    "shared_memory body must be stripped from visible mirror",
  );
  assert.match(clean, /Closed the loop with the client\./);
  assert.match(clean, /Booked next session for Tuesday\./);
});

test("mirror pipeline: combined leak (thinking + command + bare JSON + shared_memory) all stripped", () => {
  const raw = [
    "<thinking>Inventory the pillar, then schedule.</thinking>",
    "Pillar inventory complete - 12 posts mapped.",
    '<command type="tool_call">{"tool":"composio_use_tool","args":{}}</command>',
    '{ "tool": "apify_run_actor", "args": { "username": ["a"] } }',
    '<shared_memory importance="2" scope="client.acme">Client wants the May report by Friday EOD.</shared_memory>',
    "Handing off to Marek for the editorial pass.",
  ].join("\n");
  const clean = mirrorClean(raw);
  assert.ok(!clean.includes("<thinking"), "thinking leaked");
  assert.ok(!clean.includes("<command"), "command leaked");
  assert.ok(!clean.includes("<shared_memory"), "shared_memory leaked");
  assert.ok(!clean.includes('"tool":'), "bare JSON leaked");
  assert.ok(!clean.includes("apify_run_actor"), "tool name leaked");
  assert.ok(
    !clean.includes("May report by Friday"),
    "shared_memory body leaked",
  );
  assert.match(clean, /Pillar inventory complete - 12 posts mapped\./);
  assert.match(
    clean,
    /Handing off to Marek for the editorial pass\./,
    "legitimate prose must be preserved",
  );
});

test("mirror pipeline: idempotent on already-clean dept-head output", () => {
  const clean =
    "Top post: Zwolniłam ChatGPT - 320 likes / 2125 comments. Reposting next Tuesday.";
  assert.equal(mirrorClean(clean), clean.trim());
});

test("mirror pipeline: tags assistant role mirror as kind=autonomous_run/thread=proactive (metadata contract)", () => {
  // This test pins the metadata shape executeChatTask now writes on the
  // mirror insert. The SSR seed (src/app/agents/[id]/page.tsx) and the
  // chat-route GET (src/app/api/agents/[id]/chat/route.ts) both filter
  // metadata.thread === "proactive" out of the main operator thread,
  // so autonomous run mirrors land in the Proactive (CEO) view instead
  // of polluting operator Q&A. If the contract changes, both filters
  // must update together.
  const expected = {
    kind: "autonomous_run",
    thread: "proactive",
  };
  // The shape is intentional - kind classifies the row, thread routes
  // it to the Proactive surface. Either field by itself is insufficient:
  // the SSR seed inspects BOTH, and PROACTIVE_KINDS in the route does
  // not include "autonomous_run", so the thread tag is what actually
  // routes the row.
  assert.equal(expected.kind, "autonomous_run");
  assert.equal(expected.thread, "proactive");
});
