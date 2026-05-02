// Diagnostic: build the chat preamble that Marketing Manager would
// receive for a sample question, and print each section's size + a
// preview. Confirms the chat route IS injecting brand + memories +
// knowledge + corpus.
import "dotenv/config";
import pg from "pg";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const ORG_SLUG = process.argv[2] ?? "acme-coaching-76897";
const { rows: orgRows } = await c.query(
  `select id, name from rgaios_organizations where slug = $1`,
  [ORG_SLUG],
);
if (orgRows.length === 0) { console.error("org not found"); process.exit(1); }
const org = orgRows[0];

const { rows: agentRows } = await c.query(
  `select id, name, role, title, system_prompt, description
   from rgaios_agents
   where organization_id = $1 and department = 'marketing' and is_department_head = true
   limit 1`,
  [org.id],
);
if (agentRows.length === 0) { console.error("marketing mgr not found"); process.exit(1); }
const agent = agentRows[0];
console.log(`\n=== Inspecting chat preamble ===\norg: ${org.name}\nagent: ${agent.name}\n`);

let total = 0;
function section(name, content) {
  if (!content || (typeof content === "string" && !content.trim())) {
    console.log(`✗ ${name}: empty`);
    return;
  }
  const len = String(content).length;
  total += len;
  const preview = String(content).slice(0, 140).replace(/\s+/g, " ");
  console.log(`✓ ${name}: ${len} chars`);
  console.log(`    preview: ${preview}...`);
}

// 1. Persona
const personaLines = [];
if (agent.role) personaLines.push(`Role: ${agent.role}`);
if (agent.title) personaLines.push(`Title: ${agent.title}`);
const personaPrompt = (agent.system_prompt?.trim() || agent.description?.trim() || "");
if (personaPrompt) personaLines.push(`Persona: ${personaPrompt}`);
section("1. PERSONA (role + title + system_prompt)", personaLines.join("\n"));

// 2. Memories
const { rows: memories } = await c.query(
  `select detail from rgaios_audit_log
   where organization_id = $1 and kind = 'chat_memory' and detail->>'agent_id' = $2
   order by ts desc limit 15`,
  [org.id, agent.id],
);
const memBlock = memories
  .filter((m) => m.detail?.fact)
  .reverse()
  .map((m, i) => `${i + 1}. ${m.detail.fact}`)
  .join("\n");
section(`2. PAST MEMORIES (${memories.length} rows)`, memBlock);

// 3. Brand profile
const { rows: brandRows } = await c.query(
  `select content from rgaios_brand_profiles
   where organization_id = $1 and status = 'approved'
   order by version desc limit 1`,
  [org.id],
);
section("3. BRAND PROFILE", brandRows[0]?.content);

// 4. Org knowledge files (count only - content embedded into company_chunks)
const { rows: kRows } = await c.query(
  `select count(*) from rgaios_knowledge_files where organization_id = $1`,
  [org.id],
);
console.log(`✓ 4. ORG KNOWLEDGE FILES: ${kRows[0].count} files (content auto-embedded into company_chunks - reached via RAG)`);

// 5. Per-agent files (count only - no embedding without LLM key)
const { rows: agentFiles } = await c.query(
  `select count(*) from rgaios_agent_files where agent_id = $1`,
  [agent.id],
);
console.log(`✓ 5. PER-AGENT FILES: ${agentFiles[0].count} files indexed (RAG via embeddings - top-K injected per query)`);

// 6. Company corpus
const { rows: corpusCount } = await c.query(
  `select count(*) from rgaios_company_chunks where organization_id = $1`,
  [org.id],
);
console.log(`✓ 6. COMPANY CORPUS: ${corpusCount[0].count} chunks indexed (RAG via embeddings - top-5 injected per query)`);

// 7. Chat history
const { rows: histCount } = await c.query(
  `select count(*) from rgaios_agent_chat_messages
   where organization_id = $1 and agent_id = $2 and (metadata->>'archived' is null or metadata->>'archived' = 'false')`,
  [org.id, agent.id],
);
console.log(`✓ 7. CHAT HISTORY: ${histCount[0].count} active messages (sent verbatim as conversation context)`);

console.log(`\n--- TOTAL preamble size (excl RAG): ${total.toLocaleString()} chars (~${Math.round(total / 4).toLocaleString()} tokens) ---`);

await c.end();
