import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Shared org-wide memory layer. Sits alongside per-agent chat_memory
 * (rgaios_audit_log kind=chat_memory) but persists in
 * rgaios_shared_memory so any agent in the org can read it.
 *
 * Use cases:
 *   - Client-level facts ("uses Shopify, not WooCommerce")
 *   - Owner preferences ("Chris prefers PT-BR slack")
 *   - Incident postmortems ("Apr 28: ad spend over-budget by $3k")
 *   - Decisions made in CEO/Atlas chats that downstream agents must
 *     respect (a Strategy decision the marketer + sdr both need)
 *
 * The agent emits <shared_memory importance="N" scope="dept|all">FACT</shared_memory>
 * blocks in its reply. The chat route extracts those after applying
 * brand filter (mirroring the <task> extraction flow) and calls
 * addSharedMemory() for each block.
 *
 * Dedup: prefix match on first 80 chars within the same scope. Cheap,
 * tight, and matches the existing chat_memory dedup approach in
 * src/app/api/agents/[id]/chat/route.ts.
 */

export type SharedMemoryRow = {
  id: string;
  organization_id: string;
  fact: string;
  source_agent_id: string | null;
  source_chat_id: number | null;
  importance: number;
  scope: string[];
  supersedes_id: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

const DEDUP_PREFIX_LEN = 80;
const MAX_FACT_LEN = 600;

function clampImportance(n: number | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(5, Math.round(n)));
}

function normalizeScope(scope: string[] | undefined): string[] {
  if (!scope || !Array.isArray(scope)) return [];
  const cleaned = scope
    .map((s) => (s ?? "").toString().trim().toLowerCase())
    .filter((s) => s.length > 0 && s !== "all" && s !== "*");
  return Array.from(new Set(cleaned));
}

function prefixKey(fact: string): string {
  return fact.trim().slice(0, DEDUP_PREFIX_LEN).toLowerCase();
}

function scopeKey(scope: string[]): string {
  return [...scope].sort().join("|");
}

/**
 * Insert a new shared memory row for the org. Skips when an active
 * row exists with the same 80-char prefix AND the same scope set
 * (case-insensitive). Returns the inserted row, the existing dup, or
 * null on hard insert failure.
 */
export async function addSharedMemory(input: {
  orgId: string;
  fact: string;
  importance?: number;
  scope?: string[];
  sourceAgentId?: string | null;
  sourceChatId?: number | null;
}): Promise<{ row: SharedMemoryRow | null; deduped: boolean }> {
  const fact = (input.fact ?? "").trim().slice(0, MAX_FACT_LEN);
  if (!fact) return { row: null, deduped: false };

  const scope = normalizeScope(input.scope);
  const importance = clampImportance(input.importance);
  const db = supabaseAdmin();

  // Dedup: pull active rows for the org, compare prefix + scope set.
  const { data: priorRows } = await db
    .from("rgaios_shared_memory")
    .select("id, fact, scope, importance, organization_id, source_agent_id, source_chat_id, supersedes_id, created_at, updated_at, archived_at")
    .eq("organization_id", input.orgId)
    .is("archived_at", null)
    .limit(500);
  const priors = (priorRows ?? []) as SharedMemoryRow[];
  const incomingHead = prefixKey(fact);
  const incomingScopeKey = scopeKey(scope);
  const dup = priors.find(
    (p) =>
      prefixKey(p.fact) === incomingHead &&
      scopeKey(p.scope ?? []) === incomingScopeKey,
  );
  if (dup) {
    // Bump updated_at so importance refresh shows recency, but do not
    // touch importance downwards.
    if (importance > dup.importance) {
      await db
        .from("rgaios_shared_memory")
        .update({
          importance,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", dup.id);
    }
    return { row: dup, deduped: true };
  }

  const { data: inserted, error } = await db
    .from("rgaios_shared_memory")
    .insert({
      organization_id: input.orgId,
      fact,
      importance,
      scope,
      source_agent_id: input.sourceAgentId ?? null,
      source_chat_id: input.sourceChatId ?? null,
    } as never)
    .select("id, organization_id, fact, source_agent_id, source_chat_id, importance, scope, supersedes_id, created_at, updated_at, archived_at")
    .single();
  if (error || !inserted) {
    console.warn(`[shared-memory] insert failed: ${error?.message ?? "unknown"}`);
    return { row: null, deduped: false };
  }
  return { row: inserted as SharedMemoryRow, deduped: false };
}

/**
 * Pull shared memory for a specific agent. Returns active (non-archived)
 * rows where scope is empty (org-wide) OR includes the agent's
 * department. Sort: importance desc, then recency desc. Caller decides
 * how many to render in preamble (typical cap = 12).
 */
export async function listSharedMemoryForAgent(input: {
  orgId: string;
  agentId: string;
  agentDept?: string | null;
  limit?: number;
}): Promise<SharedMemoryRow[]> {
  const db = supabaseAdmin();
  const dept = (input.agentDept ?? "").trim().toLowerCase();
  const limit = input.limit ?? 50;

  const { data: rows } = await db
    .from("rgaios_shared_memory")
    .select("id, organization_id, fact, source_agent_id, source_chat_id, importance, scope, supersedes_id, created_at, updated_at, archived_at")
    .eq("organization_id", input.orgId)
    .is("archived_at", null)
    .order("importance", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  const all = (rows ?? []) as SharedMemoryRow[];
  // Filter in JS so empty-scope rows always pass and dept-scope rows
  // match by case-insensitive include. GIN index narrows the query
  // already; this keeps the scope-match logic colocated and trivial
  // to test.
  const visible = all.filter((r) => {
    const sc = (r.scope ?? []).map((s) => s.toLowerCase());
    if (sc.length === 0) return true;
    if (!dept) return false;
    return sc.includes(dept);
  });
  return visible;
}

/**
 * Promote an individual chat_memory row (rgaios_audit_log) into shared
 * memory. Useful when one agent learns a fact obviously relevant to
 * peers (Marketing Manager: "client hired new sales VP, ramp up SDR
 * cadence" - SDR needs to know).
 *
 * Reads the source memory row, infers a reasonable importance + scope
 * if not overridden, and calls addSharedMemory(). Returns the new
 * shared row, or null on lookup failure.
 */
export async function promoteToShared(input: {
  orgId: string;
  individualMemoryId: string;
  importance?: number;
  scope?: string[];
}): Promise<SharedMemoryRow | null> {
  const db = supabaseAdmin();
  const { data: src } = await db
    .from("rgaios_audit_log")
    .select("id, detail, actor_id")
    .eq("organization_id", input.orgId)
    .eq("id", input.individualMemoryId)
    .eq("kind", "chat_memory")
    .maybeSingle();
  if (!src) return null;
  const row = src as {
    id: string;
    actor_id: string | null;
    detail: { fact?: string; importance?: number; agent_id?: string };
  };
  const fact = row.detail?.fact;
  if (!fact) return null;

  // Default: bump importance by 1 (peer-relevant facts deserve more
  // weight than per-agent context), cap at 5.
  const importance = clampImportance(
    input.importance ?? (row.detail.importance ?? 3) + 1,
  );

  const result = await addSharedMemory({
    orgId: input.orgId,
    fact,
    importance,
    scope: input.scope ?? [],
    sourceAgentId: row.detail.agent_id ?? row.actor_id ?? null,
  });
  return result.row;
}

/**
 * Archive an existing shared memory row. Used when a fact is replaced
 * by a fresher one (revision flow). Caller should pass the new row id
 * via supersedes_id when inserting the replacement. This helper just
 * stamps archived_at on the old row.
 */
export async function archiveSharedMemory(input: {
  orgId: string;
  rowId: string;
}): Promise<void> {
  const db = supabaseAdmin();
  await db
    .from("rgaios_shared_memory")
    .update({ archived_at: new Date().toISOString() } as never)
    .eq("id", input.rowId)
    .eq("organization_id", input.orgId);
}

const SHARED_MEMORY_BLOCK_RE =
  /<shared_memory(?:\s+importance="([^"]*)")?(?:\s+scope="([^"]*)")?\s*>([\s\S]*?)<\/shared_memory>/gi;

export type ExtractedSharedMemory = {
  fact: string;
  importance: number;
  scope: string[];
};

/**
 * Pull <shared_memory ...>FACT</shared_memory> blocks out of an agent
 * reply. Mirrors the <task> extraction in src/lib/agent/tasks.ts.
 * Returns the cleaned reply (blocks removed) plus the parsed entries.
 *
 * Scope syntax:
 *   scope="all"             - org-wide (empty array)
 *   scope="sales"           - single dept
 *   scope="sales,marketing" - comma-separated list of dept slugs
 */
export function extractSharedMemoryBlocks(reply: string): {
  visibleReply: string;
  entries: ExtractedSharedMemory[];
} {
  const matches = [...reply.matchAll(SHARED_MEMORY_BLOCK_RE)];
  if (matches.length === 0) {
    return { visibleReply: reply, entries: [] };
  }
  const entries: ExtractedSharedMemory[] = [];
  for (const m of matches) {
    const importanceRaw = m[1];
    const scopeRaw = m[2];
    const fact = (m[3] ?? "").trim();
    if (!fact) continue;
    const importance = clampImportance(
      importanceRaw ? Number(importanceRaw) : 3,
    );
    const scope = scopeRaw
      ? normalizeScope(scopeRaw.split(/[,;]+/))
      : [];
    entries.push({ fact, importance, scope });
  }
  const visibleReply = reply.replace(SHARED_MEMORY_BLOCK_RE, "").trim();
  return { visibleReply, entries };
}

/**
 * Convenience: extract blocks from a reply and persist them under one
 * source agent / chat. Returns counts so callers can log.
 */
export async function persistSharedMemoryFromReply(input: {
  orgId: string;
  sourceAgentId: string;
  sourceChatId?: number | null;
  reply: string;
}): Promise<{ visibleReply: string; created: number; deduped: number }> {
  const { visibleReply, entries } = extractSharedMemoryBlocks(input.reply);
  let created = 0;
  let deduped = 0;
  for (const e of entries) {
    const r = await addSharedMemory({
      orgId: input.orgId,
      fact: e.fact,
      importance: e.importance,
      scope: e.scope,
      sourceAgentId: input.sourceAgentId,
      sourceChatId: input.sourceChatId ?? null,
    });
    if (r.row && !r.deduped) created += 1;
    else if (r.deduped) deduped += 1;
  }
  return { visibleReply, created, deduped };
}
