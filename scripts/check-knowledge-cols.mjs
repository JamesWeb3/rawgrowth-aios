import "dotenv/config";
import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const { rows } = await c.query(
  `select column_name from information_schema.columns where table_name = 'rgaios_knowledge_files' order by ordinal_position`
);
console.log(rows.map(r => r.column_name).join(", "));
await c.end();
