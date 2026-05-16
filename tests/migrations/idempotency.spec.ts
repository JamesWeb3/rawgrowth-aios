import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

// Structural integrity of the migration tracker after a full apply.
// The ci.yml `migrations` job runs scripts/migrate.ts twice before
// this spec executes; we assert here that every .sql file in
// supabase/migrations/ landed exactly once in rgaios_schema_migrations
// with no duplicates and no gaps. Catches: a migration that silently
// no-ops in CI but not in prod, a duplicate insert path that would
// mask half-applied state, and the schema_migrations table itself
// drifting from disk.

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  throw new Error("DATABASE_URL required for tests/migrations/*.spec.ts");
}

const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");

async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

test("rgaios_schema_migrations records every .sql file in supabase/migrations", async () => {
  const onDisk = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  assert.ok(onDisk.length > 0, "supabase/migrations must contain at least one .sql file");

  await withClient(async (client) => {
    const { rows } = await client.query<{ filename: string }>(
      `select filename from rgaios_schema_migrations order by filename`,
    );
    const inDb = rows.map((r) => r.filename).sort();

    const missing = onDisk.filter((f) => !inDb.includes(f));
    const extra = inDb.filter((f) => !onDisk.includes(f));
    assert.deepEqual(
      missing,
      [],
      `migrations on disk but not applied: ${missing.join(", ")}`,
    );
    assert.deepEqual(
      extra,
      [],
      `migrations recorded but not on disk: ${extra.join(", ")}`,
    );
  });
});

test("rgaios_schema_migrations has no duplicate filenames after two applies", async () => {
  await withClient(async (client) => {
    const { rows } = await client.query<{ filename: string; count: string }>(
      `select filename, count(*)::text as count
         from rgaios_schema_migrations
        group by filename
       having count(*) > 1`,
    );
    assert.deepEqual(
      rows.map((r) => `${r.filename} x${r.count}`),
      [],
      "duplicate rows in rgaios_schema_migrations - the insert-on-conflict guard is broken",
    );
  });
});

test("rgaios_schema_migrations.filename is a primary key (idempotency contract)", async () => {
  await withClient(async (client) => {
    const { rows } = await client.query<{ constraint_type: string; column_name: string }>(
      `select tc.constraint_type, kcu.column_name
         from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu
           on tc.constraint_name = kcu.constraint_name
        where tc.table_schema = 'public'
          and tc.table_name = 'rgaios_schema_migrations'
          and tc.constraint_type = 'PRIMARY KEY'`,
    );
    assert.equal(rows.length, 1, "rgaios_schema_migrations should have exactly one PK");
    assert.equal(rows[0]?.column_name, "filename", "PK column must be filename");
  });
});
