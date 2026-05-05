// Backfill Atlas (CEO) agent for orgs that pre-date the P1 #10 plan.
// Without Atlas, /api/cron/atlas-coordinate skips the org and Pedro's
// "tem que ser proativo" rule never lights up the bell there.
import "dotenv/config";
import pg from "pg";
import { randomUUID } from "node:crypto";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

// Orgs without an Atlas (CEO) agent.
const { rows: orgsMissing } = await c.query(`
  select o.id, o.name
    from rgaios_organizations o
    left join rgaios_agents a
      on a.organization_id = o.id and a.role = 'ceo'
   where a.id is null
   order by o.created_at desc
`);

console.log(`Orgs missing Atlas: ${orgsMissing.length}`);

let inserted = 0;
for (const o of orgsMissing) {
  const id = randomUUID();
  await c.query(
    `insert into rgaios_agents
       (id, organization_id, name, title, role, description, runtime,
        department, is_department_head, reports_to, created_at)
     values ($1, $2, 'Atlas', 'Chief AI Coordinator', 'ceo',
             'Routes work between department heads, synthesizes cross-department briefs, escalates to the human owner only when policy demands it.',
             'claude-sonnet-4-6',
             null, false, null, now())`,
    [id, o.id],
  );
  inserted++;
  console.log(`  ✓ Atlas seeded for ${o.name}`);
}

console.log(`\nInserted ${inserted} Atlas agents`);
await c.end();
