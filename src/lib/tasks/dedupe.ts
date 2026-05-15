/**
 * Pure helpers for the /api/tasks response shape.
 *
 * Two transforms live here, both extracted from the route handler so
 * they can be unit-tested without standing up Supabase or Next:
 *
 *  1. `markDelivered(task)` - flags a task row as "delivered" when its
 *     latest run is `succeeded` AND there is a non-empty `latestOutput`
 *     string. Marti's GAP #4 ask: she wants a quick way to scan /tasks
 *     from a parallel chat and find a scrape result that was already
 *     produced. Without the explicit flag the UI has to re-derive the
 *     same predicate in multiple places, so we compute it once here.
 *
 *  2. `dedupeNearby(tasks, windowMs)` - collapses consecutive rows
 *     with the same title that landed inside the same time window.
 *     A busy org piles up ~200 task rows per day, most of which are
 *     re-emissions of the same brief (council vote -> re-task ->
 *     parallel chat asks the same thing). We keep the LATEST row of
 *     each cluster and surface `dedupedFrom: N` so the UI can show
 *     "+N similar" without losing the count.
 *
 * Both functions are pure / non-mutating: they return new arrays /
 * objects. The route handler composes them; the unit spec exercises
 * them directly.
 */

export type TaskRow = {
  routineId: string;
  title: string;
  description: string | null;
  kind: string;
  createdAt: string | null;
  assignee: { id: string; name: string; role: string | null } | null;
  runCount: number;
  latestStatus: string;
  latestRunAt: string | null;
  latestOutput: string | null;
  latestError: string | null;
};

export type EnrichedTask = TaskRow & {
  delivered: boolean;
  dedupedFrom: number;
};

/**
 * Compute the delivered flag for a single row.
 *
 * delivered === true iff the latest run succeeded AND produced a
 * non-empty string output. We treat whitespace-only output as
 * not-delivered: the route handler already trims+nulls those out in
 * `latestOutput`, but we re-check here so this helper is correct in
 * isolation.
 */
export function isDelivered(t: TaskRow): boolean {
  if (t.latestStatus !== "succeeded") return false;
  const o = t.latestOutput;
  return typeof o === "string" && o.trim().length > 0;
}

export function markDelivered(t: TaskRow): EnrichedTask {
  return {
    ...t,
    delivered: isDelivered(t),
    dedupedFrom: 0,
  };
}

/**
 * Normalise a title for dedup comparison. Trim, collapse internal
 * whitespace, lowercase. Two titles that only differ in spacing /
 * casing should collapse - "Scrape Marti IG" and "scrape marti ig"
 * are the same brief for our purposes.
 *
 * We deliberately do NOT strip punctuation or stem words: the dedup
 * is meant to catch literal re-emissions (council vote -> re-task),
 * not semantic near-duplicates. Stemming would create false positives
 * across genuinely different briefs.
 */
function normTitle(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Parse a routine's createdAt to epoch ms. Falls back to 0 when the
 * timestamp is null / unparseable, which makes those rows "ancient"
 * and therefore never inside the window with another row. That keeps
 * the dedup conservative - we never collapse rows we can't time-
 * order.
 */
function toMs(iso: string | null): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Dedup rows whose titles match (case-insensitive, whitespace-
 * normalised) and whose createdAt falls inside the same window.
 *
 * Algorithm:
 *  1. Stable-sort a shallow copy by createdAt DESC (latest first).
 *     The route already orders by created_at desc but we re-sort
 *     defensively so the helper is order-independent.
 *  2. Walk the list. For each row, if a kept row with the same
 *     normalised title was added within `windowMs` of it, mark
 *     this row as a dup of that kept row.
 *  3. The kept row's `dedupedFrom` increments per absorbed dup.
 *
 * Result preserves the original sort order (latest first) and only
 * contains the kept rows.
 *
 * Edge cases:
 *  - Empty array -> empty array.
 *  - Single row -> single row with dedupedFrom=0.
 *  - Rows with createdAt=null are never collapsed (toMs returns 0,
 *    so they'd only collapse with another epoch-0 row; in practice
 *    Supabase always stamps created_at).
 */
export function dedupeNearby(
  tasks: EnrichedTask[],
  windowMs: number = 60 * 60 * 1000,
): EnrichedTask[] {
  if (tasks.length <= 1) return tasks.slice();

  // Sort latest-first by createdAt. Stable so equal timestamps keep
  // input order.
  const sorted = tasks
    .map((t, i) => ({ t, i, ms: toMs(t.createdAt) }))
    .sort((a, b) => {
      if (b.ms !== a.ms) return b.ms - a.ms;
      return a.i - b.i;
    })
    .map((x) => x.t);

  // For each normalised title, the most-recent kept row + its ms.
  const kept: EnrichedTask[] = [];
  const lastKeptByTitle = new Map<
    string,
    { row: EnrichedTask; ms: number }
  >();

  for (const row of sorted) {
    const key = normTitle(row.title);
    const ms = toMs(row.createdAt);
    const prev = lastKeptByTitle.get(key);
    if (prev && prev.ms - ms <= windowMs) {
      // Within window of an already-kept (later) row -> absorb.
      prev.row.dedupedFrom += 1;
      continue;
    }
    // First sighting (or out of window) -> keep.
    kept.push(row);
    lastKeptByTitle.set(key, { row, ms });
  }

  return kept;
}

/**
 * Compose the two transforms. Convenience for the route handler so
 * the call site reads as one step.
 */
export function buildTaskResponse(
  rows: TaskRow[],
  windowMs: number = 60 * 60 * 1000,
): EnrichedTask[] {
  const enriched = rows.map(markDelivered);
  return dedupeNearby(enriched, windowMs);
}
