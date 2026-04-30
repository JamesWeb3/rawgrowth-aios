/**
 * Reset + re-seed agents for an org. Wipes every agent row + chunks +
 * files + chat history + per-agent telegram bots, then runs
 * seedDefaultAgentsForOrg which now auto-trains each default agent
 * (CEO Atlas + 5 dept heads + 8 subs + starter MDs + system prompts).
 *
 * Usage: tsx scripts/reset-org-agents.ts <org-slug-or-email>
 *
 * Defaults to pedro@local when no arg passed.
 */

import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env" });

import { Client } from "pg";

import { seedDefaultAgentsForOrg } from "@/lib/agents/seed";

async function main() {
  const arg = process.argv[2] ?? "pedro@local";
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");

  const pg = new Client({ connectionString: url });
  await pg.connect();

  let orgId: string | null = null;
  if (arg.includes("@")) {
    const r = await pg.query(
      "select organization_id from rgaios_users where email = $1 limit 1",
      [arg],
    );
    orgId = r.rows[0]?.organization_id ?? null;
  } else {
    const r = await pg.query(
      "select id from rgaios_organizations where slug = $1 limit 1",
      [arg],
    );
    orgId = r.rows[0]?.id ?? null;
  }
  if (!orgId) {
    console.error(`org not found for: ${arg}`);
    process.exit(1);
  }
  console.log(`[reset] target org_id = ${orgId}`);

  const before = await pg.query(
    "select count(*)::int as n from rgaios_agents where organization_id = $1",
    [orgId],
  );
  console.log(`[reset] agents before = ${before.rows[0].n}`);

  await pg.query("delete from rgaios_agent_file_chunks where organization_id = $1", [orgId]);
  await pg.query("delete from rgaios_agent_files where organization_id = $1", [orgId]);
  await pg.query("delete from rgaios_agent_skills where organization_id = $1", [orgId]);
  try {
    await pg.query("delete from rgaios_agent_chat_messages where organization_id = $1", [orgId]);
  } catch {
    // table may not exist on older deploys
  }
  try {
    await pg.query("delete from rgaios_agent_telegram_bots where organization_id = $1", [orgId]);
  } catch {
    // older schema
  }
  await pg.query("delete from rgaios_agents where organization_id = $1", [orgId]);

  console.log("[reset] wiped agent + dependents");
  await pg.end();

  console.log("[reset] re-seeding default agents (CEO + 5 dept heads + 8 subs)");
  const result = await seedDefaultAgentsForOrg(orgId);
  console.log("[reset] done", result);
}

main().catch((err) => {
  console.error("[reset] fatal:", err);
  process.exit(1);
});
