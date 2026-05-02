// Seed demo content for the test org (acme-coaching-76897):
// - approved brand profile (so /brand renders + agents have voice context)
// - 1 routine assigned to Marketing Manager (so /routines + agent Tasks tab populate)
// Idempotent.
import "dotenv/config";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL missing"); process.exit(1); }
const TARGET_SLUG = process.argv[2] ?? "acme-coaching-76897";

const c = new pg.Client({ connectionString: url });
await c.connect();

const { rows: orgRows } = await c.query(
  `select id, name from rgaios_organizations where slug = $1`,
  [TARGET_SLUG],
);
if (orgRows.length === 0) { console.error(`org ${TARGET_SLUG} not found`); process.exit(1); }
const org = orgRows[0];
console.log(`target: ${org.name} (${org.id})`);

// ── 1. Brand profile ──────────────────────────────────────────────────
const brandMarkdown = `# ${org.name} - Brand Profile

## What we sell
A 12-week coaching program that takes founders from $20k MRR to $100k MRR
through deliberate offer redesign + targeted distribution. Premium tier
($25k); core tier ($8k); group cohort ($1.5k).

## Voice & tone
Direct. Operator-grade. We assume the reader runs a real business and is
allergic to fluff. Sentences are short. Verbs are concrete. Numbers
beat adjectives. We avoid the standard SaaS cliche set (full list lives
in src/lib/brand/tokens.ts).

## Positioning
We are the place founders go when their growth has plateaued and they
want a single voice in their ear who has done the thing - not an agency,
not a course library, not a community. One coach, one playbook, one
quarter at a time.

## Ideal client
- $15k-150k MRR coaching / consulting / agency
- Solo or 2-3 person team
- Wants to reach $1M ARR within 18 months
- Sells outcomes, not deliverables

## Common objections
1. "I've tried programs before" → ours is 1:1, not group; we ship work
2. "Too expensive" → 1 added client/month at $1.5k pays it back in 6 weeks
3. "I don't have time" → 90 min/week, all assets templated

## Frameworks we run
- AIDA + PAS for cold outbound + ad hooks
- Bullseye Framework for channel selection
- ICE scoring on every experiment proposed
- 1-week sprint planning, 1-page brief per campaign
`;

const { rows: existingBrand } = await c.query(
  `select id from rgaios_brand_profiles where organization_id = $1 and status = 'approved' order by version desc limit 1`,
  [org.id],
);
if (existingBrand.length > 0) {
  console.log(`brand: already approved (id=${existingBrand[0].id}) - skipping`);
} else {
  const { rows } = await c.query(
    `insert into rgaios_brand_profiles
       (organization_id, version, content, status, generated_at, approved_at, approved_by)
     values
       ($1, 1, $2, 'approved', $3, $3, 'demo-seed')
     returning id`,
    [org.id, brandMarkdown, Date.now()],
  );
  console.log(`brand: inserted ${rows[0].id}`);
}

// ── 2. Routine assigned to Marketing Manager ─────────────────────────
const { rows: mktgRows } = await c.query(
  `select id, name from rgaios_agents where organization_id = $1 and department = 'marketing' and is_department_head = true limit 1`,
  [org.id],
);
if (mktgRows.length === 0) {
  console.warn("no marketing manager found - skipping routine");
} else {
  const mktg = mktgRows[0];
  // Check schema for rgaios_routines
  const { rows: cols } = await c.query(
    `select column_name from information_schema.columns where table_name = 'rgaios_routines'`,
  );
  const colNames = cols.map((r) => r.column_name);
  console.log(`routine columns: ${colNames.join(",")}`);

  const { rows: existing } = await c.query(
    `select id from rgaios_routines where organization_id = $1 and assignee_agent_id = $2 and title = $3`,
    [org.id, mktg.id, "Weekly Marketing Briefing"],
  );
  if (existing.length > 0) {
    console.log(`routine: already exists (id=${existing[0].id}) - skipping`);
  } else {
    // Insert with whatever columns exist
    const baseCols = ["organization_id", "title", "assignee_agent_id"];
    const baseVals = [org.id, "Weekly Marketing Briefing", mktg.id];
    if (colNames.includes("status")) {
      baseCols.push("status");
      baseVals.push("active");
    }
    if (colNames.includes("description")) {
      baseCols.push("description");
      baseVals.push("Every Monday 9am, summarize last week's marketing numbers (visitors, leads, MQLs, CAC) in 3 bullets.");
    }
    if (colNames.includes("trigger_type")) {
      baseCols.push("trigger_type");
      baseVals.push("schedule");
    }
    if (colNames.includes("trigger_config")) {
      baseCols.push("trigger_config");
      baseVals.push(JSON.stringify({ cron: "0 9 * * 1" }));
    }
    if (colNames.includes("schedule_cron")) {
      baseCols.push("schedule_cron");
      baseVals.push("0 9 * * 1");
    }
    if (colNames.includes("prompt")) {
      baseCols.push("prompt");
      baseVals.push("Summarize last week's marketing numbers (visitors, leads, MQLs, CAC) in 3 bullets. Compare to prior week. Flag any > 20% deltas.");
    }
    if (colNames.includes("active") || colNames.includes("enabled")) {
      baseCols.push(colNames.includes("active") ? "active" : "enabled");
      baseVals.push(true);
    }

    const placeholders = baseCols.map((_, i) => `$${i + 1}`).join(",");
    const sql = `insert into rgaios_routines (${baseCols.join(",")}) values (${placeholders}) returning id`;
    try {
      const { rows } = await c.query(sql, baseVals);
      console.log(`routine: inserted ${rows[0].id}`);
    } catch (e) {
      console.error(`routine insert failed: ${e.message}`);
    }
  }
}

await c.end();
console.log("done");
