// Usage:
//   node scripts/audit-chat-secrets.mjs           # dry-run, report only
//   node scripts/audit-chat-secrets.mjs --purge   # delete matching rows
//
// Scans `rgaios_agent_chat_messages` + `rgaios_company_chunks` for leaked
// secrets (API keys, bearer tokens, SSH credentials, PEM private keys,
// password fields). Emits findings as a JSON array to stdout. Idempotent:
// re-running after a --purge should yield `[]`.

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

export const SECRET_PATTERNS = [
  {
    name: "api_key:sk",
    regex: /\bsk[-_][A-Za-z0-9_\-]{16,}\b/g,
  },
  {
    name: "api_key:ak",
    regex: /\bak[-_][A-Za-z0-9_\-]{16,}\b/g,
  },
  {
    name: "api_key:pk",
    regex: /\bpk[-_][A-Za-z0-9_\-]{16,}\b/g,
  },
  {
    name: "api_key:ck",
    regex: /\bck[-_][A-Za-z0-9_\-]{16,}\b/g,
  },
  {
    name: "api_key:ghp",
    regex: /\bghp_[A-Za-z0-9]{20,}\b/g,
  },
  {
    name: "api_key:aws_akia",
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    name: "bearer_token",
    regex: /\bBearer\s+[A-Za-z0-9._\-]{16,}\b/gi,
  },
  {
    name: "password_field",
    regex: /\b(?:password|passwd|pwd)\s*[:=]\s*\S{6,}/gi,
  },
  {
    name: "pem_private_key",
    regex:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/g,
  },
  {
    name: "ssh_root_password",
    regex:
      /root@\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}[\s\S]{0,80}?(?:password|passwd|pwd)\s*[:=]?\s*\S{4,}/gi,
  },
];

const PURGE = process.argv.includes("--purge");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  process.stderr.write(
    "missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY\n",
  );
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function scan(text) {
  if (!text || typeof text !== "string") return { kinds: [], fragments: [] };
  const kinds = new Set();
  const fragments = [];
  for (const { name, regex } of SECRET_PATTERNS) {
    regex.lastIndex = 0;
    const re = new RegExp(regex.source, regex.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      kinds.add(name);
      fragments.push(m[0].slice(0, 16));
      if (fragments.length >= 16) break;
    }
    if (fragments.length >= 16) break;
  }
  return { kinds: [...kinds], fragments };
}

function extractText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

async function scanChatMessages() {
  const findings = [];
  const matchedIds = [];
  const pageSize = 1000;
  let from = 0;
  let scanned = 0;
  const hardCap = 5000;
  while (from < hardCap) {
    const to = Math.min(from + pageSize, hardCap) - 1;
    const { data, error } = await supabase
      .from("rgaios_agent_chat_messages")
      .select("id, organization_id, agent_id, role, content, created_at")
      .order("created_at", { ascending: true })
      .range(from, to);
    if (error) {
      process.stderr.write(`chat select err: ${error.message}\n`);
      break;
    }
    if (!data || data.length === 0) break;
    scanned += data.length;
    for (const row of data) {
      const text = extractText(row.content);
      const { kinds, fragments } = scan(text);
      if (kinds.length === 0) continue;
      matchedIds.push(row.id);
      findings.push({
        source: "rgaios_agent_chat_messages",
        message_id: row.id,
        organization_id: row.organization_id,
        agent_id: row.agent_id,
        role: row.role,
        created_at: row.created_at,
        kinds,
        fragments_preview: fragments,
      });
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  process.stderr.write(`scanned chat rows: ${scanned}\n`);
  return { findings, matchedIds };
}

async function scanCompanyChunks() {
  const findings = [];
  const matchedIds = [];
  const pageSize = 1000;
  let from = 0;
  let scanned = 0;
  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("rgaios_company_chunks")
      .select("id, organization_id, source, source_id, chunk_text, created_at")
      .order("created_at", { ascending: true })
      .range(from, to);
    if (error) {
      process.stderr.write(`chunks select err: ${error.message}\n`);
      break;
    }
    if (!data || data.length === 0) break;
    scanned += data.length;
    for (const row of data) {
      const { kinds, fragments } = scan(row.chunk_text);
      if (kinds.length === 0) continue;
      matchedIds.push(row.id);
      findings.push({
        source: "rgaios_company_chunks",
        chunk_id: row.id,
        organization_id: row.organization_id,
        source_table: row.source,
        source_id: row.source_id,
        created_at: row.created_at,
        kinds,
        fragments_preview: fragments,
      });
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  process.stderr.write(`scanned chunk rows: ${scanned}\n`);
  return { findings, matchedIds };
}

async function purge(table, ids) {
  if (ids.length === 0) return 0;
  let deleted = 0;
  const batchSize = 200;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const { error, count } = await supabase
      .from(table)
      .delete({ count: "exact" })
      .in("id", batch);
    if (error) {
      process.stderr.write(`purge ${table} err: ${error.message}\n`);
      continue;
    }
    deleted += count ?? batch.length;
  }
  return deleted;
}

async function confirmPurge() {
  process.stderr.write(
    "--purge: deleting matched rows in 3s. ctrl-c to abort...\n",
  );
  await new Promise((r) => setTimeout(r, 3000));
}

const chatResult = await scanChatMessages();
const chunksResult = await scanCompanyChunks();
const allFindings = [...chatResult.findings, ...chunksResult.findings];

if (PURGE && allFindings.length > 0) {
  await confirmPurge();
  const a = await purge("rgaios_agent_chat_messages", chatResult.matchedIds);
  const b = await purge("rgaios_company_chunks", chunksResult.matchedIds);
  process.stderr.write(
    `purged: chat=${a} chunks=${b} total=${a + b}\n`,
  );
}

process.stdout.write(JSON.stringify(allFindings, null, 2) + "\n");
process.stderr.write(`findings: ${allFindings.length}\n`);
process.exit(0);
