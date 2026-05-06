// One-shot: read DATABASE_URL from .env, apply 0033 + 0034, mark them
// in rgaios_schema_migrations, NOTIFY pgrst to reload schema cache.
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

const files = [
  "0033_agent_telegram_bots.sql",
  "0034_telegram_messages_connection_nullable.sql",
  "0035_agent_chat_messages.sql",
  "0036_agent_system_prompt.sql",
  "0037_member_allowed_departments.sql",
  "0040_sales_calls.sql",
  "0042_v_company_corpus.sql",
  "0043_provisioning_queue.sql",
  "0044_kalendly.sql",
  "0046_mini_saas.sql",
  "0048_insights.sql",
  "0049_insights_loop.sql",
  "0050_insights_approve.sql",
  "0051_autonomous_mode.sql",
  "0052_shared_memory.sql",
  "0053_sales_call_insights.sql",
  "0054_files_bucket.sql",
  "0055_mini_saas_deploy.sql",
  "0056_sales_calls_fireflies.sql",
  "0057_insight_chat_queue.sql",
  "0058_insights_escalated_at.sql",
  "0059_custom_mcp_tools.sql",
  "0060_atlas_coordinate_dedup.sql",
  "0061_insight_sent_dedup.sql",
];

const client = new pg.Client({ connectionString: url });
await client.connect();
console.log("[mig] connected to", url.replace(/:[^:@]+@/, ":***@"));

// Make sure tracking table exists (it does on cloud since 0001 ran).
await client.query(`
  create table if not exists rgaios_schema_migrations (
    filename text primary key,
    applied_at timestamptz not null default now()
  );
`);

const { rows: applied } = await client.query(
  `select filename from rgaios_schema_migrations where filename = any($1::text[])`,
  [files],
);
const appliedSet = new Set(applied.map((r) => r.filename));

for (const f of files) {
  if (appliedSet.has(f)) {
    console.log(`[mig] skip ${f} (already applied)`);
    continue;
  }
  const sql = readFileSync(resolve(repo, "supabase/migrations", f), "utf8");
  console.log(`[mig] applying ${f}`);
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query(
      "insert into rgaios_schema_migrations(filename) values ($1) on conflict do nothing",
      [f],
    );
    await client.query("commit");
    console.log(`[mig] ✓ ${f}`);
  } catch (err) {
    await client.query("rollback").catch(() => {});
    console.error(`[mig] ✗ ${f}: ${err.message}`);
    process.exit(1);
  }
}

await client.query("notify pgrst, 'reload schema'");
console.log("[mig] notified PostgREST to reload schema cache");

const { rows: cols } = await client.query(`
  select column_name from information_schema.columns
  where table_name = 'rgaios_agents' and column_name = 'is_department_head'
`);
console.log(
  cols.length > 0
    ? "[mig] verified: rgaios_agents.is_department_head present"
    : "[mig] WARN: is_department_head still missing",
);

await client.end();
