/* eslint-disable no-console */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

/**
 * Self-hosted migration runner.
 *
 * Applies every SQL file in supabase/migrations/ alphabetically, tracking
 * which ones have already been applied in rgaios_schema_migrations. Safe
 * to run on every container boot — already-applied files are skipped.
 *
 * Each migration is wrapped in a transaction; a failure rolls the whole
 * file back and halts startup, so the app never runs against a partial
 * schema.
 */

const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), "supabase/migrations");

const SELF_HOSTED = process.env.DEPLOY_MODE === "self_hosted";

/**
 * In self-hosted mode we ship our own Postgres + PostgREST. PostgREST needs
 * `service_role` and `anon` roles to switch into based on JWT claims; vanilla
 * Postgres doesn't have these. Create them idempotently before any app
 * migrations run, and grant them what they need to drive every rgaios_* table.
 */
async function bootstrapSelfHostedRoles(client: Client) {
  await client.query(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin bypassrls;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticator') then
        -- Reserved name used by PostgREST internals; harmless if unused.
        create role authenticator noinherit login password null;
      end if;

      grant anon, service_role to authenticator;
      grant usage on schema public to anon, service_role;
      grant all privileges on all tables in schema public to service_role;
      grant all privileges on all sequences in schema public to service_role;
      grant all privileges on all functions in schema public to service_role;

      alter default privileges in schema public
        grant all on tables to service_role;
      alter default privileges in schema public
        grant all on sequences to service_role;
      alter default privileges in schema public
        grant all on functions to service_role;
    end $$;
  `);
}

async function reloadPostgrestSchema(client: Client) {
  // PostgREST listens on this channel and rebuilds its schema cache.
  await client.query(`notify pgrst, 'reload schema'`);
}

/**
 * Hard invariant for self-hosted Rawclaw: one VPS holds exactly ONE org.
 * Belt-and-suspenders — the seed + UI already produce a single-org state,
 * but this trigger makes it impossible to corrupt even via direct SQL.
 * Not applied to hosted Supabase (where multi-org is the whole point).
 */
async function enforceSingleOrg(client: Client) {
  await client.query(`
    create or replace function rgaios_enforce_single_org() returns trigger
    language plpgsql as $$
    begin
      if (select count(*) from rgaios_organizations) > 1 then
        raise exception
          'Self-hosted Rawclaw supports exactly one organization per VPS. Provision a new VPS for additional clients.';
      end if;
      return new;
    end;
    $$;

    drop trigger if exists rgaios_single_org_guard on rgaios_organizations;
    create trigger rgaios_single_org_guard
    after insert on rgaios_organizations
    for each row execute function rgaios_enforce_single_org();
  `);
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("[migrate] DATABASE_URL is required");
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();
  console.log("[migrate] connected");

  if (SELF_HOSTED) {
    console.log("[migrate] bootstrapping self-hosted Postgres roles");
    await bootstrapSelfHostedRoles(client);
    console.log("[migrate] enforcing single-org invariant");
    await enforceSingleOrg(client);
  }

  await client.query(`
    create table if not exists rgaios_schema_migrations (
      filename   text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const { rows } = await client.query<{ filename: string }>(
    `select filename from rgaios_schema_migrations`,
  );
  const applied = new Set(rows.map((r) => r.filename));

  const entries = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let appliedCount = 0;
  for (const file of entries) {
    if (applied.has(file)) continue;
    const full = path.join(MIGRATIONS_DIR, file);
    const sql = await readFile(full, "utf8");
    console.log(`[migrate] applying ${file}`);
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(
        `insert into rgaios_schema_migrations(filename) values ($1)`,
        [file],
      );
      await client.query("commit");
      appliedCount += 1;
    } catch (err) {
      await client.query("rollback").catch(() => {});
      console.error(`[migrate] FAILED ${file}:`, (err as Error).message);
      process.exit(1);
    }
  }

  if (appliedCount === 0) {
    console.log("[migrate] schema up to date");
  } else {
    console.log(`[migrate] applied ${appliedCount} migration(s)`);
    if (SELF_HOSTED) {
      // Re-grant on any newly created tables/sequences and refresh PostgREST.
      await bootstrapSelfHostedRoles(client);
      await reloadPostgrestSchema(client);
      console.log("[migrate] PostgREST schema reloaded");
    }
  }

  await client.end();
}

main().catch((err) => {
  console.error("[migrate] fatal:", err);
  process.exit(1);
});
