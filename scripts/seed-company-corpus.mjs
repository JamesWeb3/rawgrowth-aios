// Backfill rgaios_company_chunks from the seeded brand profile so the
// company-corpus RAG (matchCompanyChunks) returns hits during chat.
// Uses fastembed for the 1536d vectors (no API key needed).
import "dotenv/config";
import pg from "pg";
import { FlagEmbedding, EmbeddingModel } from "fastembed";

const url = process.env.DATABASE_URL;
const ORG_SLUG = process.argv[2] ?? "acme-coaching-76897";

const c = new pg.Client({ connectionString: url });
await c.connect();
const { rows: orgRows } = await c.query(
  `select id, name from rgaios_organizations where slug = $1`,
  [ORG_SLUG],
);
if (orgRows.length === 0) { console.error(`org ${ORG_SLUG} not found`); process.exit(1); }
const org = orgRows[0];

const { rows: brandRows } = await c.query(
  `select id, content from rgaios_brand_profiles where organization_id = $1 and status = 'approved' order by version desc limit 1`,
  [org.id],
);
if (brandRows.length === 0) { console.error("no brand profile"); process.exit(1); }
const brand = brandRows[0];

// Already chunked?
const { rows: existing } = await c.query(
  `select count(*) from rgaios_company_chunks where organization_id = $1 and source = 'brand_profile'`,
  [org.id],
);
if (Number(existing[0].count) > 0) {
  console.log(`already ${existing[0].count} brand_profile chunks - skipping`);
  await c.end();
  process.exit(0);
}

// Chunk by markdown section (split on H2)
const sections = brand.content.split(/\n(?=## )/g).filter((s) => s.trim());
console.log(`chunking brand into ${sections.length} sections`);

const embedder = await FlagEmbedding.init({ model: EmbeddingModel.BGESmallEN });

let inserted = 0;
for (let i = 0; i < sections.length; i++) {
  const text = sections[i].trim();
  if (text.length < 30) continue;
  const embeddings = await embedder.embed([text], 1);
  const arr = (await embeddings.next()).value[0];
  // Pad 384d -> 1536d to match the schema's vector(1536)
  const padded = new Array(1536).fill(0);
  for (let j = 0; j < arr.length && j < 1536; j++) padded[j] = arr[j];
  const vec = `[${padded.join(",")}]`;
  await c.query(
    `insert into rgaios_company_chunks
       (organization_id, source, source_id, chunk_index, content, embedding, metadata)
     values ($1, 'brand_profile', $2, $3, $4, $5::vector, $6)`,
    [org.id, brand.id, i, text, vec, JSON.stringify({ kind: "brand_section" })],
  );
  inserted += 1;
}
console.log(`inserted ${inserted} brand_profile chunks`);
await c.end();
