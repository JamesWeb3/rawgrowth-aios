// One-shot: apply 0052_shared_memory.sql to the cloud DB and verify.
// Idempotent — safe to re-run.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const here = new URL(".", import.meta.url).pathname;
const repo = resolve(here, "..");
const env = readFileSync(resolve(repo, ".env"), "utf8")
  .split(/\r?\n/)
  .filter((l) => l && !l.startsWith("#"))
  .reduce((m, l) => {
    const i = l.indexOf("=");
    if (i > 0) m[l.slice(0, i)] = l.slice(i + 1);
    return m;
  }, {});

const url = env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing in .env");
  process.exit(1);
}

const file = "0052_shared_memory.sql";
const client = new pg.Client({ connectionString: url });
await client.connect();
console.log("[mig] connected to", url.replace(/:[^:@]+@/, ":***@"));

await client.query(`
  create table if not exists rgaios_schema_migrations (
    filename text primary key,
    applied_at timestamptz not null default now()
  );
`);

const { rows: applied } = await client.query(
  `select filename from rgaios_schema_migrations where filename = $1`,
  [file],
);

if (applied.length > 0) {
  console.log(`[mig] skip ${file} (already applied) - re-running idempotent SQL anyway`);
}

const sql = readFileSync(resolve(repo, "supabase/migrations", file), "utf8");
try {
  await client.query("begin");
  await client.query(sql);
  await client.query(
    "insert into rgaios_schema_migrations(filename) values ($1) on conflict do nothing",
    [file],
  );
  await client.query("commit");
  console.log(`[mig] applied ${file}`);
} catch (err) {
  await client.query("rollback").catch(() => {});
  console.error(`[mig] FAILED ${file}: ${err.message}`);
  process.exit(1);
}

await client.query("notify pgrst, 'reload schema'");

// Verify schema
const { rows: cols } = await client.query(`
  select column_name, data_type, is_nullable
  from information_schema.columns
  where table_name = 'rgaios_shared_memory'
  order by ordinal_position
`);
console.log("[verify] rgaios_shared_memory columns:");
for (const c of cols) {
  console.log(`  - ${c.column_name} (${c.data_type}, nullable=${c.is_nullable})`);
}

// Insert a sample row to verify schema. Pick the first existing org.
const { rows: orgs } = await client.query(
  `select id, name from rgaios_organizations limit 1`,
);
if (orgs.length === 0) {
  console.log("[sample] no orgs in DB; skipping insert");
} else {
  const orgId = orgs[0].id;
  const sampleFact = "Sample shared memory: client uses Shopify (not WooCommerce). Inserted by 0052 migration verification.";
  // Cleanup any prior sample first so re-runs are clean
  await client.query(
    `delete from rgaios_shared_memory where organization_id = $1 and fact = $2`,
    [orgId, sampleFact],
  );
  const { rows: inserted } = await client.query(
    `insert into rgaios_shared_memory
      (organization_id, fact, importance, scope)
      values ($1, $2, 4, '{}')
      returning id, organization_id, fact, importance, scope, created_at`,
    [orgId, sampleFact],
  );
  console.log(`[sample] inserted into org "${orgs[0].name}":`);
  console.log("  id        :", inserted[0].id);
  console.log("  fact      :", inserted[0].fact);
  console.log("  importance:", inserted[0].importance);
  console.log("  scope     :", JSON.stringify(inserted[0].scope));
  console.log("  created_at:", inserted[0].created_at.toISOString());
}

await client.end();
console.log("[mig] done");
