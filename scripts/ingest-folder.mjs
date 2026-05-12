#!/usr/bin/env node
/**
 * ingest-folder.mjs — bulk content ingest for a Rawclaw v3 client.
 *
 * Loads markdown (and plain text) files from a folder into the right
 * tables for a given organization, generating fastembed embeddings so
 * the agents' `company_query` / `knowledge_query` MCP tools can pull
 * the content via RAG on the next chat turn.
 *
 * Three modes — pick one per invocation:
 *
 *   1. Workspace files (visible to every agent):
 *      node /app/scripts/ingest-folder.mjs \
 *        --org <ORG_ID> --folder <PATH> --bucket <one of: brand,content,
 *        marketing,sales,fulfilment,finance,customer,other>
 *
 *   2. Per-agent files (visible only to that agent):
 *      node /app/scripts/ingest-folder.mjs \
 *        --org <ORG_ID> --folder <PATH> --agent <AGENT_ID>
 *
 *   3. Brand profile rewrite (replaces active brand voice, bumps version):
 *      node /app/scripts/ingest-folder.mjs \
 *        --org <ORG_ID> --file <PATH-TO-SINGLE-MD> --brand-profile
 *
 * Run from inside the rawclaw-app-1 container so node_modules resolves:
 *   docker exec rawclaw-app-1 node /app/scripts/ingest-folder.mjs ...
 *
 * Idempotency: file-row insert is best-effort (no name uniqueness
 * constraint); duplicate filenames will create duplicate rows. Brand
 * profile mode always bumps to MAX(version)+1.
 */

import { Client } from "pg";
import fs from "node:fs";
import path from "node:path";
import { EmbeddingModel, FlagEmbedding } from "fastembed";

const ALLOWED_BUCKETS = [
  "brand",
  "content",
  "marketing",
  "sales",
  "fulfilment",
  "finance",
  "customer",
  "other",
];

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[k] = true;
      } else {
        args[k] = next;
        i += 1;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function chunkText(text, max = 1500) {
  const paras = text.split(/\n\n+/);
  const out = [];
  let cur = "";
  for (const p of paras) {
    if ((cur + "\n\n" + p).length > max) {
      if (cur) out.push(cur);
      cur = p;
    } else {
      cur = cur ? cur + "\n\n" + p : p;
    }
  }
  if (cur) out.push(cur);
  return out.filter((c) => c.trim().length > 10);
}

function vecLiteral(arr) {
  return "[" + arr.map((n) => n.toFixed(6)).join(",") + "]";
}

function listFiles(folder) {
  const out = [];
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    if (!/\.(md|markdown|txt|mdx|yaml|yml)$/i.test(entry.name)) continue;
    out.push(path.join(folder, entry.name));
  }
  return out.sort();
}

function bail(msg) {
  console.error(`ingest-folder: ${msg}`);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ORG = args.org;
  const folder = args.folder;
  const singleFile = args.file;
  const bucket = args.bucket;
  const agentId = args.agent;
  const brandProfile = Boolean(args["brand-profile"]);
  const approvedBy = args["approved-by"] ?? "ingest-folder";
  const dryRun = Boolean(args["dry-run"]);

  if (!ORG) bail("--org <ORG_ID> required");
  if (!process.env.DATABASE_URL) bail("DATABASE_URL not set in env");
  if (brandProfile && !singleFile) bail("--brand-profile needs --file <path-to-md>");
  if (!brandProfile && !folder) bail("--folder <path> required (or --file with --brand-profile)");
  if (!brandProfile && !bucket && !agentId) {
    bail("must pass either --bucket <name> or --agent <ID> (workspace vs per-agent)");
  }
  if (!brandProfile && bucket && agentId) {
    bail("--bucket and --agent are mutually exclusive");
  }
  if (bucket && !ALLOWED_BUCKETS.includes(bucket)) {
    bail(`--bucket must be one of: ${ALLOWED_BUCKETS.join(", ")}`);
  }

  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  // Verify the org exists. Surfaces a friendly error before fastembed cold-start.
  const orgRow = (
    await c.query(`SELECT id, name FROM rgaios_organizations WHERE id = $1`, [ORG])
  ).rows[0];
  if (!orgRow) bail(`org ${ORG} not found`);
  console.log(`org: ${orgRow.name} (${ORG})`);

  if (agentId) {
    const ag = (
      await c.query(
        `SELECT id, name FROM rgaios_agents WHERE id = $1 AND organization_id = $2`,
        [agentId, ORG],
      )
    ).rows[0];
    if (!ag) bail(`agent ${agentId} not found in org ${ORG}`);
    console.log(`agent: ${ag.name} (${agentId})`);
  }

  console.log("init fastembed (cold start ~5s)...");
  const embedder = await FlagEmbedding.init({
    model: EmbeddingModel.BGESmallENV15,
    cacheDir: process.env.FASTEMBED_CACHE_DIR ?? "/tmp/fastembed-cache",
    showDownloadProgress: false,
  });

  async function embed(textIn) {
    const it = embedder.embed([textIn], 1);
    for await (const batch of it) {
      const v = batch[0];
      const padded = new Array(1536).fill(0);
      for (let i = 0; i < v.length && i < 1536; i++) padded[i] = v[i];
      return vecLiteral(padded);
    }
    return vecLiteral(new Array(1536).fill(0));
  }

  // ── Brand profile mode ─────────────────────────────────────
  if (brandProfile) {
    const content = fs.readFileSync(singleFile, "utf8");
    if (dryRun) {
      console.log(`[dry-run] would replace brand profile with ${singleFile} (${content.length} chars)`);
      await c.end();
      return;
    }
    const nextVer = (
      await c.query(
        `SELECT COALESCE(MAX(version), 0) + 1 AS v FROM rgaios_brand_profiles WHERE organization_id = $1`,
        [ORG],
      )
    ).rows[0].v;
    await c.query(
      `INSERT INTO rgaios_brand_profiles
         (organization_id, version, content, status, generated_at, approved_at, approved_by)
       VALUES ($1, $2, $3, 'approved', $4, $4, $5)`,
      [ORG, nextVer, content, Date.now(), approvedBy],
    );
    console.log(`brand profile v${nextVer} inserted (status=approved, by=${approvedBy})`);
    await c.end();
    return;
  }

  // ── File ingest (workspace or per-agent) ────────────────────
  const files = listFiles(folder);
  if (files.length === 0) {
    console.warn(`no .md/.txt/.yaml files in ${folder}`);
    await c.end();
    return;
  }
  console.log(`found ${files.length} file(s) in ${folder}`);

  let filesInserted = 0;
  let chunksInserted = 0;

  for (const fp of files) {
    const filename = path.basename(fp);
    const title = path.basename(fp, path.extname(fp));
    const content = fs.readFileSync(fp, "utf8");
    const size = Buffer.byteLength(content, "utf8");

    if (dryRun) {
      console.log(`  [dry-run] ${filename} (${size} bytes, ${chunkText(content).length} chunks)`);
      continue;
    }

    let fileId;
    if (bucket) {
      const storagePath = `${ORG}/knowledge/${filename}`;
      const r = await c.query(
        `INSERT INTO rgaios_knowledge_files
           (organization_id, title, storage_path, mime_type, size_bytes, bucket)
         VALUES ($1, $2, $3, 'text/markdown', $4, $5)
         RETURNING id`,
        [ORG, title, storagePath, size, bucket],
      );
      fileId = r.rows[0].id;
    } else {
      const storagePath = `${ORG}/agent/${agentId}/${filename}`;
      const r = await c.query(
        `INSERT INTO rgaios_agent_files
           (organization_id, agent_id, filename, storage_path, mime_type, size_bytes)
         VALUES ($1, $2, $3, $4, 'text/markdown', $5)
         RETURNING id`,
        [ORG, agentId, filename, storagePath, size],
      );
      fileId = r.rows[0].id;
    }

    const chunks = chunkText(content);
    for (let i = 0; i < chunks.length; i++) {
      const v = await embed(chunks[i]);
      const tokenEst = Math.ceil(chunks[i].length / 4);
      if (bucket) {
        await c.query(
          `INSERT INTO rgaios_company_chunks
             (organization_id, source, source_id, chunk_index, content, token_count, embedding, metadata)
           VALUES ($1, 'knowledge_files', $2, $3, $4, $5, $6::vector, $7::jsonb)`,
          [
            ORG,
            fileId,
            i,
            chunks[i],
            tokenEst,
            v,
            JSON.stringify({ title, bucket }),
          ],
        );
      } else {
        await c.query(
          `INSERT INTO rgaios_agent_file_chunks
             (file_id, organization_id, agent_id, chunk_index, content, token_count, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7::vector)`,
          [fileId, ORG, agentId, i, chunks[i], tokenEst, v],
        );
      }
      chunksInserted += 1;
    }
    filesInserted += 1;
    console.log(`  ${filename} (${chunks.length} chunks)`);
  }

  console.log("=== summary ===");
  console.log(`  files inserted: ${filesInserted}`);
  console.log(`  chunks inserted: ${chunksInserted}`);
  console.log(`  bucket: ${bucket ?? "n/a"}`);
  console.log(`  agent: ${agentId ?? "n/a"}`);
  await c.end();
  console.log("DONE");
}

main().catch((err) => {
  console.error("ingest-folder failed:", err.stack ?? err.message);
  process.exit(1);
});
