import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";

// Pin the no-op contract for migration 0075. The 2026-05-17 disaster
// showed that 0075 cannot create the fact_prefix / scope_key generated
// columns or the uq_rgaios_shared_memory_dedup_active partial unique
// index under postgres:16 - the IMMUTABLE check rejects every shape
// we tried. The shipped hotfix 4 turned 0075 into DROP IFs only.
// HOTFIX 2 OPTION B (a future 0076 with an IMMUTABLE plpgsql wrapper)
// will re-attempt the index. These assertions FAIL LOUD if a later
// edit silently re-introduces the bad columns/index in 0075.

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  throw new Error("DATABASE_URL required for tests/migrations/*.spec.ts");
}

async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

test("0075 no-op: rgaios_shared_memory.fact_prefix column is absent", async () => {
  await withClient(async (client) => {
    const { rows } = await client.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public'
          and table_name = 'rgaios_shared_memory'
          and column_name = 'fact_prefix'`,
    );
    assert.equal(
      rows.length,
      0,
      "fact_prefix column must not exist - 0075 is no-op until 0076 ships an IMMUTABLE wrapper",
    );
  });
});

test("0075 no-op: rgaios_shared_memory.scope_key column is absent", async () => {
  await withClient(async (client) => {
    const { rows } = await client.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public'
          and table_name = 'rgaios_shared_memory'
          and column_name = 'scope_key'`,
    );
    assert.equal(
      rows.length,
      0,
      "scope_key column must not exist - 0075 is no-op until 0076 ships an IMMUTABLE wrapper",
    );
  });
});

test("0075 no-op: uq_rgaios_shared_memory_dedup_active index is absent", async () => {
  await withClient(async (client) => {
    const { rows } = await client.query<{ indexname: string }>(
      `select indexname from pg_indexes
        where schemaname = 'public'
          and indexname = 'uq_rgaios_shared_memory_dedup_active'`,
    );
    assert.equal(
      rows.length,
      0,
      "uq_rgaios_shared_memory_dedup_active must not exist - the index is the IMMUTABLE-blocked surface",
    );
  });
});

test("0075 is recorded in rgaios_schema_migrations (the file applied even if it is a no-op)", async () => {
  await withClient(async (client) => {
    const { rows } = await client.query<{ filename: string }>(
      `select filename from rgaios_schema_migrations
        where filename = '0075_shared_memory_dedup_index.sql'`,
    );
    assert.equal(rows.length, 1, "0075 should be recorded exactly once in rgaios_schema_migrations");
  });
});
