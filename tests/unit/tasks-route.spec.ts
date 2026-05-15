import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildTaskResponse,
  dedupeNearby,
  isDelivered,
  markDelivered,
  type EnrichedTask,
  type TaskRow,
} from "../../src/lib/tasks/dedupe";

/**
 * Marti GAP #4 - /tasks dedup + delivered flag.
 *
 * We test the pure helpers in src/lib/tasks/dedupe.ts directly. The
 * route handler (src/app/api/tasks/route.ts) is a thin shell around
 * Supabase queries + a call to buildTaskResponse - mocking Supabase
 * + getOrgContext (ESM named exports) would be brittle and would not
 * exercise anything the helpers don't already exercise. Following
 * the boundary-mocking pattern set by extract-insights.spec.ts and
 * audit-call-extract.spec.ts.
 *
 * Coverage:
 *  1. isDelivered: succeeded + non-empty output -> true.
 *  2. isDelivered: succeeded + empty / whitespace / null output -> false.
 *  3. isDelivered: non-succeeded statuses -> false.
 *  4. markDelivered: copies row, sets delivered + dedupedFrom=0.
 *  5. dedupeNearby: empty / singleton passthrough.
 *  6. dedupeNearby: collapses titles inside the window, increments
 *     dedupedFrom, keeps the LATEST row.
 *  7. dedupeNearby: leaves rows outside the window alone.
 *  8. dedupeNearby: case + whitespace insensitive on title match.
 *  9. dedupeNearby: distinct titles never collapse.
 * 10. buildTaskResponse: integration - enriches + dedupes.
 */

function row(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    routineId: overrides.routineId ?? "r-" + Math.random().toString(36).slice(2, 8),
    title: overrides.title ?? "Untitled",
    description: overrides.description ?? null,
    kind: overrides.kind ?? "workflow",
    createdAt: overrides.createdAt ?? "2026-05-15T12:00:00.000Z",
    assignee: overrides.assignee ?? null,
    runCount: overrides.runCount ?? 1,
    latestStatus: overrides.latestStatus ?? "pending",
    latestRunAt: overrides.latestRunAt ?? null,
    latestOutput: overrides.latestOutput ?? null,
    latestError: overrides.latestError ?? null,
  };
}

function enriched(overrides: Partial<TaskRow> = {}): EnrichedTask {
  return markDelivered(row(overrides));
}

test("isDelivered: succeeded + non-empty output is delivered", () => {
  const r = row({ latestStatus: "succeeded", latestOutput: "scrape result..." });
  assert.equal(isDelivered(r), true);
});

test("isDelivered: succeeded but empty / whitespace / null output is NOT delivered", () => {
  assert.equal(isDelivered(row({ latestStatus: "succeeded", latestOutput: "" })), false);
  assert.equal(isDelivered(row({ latestStatus: "succeeded", latestOutput: "   " })), false);
  assert.equal(isDelivered(row({ latestStatus: "succeeded", latestOutput: null })), false);
});

test("isDelivered: non-succeeded statuses are never delivered", () => {
  for (const s of ["pending", "running", "failed", "cancelled"]) {
    assert.equal(
      isDelivered(row({ latestStatus: s, latestOutput: "has output" })),
      false,
      `expected ${s} not to be delivered`,
    );
  }
});

test("markDelivered: returns a new object with delivered + dedupedFrom=0", () => {
  const r = row({ latestStatus: "succeeded", latestOutput: "ok" });
  const m = markDelivered(r);
  assert.equal(m.delivered, true);
  assert.equal(m.dedupedFrom, 0);
  // Original row not mutated.
  assert.equal((r as unknown as { delivered?: boolean }).delivered, undefined);
  // Other fields preserved.
  assert.equal(m.routineId, r.routineId);
  assert.equal(m.title, r.title);
});

test("dedupeNearby: empty array passes through", () => {
  assert.deepEqual(dedupeNearby([]), []);
});

test("dedupeNearby: singleton passes through unchanged", () => {
  const t = enriched({ title: "Scrape Marti IG" });
  const out = dedupeNearby([t]);
  assert.equal(out.length, 1);
  assert.equal(out[0].dedupedFrom, 0);
});

test("dedupeNearby: collapses same-title rows inside the window, keeps latest", () => {
  // Three rows, same title, all within 60 minutes of each other.
  // The 13:00 row should be kept (latest); the 12:30 and 12:00 rows
  // absorbed into it, dedupedFrom = 2.
  const t1 = enriched({
    routineId: "old",
    title: "Scrape Marti IG",
    createdAt: "2026-05-15T12:00:00.000Z",
  });
  const t2 = enriched({
    routineId: "mid",
    title: "Scrape Marti IG",
    createdAt: "2026-05-15T12:30:00.000Z",
  });
  const t3 = enriched({
    routineId: "new",
    title: "Scrape Marti IG",
    createdAt: "2026-05-15T13:00:00.000Z",
  });
  const out = dedupeNearby([t1, t2, t3], 60 * 60 * 1000);
  assert.equal(out.length, 1, "all three should collapse to one row");
  assert.equal(out[0].routineId, "new", "latest row wins");
  assert.equal(out[0].dedupedFrom, 2);
});

test("dedupeNearby: leaves rows outside the window alone", () => {
  // Same title, but two hours apart. With a 60-minute window they
  // are separate clusters.
  const t1 = enriched({
    routineId: "morning",
    title: "Scrape Marti IG",
    createdAt: "2026-05-15T10:00:00.000Z",
  });
  const t2 = enriched({
    routineId: "noon",
    title: "Scrape Marti IG",
    createdAt: "2026-05-15T12:30:00.000Z",
  });
  const out = dedupeNearby([t1, t2], 60 * 60 * 1000);
  assert.equal(out.length, 2);
  // Sorted latest-first.
  assert.equal(out[0].routineId, "noon");
  assert.equal(out[0].dedupedFrom, 0);
  assert.equal(out[1].routineId, "morning");
  assert.equal(out[1].dedupedFrom, 0);
});

test("dedupeNearby: case + whitespace insensitive on title", () => {
  const t1 = enriched({
    routineId: "a",
    title: "Scrape  Marti  IG",
    createdAt: "2026-05-15T12:00:00.000Z",
  });
  const t2 = enriched({
    routineId: "b",
    title: "scrape marti ig",
    createdAt: "2026-05-15T12:15:00.000Z",
  });
  const out = dedupeNearby([t1, t2], 60 * 60 * 1000);
  assert.equal(out.length, 1);
  assert.equal(out[0].routineId, "b");
  assert.equal(out[0].dedupedFrom, 1);
});

test("dedupeNearby: distinct titles never collapse", () => {
  const t1 = enriched({
    routineId: "a",
    title: "Scrape Marti IG",
    createdAt: "2026-05-15T12:00:00.000Z",
  });
  const t2 = enriched({
    routineId: "b",
    title: "Draft Marti email",
    createdAt: "2026-05-15T12:01:00.000Z",
  });
  const out = dedupeNearby([t1, t2], 60 * 60 * 1000);
  assert.equal(out.length, 2);
  for (const o of out) assert.equal(o.dedupedFrom, 0);
});

test("buildTaskResponse: integrates enrich + dedup + delivered flag", () => {
  const rows: TaskRow[] = [
    // Two near-dupes of a delivered scrape, the LATEST carries output.
    row({
      routineId: "scrape-old",
      title: "Scrape Marti IG",
      createdAt: "2026-05-15T12:00:00.000Z",
      latestStatus: "succeeded",
      latestOutput: "older scrape payload",
    }),
    row({
      routineId: "scrape-new",
      title: "Scrape Marti IG",
      createdAt: "2026-05-15T12:30:00.000Z",
      latestStatus: "succeeded",
      latestOutput: "fresh scrape payload",
    }),
    // A running task (not delivered, not collapsed).
    row({
      routineId: "draft",
      title: "Draft Marti email",
      createdAt: "2026-05-15T12:35:00.000Z",
      latestStatus: "running",
    }),
    // A succeeded task with no output - NOT delivered.
    row({
      routineId: "ping",
      title: "Ping Marti",
      createdAt: "2026-05-15T12:40:00.000Z",
      latestStatus: "succeeded",
      latestOutput: null,
    }),
  ];

  const out = buildTaskResponse(rows, 60 * 60 * 1000);

  // 4 rows -> 3 after the scrape dedup.
  assert.equal(out.length, 3);

  const byId = new Map(out.map((t) => [t.routineId, t]));

  const scrape = byId.get("scrape-new");
  assert.ok(scrape, "latest scrape row kept");
  assert.equal(scrape!.delivered, true);
  assert.equal(scrape!.dedupedFrom, 1);
  assert.ok(!byId.has("scrape-old"), "older scrape row absorbed");

  const draft = byId.get("draft");
  assert.ok(draft);
  assert.equal(draft!.delivered, false);
  assert.equal(draft!.dedupedFrom, 0);

  const ping = byId.get("ping");
  assert.ok(ping);
  assert.equal(
    ping!.delivered,
    false,
    "succeeded + null output is NOT delivered",
  );
});
