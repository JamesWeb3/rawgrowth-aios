// Backfill: any org with default-seeded agents (heads in marketing /
// sales / fulfilment / finance) gets its corresponding pillar flag
// flipped on. Idempotent.
import "dotenv/config";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL missing"); process.exit(1); }

const client = new pg.Client({ connectionString: url });
await client.connect();

const { rows } = await client.query(`
  with seeded as (
    select organization_id,
           bool_or(department = 'marketing') as has_mktg,
           bool_or(department = 'sales') as has_sales,
           bool_or(department = 'fulfilment') as has_fulfilment,
           bool_or(department = 'finance') as has_finance
    from rgaios_agents
    where is_department_head = true
    group by organization_id
  )
  update rgaios_organizations o
     set marketing = coalesce(s.has_mktg, false) or o.marketing,
         sales = coalesce(s.has_sales, false) or o.sales,
         fulfilment = coalesce(s.has_fulfilment, false) or o.fulfilment,
         finance = coalesce(s.has_finance, false) or o.finance
    from seeded s
   where o.id = s.organization_id
     and (
       (coalesce(s.has_mktg, false) and not o.marketing) or
       (coalesce(s.has_sales, false) and not o.sales) or
       (coalesce(s.has_fulfilment, false) and not o.fulfilment) or
       (coalesce(s.has_finance, false) and not o.finance)
     )
  returning o.id, o.slug
`);

console.log(`backfilled ${rows.length} orgs`);
for (const r of rows) console.log(`  ${r.slug} (${r.id})`);
await client.end();
