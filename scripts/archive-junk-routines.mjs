// One-off: archive agent-runaway junk routines in Marti's org.
//
// Pedro approved (2026-05-14): archive ONLY the narrow-pattern set -
// "Autonomous heartbeat:", "Hard-close ... Atlas ... tasks", "Close all
// duplicate Atlas ...", "Gate all new task creation", plus the older
// copies of any exact-duplicate title. Reversible: sets status =
// 'archived', never DELETE.
//
// Run it yourself (the harness blocks the assistant from writing to the
// shared production DB):  node scripts/archive-junk-routines.mjs
// Revert:  set status='active' on the ids it prints.

import { readFileSync } from "node:fs";
import pg from "pg";

const ORG = "7154f299-af35-4b14-9e42-ff9f41319694"; // Marti / InstaCEO Academy

const envText = readFileSync(new URL("../.env", import.meta.url), "utf8");
const url = envText
  .split("\n")
  .find((l) => l.startsWith("DATABASE_URL="))
  .slice("DATABASE_URL=".length)
  .trim()
  .replace(/^["']|["']$/g, "");

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const all = await c.query(
  `SELECT id, title, created_at FROM rgaios_routines
   WHERE organization_id = $1 AND status = 'active'
   ORDER BY created_at`,
  [ORG],
);

const patterns = [
  /^Autonomous heartbeat:/i,
  /hard-close.*atlas/i,
  /^close all duplicate atlas/i,
  /^gate all new task creation/i,
];
const byPattern = all.rows.filter((r) => patterns.some((p) => p.test(r.title)));

const groups = new Map();
for (const r of all.rows) {
  if (!groups.has(r.title)) groups.set(r.title, []);
  groups.get(r.title).push(r);
}
const byDup = [];
for (const [, rows] of groups) {
  if (rows.length < 2) continue;
  rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  byDup.push(...rows.slice(1)); // keep newest, archive older copies
}

const set = new Map();
for (const r of [...byPattern, ...byDup]) set.set(r.id, r);
const ids = [...set.keys()];

console.log(`Active routines in org: ${all.rows.length}`);
console.log(`To archive: ${ids.length} (${byPattern.length} pattern + ${byDup.length} dup-copies)`);
for (const r of set.values()) console.log(`  - ${r.title}`);

if (ids.length === 0) {
  console.log("Nothing to archive.");
  await c.end();
  process.exit(0);
}

const res = await c.query(
  `UPDATE rgaios_routines SET status = 'archived', updated_at = now()
   WHERE id = ANY($1::uuid[]) AND organization_id = $2 AND status = 'active'
   RETURNING id`,
  [ids, ORG],
);
console.log(`\nARCHIVED ${res.rowCount} routines.`);

const remain = await c.query(
  `SELECT count(*)::int n FROM rgaios_routines
   WHERE organization_id = $1 AND status = 'active'`,
  [ORG],
);
console.log(`Still active: ${remain.rows[0].n}`);
console.log(`Revert: UPDATE rgaios_routines SET status='active' WHERE id IN (${ids.map((i) => `'${i}'`).join(",")});`);

await c.end();
