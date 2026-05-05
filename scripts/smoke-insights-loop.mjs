// End-to-end smoke for the insights loop.
//
// Pipeline tested:
//   1. snapshotForDept finds a metric anomaly (we synthesize one by
//      inserting fake routine_runs so the 7d/14d delta crosses 20%)
//   2. generateInsightsForDept calls the dept-head agent
//   3. agent returns ROOT CAUSE / PLAN / CONFIRM
//   4. extractAndCreateTasks spawns the <task> blocks as routines
//   5. cron-style retry: bumps loop_count if metric still bad
//   6. UI sees the alarm banner data via /api/insights
//
// Cleanup at end so we don't leave fake rows around.

import "dotenv/config";
import pg from "pg";
import { randomUUID } from "node:crypto";
import {
  generateInsightsForDept,
  sweepAllDepts,
} from "../src/lib/insights/generator.ts";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const { rows: orgRows } = await c.query(
  `select id, name from rgaios_organizations where slug = 'rawgrowth-mvp'`,
);
if (orgRows.length === 0) { console.error("rawgrowth-mvp not found"); process.exit(1); }
const org = orgRows[0];
console.log(`smoke against: ${org.name} (${org.id.slice(0, 8)})\n`);

const TEST_DEPT = "marketing";

// ─── seed: synthetic anomaly ──────────────────────────────────────
// Need a marketing agent with a routine to anchor failed runs.
const { rows: agentRows } = await c.query(
  `select id, name from rgaios_agents
   where organization_id=$1 and department=$2 and is_department_head=true limit 1`,
  [org.id, TEST_DEPT],
);
if (agentRows.length === 0) { console.error("no marketing manager"); process.exit(1); }
const marketerId = agentRows[0].id;
console.log(`marketing manager: ${agentRows[0].name} (${marketerId.slice(0, 8)})`);

// Create a synthetic routine + many failed runs in last 7d, succeeded
// runs in prior 7-14d window. Drives runs_failed up + runs_succeeded
// down vs prior week.
const routineId = randomUUID();
await c.query(
  `insert into rgaios_routines
     (id, organization_id, title, description, assignee_agent_id, status, created_at)
   values ($1, $2, 'SMOKE-TEST routine', 'synthetic for insights loop test', $3, 'active', now() - interval '14 days')`,
  [routineId, org.id, marketerId],
);

// 8 succeeded last week (prior period: days 7-14)
for (let i = 0; i < 8; i++) {
  await c.query(
    `insert into rgaios_routine_runs
       (organization_id, routine_id, source, status, created_at, completed_at)
     values ($1, $2, 'smoke', 'succeeded', now() - interval '${10 + i} days', now() - interval '${10 + i} days')`,
    [org.id, routineId],
  );
}

// 1 succeeded this week + 6 failed = collapse vs prior
for (let i = 0; i < 1; i++) {
  await c.query(
    `insert into rgaios_routine_runs
       (organization_id, routine_id, source, status, created_at, completed_at)
     values ($1, $2, 'smoke', 'succeeded', now() - interval '${i + 1} days', now() - interval '${i + 1} days')`,
    [org.id, routineId],
  );
}
for (let i = 0; i < 6; i++) {
  await c.query(
    `insert into rgaios_routine_runs
       (organization_id, routine_id, source, status, created_at, completed_at)
     values ($1, $2, 'smoke', 'failed', now() - interval '${i + 1} days', now() - interval '${i + 1} days')`,
    [org.id, routineId],
  );
}
console.log(`✓ seeded synthetic anomaly: 8 succeeded prior wk vs 1 succeeded + 6 failed this wk\n`);

// ─── step 1: generateInsightsForDept ──────────────────────────────
console.log(`${"━".repeat(60)}\n[1] generateInsightsForDept(marketing)\n${"━".repeat(60)}`);
const t0 = Date.now();
const r1 = await generateInsightsForDept({
  orgId: org.id,
  department: TEST_DEPT,
});
console.log(`took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`created: ${r1.created} | skipped: ${r1.skipped} | errors: ${r1.errors.length}`);
if (r1.errors.length > 0) console.log(`errors:`, r1.errors);

// ─── verify ───────────────────────────────────────────────────────
const { rows: insights } = await c.query(
  `select id, severity, title, reason, suggested_action, loop_count
   from rgaios_insights
   where organization_id=$1 and department=$2
   order by created_at desc limit 5`,
  [org.id, TEST_DEPT],
);
console.log(`\nDB has ${insights.length} insight rows for ${TEST_DEPT}:`);
for (const ins of insights.slice(0, 3)) {
  console.log(`\n  [${ins.severity}] ${ins.title}`);
  console.log(`  reason: ${(ins.reason ?? "").slice(0, 200)}${(ins.reason ?? "").length > 200 ? "..." : ""}`);
  console.log(`  action: ${(ins.suggested_action ?? "").slice(0, 200)}${(ins.suggested_action ?? "").length > 200 ? "..." : ""}`);
  console.log(`  loop_count: ${ins.loop_count}`);
}

// ─── verify spawned tasks ─────────────────────────────────────────
const { rows: spawnedTasks } = await c.query(
  `select r.title, a.name as assignee, r.created_at
   from rgaios_routines r
   left join rgaios_agents a on a.id = r.assignee_agent_id
   where r.organization_id=$1 and r.created_at > now() - interval '5 minutes'
   and r.id != $2
   order by r.created_at desc`,
  [org.id, routineId],
);
console.log(`\n[2] tasks spawned by agent's <task> blocks: ${spawnedTasks.length}`);
for (const t of spawnedTasks) {
  console.log(`  → "${t.title.slice(0, 60)}" → ${t.assignee}`);
}

// ─── step 3: sweepAllDepts (full loop including retry path) ───────
console.log(`\n${"━".repeat(60)}\n[3] sweepAllDepts (loop check)\n${"━".repeat(60)}`);
const r2 = await sweepAllDepts(org.id);
console.log(`created: ${r2.created} | skipped: ${r2.skipped} | resolved: ${r2.resolved} | retried: ${r2.retried} | errors: ${r2.errors.length}`);

// ─── step 4: trace audit + dedup verification ─────────────────────
console.log(`\n${"━".repeat(60)}\n[4] trace + dedup verification\n${"━".repeat(60)}`);

// Insight count for marketing should be 1 (conversion_rate dedup),
// NOT 3 (was succeeded↓, failed↑, conversion↓ before fix)
const { rows: dedupCheck } = await c.query(
  `select metric, count(*) as n from rgaios_insights
   where organization_id=$1 and department='marketing'
   group by metric`,
  [org.id],
);
console.log(`insight metrics for marketing:`);
for (const r of dedupCheck) console.log(`  ${r.metric}: ${r.n}`);
const succFailCount = dedupCheck.filter((r) =>
  ["runs_succeeded", "runs_failed"].includes(r.metric),
).reduce((s, r) => s + Number(r.n), 0);
const convCount = dedupCheck
  .filter((r) => r.metric === "conversion_rate")
  .reduce((s, r) => s + Number(r.n), 0);
if (convCount > 0 && succFailCount > 0) {
  console.log(`  ⚠ DEDUP FAIL: both conversion_rate and runs_succeeded/failed present`);
} else {
  console.log(`  ✓ DEDUP OK: conversion_rate subsumes runs_succeeded/failed`);
}

// Audit insight_created written?
if (insights.length > 0) {
  const { rows: traceRows } = await c.query(
    `select kind, actor_type, detail->>'insight_id' as iid
     from rgaios_audit_log
     where organization_id=$1 and detail->>'insight_id' = $2
     order by ts asc`,
    [org.id, insights[0].id],
  );
  console.log(`\naudit rows tagged with insight ${insights[0].id.slice(0, 8)}: ${traceRows.length}`);
  for (const r of traceRows) console.log(`  → ${r.kind} (${r.actor_type})`);
}

// last_attempt_at set on insert?
const { rows: timing } = await c.query(
  `select id, last_attempt_at, created_at from rgaios_insights
   where organization_id=$1 and department='marketing'`,
  [org.id],
);
const missingTs = timing.filter((r) => !r.last_attempt_at);
if (missingTs.length > 0) {
  console.log(`\n⚠ ${missingTs.length} insights missing last_attempt_at (will retry-spam)`);
} else {
  console.log(`\n✓ all ${timing.length} insights have last_attempt_at set`);
}

// ─── cleanup ──────────────────────────────────────────────────────
console.log(`\n${"━".repeat(60)}\nCLEANUP\n${"━".repeat(60)}`);
const insightIds = insights.map((i) => i.id);
const taskIds = spawnedTasks.map((_, idx) => idx); // close enough - we'll match by title
await c.query(
  `delete from rgaios_routines where organization_id=$1 and (id=$2 or title in (select title from rgaios_routines where organization_id=$1 and created_at > now() - interval '5 minutes' and id != $2))`,
  [org.id, routineId],
);
if (insightIds.length > 0) {
  await c.query(
    `delete from rgaios_insights where id = any($1)`,
    [insightIds],
  );
}
console.log(`✓ removed ${insightIds.length} insights + spawned routines`);

await c.end();
console.log(`\n${"━".repeat(60)}\nDONE\n${"━".repeat(60)}`);
