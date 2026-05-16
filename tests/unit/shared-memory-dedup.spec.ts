import test from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  normalizeScope,
  prefixKey,
  scopeKey,
} from "@/lib/memory/shared";

// These helpers (normalizeScope / prefixKey / scopeKey) must produce
// keys that match the Postgres generated columns added in migration
// 0075 (fact_prefix + scope_key). If the JS canonicalization drifts
// from what the DB stores, the dedup unique index will start letting
// duplicates through. These tests pin the JS side; a parallel set of
// expectations in the migration comment block keeps the SQL side
// documented.

test("normalizeScope sorts so the DB scope_key stays canonical", () => {
  // Same dept set, different input order. Both must collapse to the
  // same array OR the partial unique index would let two rows through.
  const a = normalizeScope(["marketing", "sales"]);
  const b = normalizeScope(["sales", "marketing"]);
  assert.deepEqual(a, b);
  assert.deepEqual(a, ["marketing", "sales"]);
});

test("normalizeScope strips 'all' and '*' (org-wide marker collapses to [])", () => {
  // 'all' / '*' are org-wide markers. They live in the XML
  // <shared_memory scope="all"> form but the table stores org-wide
  // as the empty array. Lets one row cover the universal case.
  assert.deepEqual(normalizeScope(["all"]), []);
  assert.deepEqual(normalizeScope(["*"]), []);
  assert.deepEqual(normalizeScope(["all", "sales"]), ["sales"]);
});

test("normalizeScope lowercases + trims + dedupes", () => {
  assert.deepEqual(
    normalizeScope(["Sales", " sales ", "MARKETING"]),
    ["marketing", "sales"],
  );
});

test("normalizeScope handles missing input", () => {
  assert.deepEqual(normalizeScope(undefined), []);
  assert.deepEqual(normalizeScope([]), []);
});

test("prefixKey matches the Postgres fact_prefix formula", () => {
  // Postgres expression: lower(substring(trim(fact) from 1 for 80))
  // JS prefixKey: fact.trim().slice(0, 80).toLowerCase()
  // Both must produce the same string or the unique index lets dupes
  // through (or rejects non-duplicates).
  const fact = "   Owner uses Shopify, not WooCommerce.   ";
  const expected = "owner uses shopify, not woocommerce.";
  assert.equal(prefixKey(fact), expected);
});

test("prefixKey caps at 80 chars before lowercasing", () => {
  const long =
    "Top reel last week had 6,645 comments from @aiwithremy and was about creative + media buying with claude.";
  // 80-char window after trim:
  // "Top reel last week had 6,645 comments from @aiwithremy and was about creative +"
  // length(80) - manual count: 80 = up to "+"
  const key = prefixKey(long);
  assert.equal(key.length, 80);
  assert.ok(key.startsWith("top reel last week"));
  assert.ok(!key.includes("media buying"));
});

test("scopeKey is a pure '|'-join matching DB array_to_string(scope, '|')", () => {
  // scopeKey intentionally does NOT sort - it joins in whatever order
  // it receives so the produced string matches the DB's
  // array_to_string(scope, '|') stored generated column exactly. The
  // single sort happens once in normalizeScope() at the insert
  // boundary so two writes with the same dept set in different input
  // order both collapse to one canonical row via the unique index.
  assert.equal(scopeKey([]), "");
  assert.equal(scopeKey(["sales"]), "sales");
  // Pre-sorted input passes through.
  assert.equal(scopeKey(["marketing", "sales"]), "marketing|sales");
  // Unsorted input is preserved as-is (callers must pre-sort).
  assert.equal(scopeKey(["sales", "marketing"]), "sales|marketing");
  // The combined normalizeScope -> scopeKey pipeline gives the canonical key.
  assert.equal(
    scopeKey(normalizeScope(["sales", "marketing"])),
    "marketing|sales",
  );
});

test("migration 0075 cleans half-state from prior attempts but ships no live index yet", () => {
  // 0075 went through three failed shapes on the prod Postgres image:
  // stored generated columns (expr-level COLLATE), stored generated
  // columns (column-level COLLATE), expression index. All three hit
  // "functions in index expression must be marked IMMUTABLE" / the
  // generated-column equivalent. The shipped 0075 now only drops any
  // half-state and leaves dedup to the JS layer. A follow-up migration
  // can ship a real IMMUTABLE wrapper function + bring back the
  // partial unique index.
  const sql = readFileSync(
    resolve(__dirname, "../../supabase/migrations/0075_shared_memory_dedup_index.sql"),
    "utf8",
  );
  assert.match(sql, /drop column if exists fact_prefix/);
  assert.match(sql, /drop column if exists scope_key/);
  assert.match(sql, /drop index if exists uq_rgaios_shared_memory_dedup_active/);
  // Confirm no naive CREATE INDEX line slipped back in - the next
  // attempt belongs in a fresh migration.
  assert.ok(
    !/create unique index/i.test(sql),
    "0075 must stay no-op until an IMMUTABLE wrapper migration ships",
  );
});
