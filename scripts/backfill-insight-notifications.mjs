// Backfill agent_chat_messages with proactive_anomaly rows for any
// insight that doesn't have one yet. Pedro's request 2026-05-05 -
// existing insights from prior generator versions weren't surfacing in
// the bell.
import "dotenv/config";
import pg from "pg";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const { rows } = await c.query(`
  select i.id, i.organization_id, i.title, i.reason, i.severity,
         i.generated_by_agent_id, i.department, i.kind, i.created_at
    from rgaios_insights i
    left join rgaios_agent_chat_messages m
      on m.metadata->>'insight_id' = i.id::text
   where m.id is null
     and i.status != 'dismissed'
     and i.generated_by_agent_id is not null
   order by i.created_at desc
   limit 500
`);

console.log(`Backfilling ${rows.length} insight notifications...`);

let written = 0;
for (const i of rows) {
  const reason = (i.reason ?? "").slice(0, 300);
  const more = (i.reason ?? "").length > 300 ? "..." : "";
  const ack = i.kind === "anomaly" ? "approval needed" : "FYI";
  const content =
    `Heads up - I just flagged a ${i.severity} anomaly: ${i.title}.\n\n` +
    `Reason: ${reason}${more}\n\n` +
    `Drafted plan + ${ack} in Updates. Open it via the sidebar or hit me here if you want to debate the angle.`;
  await c.query(
    `insert into rgaios_agent_chat_messages
       (organization_id, agent_id, user_id, role, content, metadata, created_at)
     values ($1, $2, null, 'assistant', $3, $4, $5)`,
    [
      i.organization_id,
      i.generated_by_agent_id,
      content,
      JSON.stringify({
        kind: "proactive_anomaly",
        insight_id: i.id,
        department: i.department,
        backfilled: true,
      }),
      i.created_at,
    ],
  );
  written++;
}

console.log(`Wrote ${written} notification rows`);
await c.end();
