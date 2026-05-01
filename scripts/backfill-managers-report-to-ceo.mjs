// Backfill: any dept-head agent with reports_to=null gets pointed to its
// org's CEO (Atlas). Idempotent. Run once per cloud DB after deploying the
// seed-fix.
import "dotenv/config";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL missing"); process.exit(1); }

const client = new pg.Client({ connectionString: url });
await client.connect();

const { rows } = await client.query(`
  with ceos as (
    select organization_id, id as ceo_id
    from rgaios_agents
    where role = 'ceo' and reports_to is null
  )
  update rgaios_agents a
     set reports_to = c.ceo_id
    from ceos c
   where a.organization_id = c.organization_id
     and a.is_department_head = true
     and a.reports_to is null
     and a.id <> c.ceo_id
  returning a.organization_id, a.id, a.name
`);

console.log(`backfilled ${rows.length} dept heads ->`);
for (const r of rows) console.log(`  ${r.name} (${r.id})`);
await client.end();
