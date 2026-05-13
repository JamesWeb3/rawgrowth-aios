import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

/**
 * Unit tests for src/lib/connections/browse-cache.ts. The cache backs
 * /api/connections/composio/browse (modal that lists 200+ Composio
 * apps) AND the security gate on /api/connections/composio POST
 * (accepts dynamic slugs only when they were in the live browse fetch
 * for this org within 5 min). Both behaviours need to hold.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-key";

import {
  getBrowseCache,
  setBrowseCache,
  isLiveBrowseSlug,
  _resetBrowseCacheForTest,
  BROWSE_CACHE_TTL_MS,
} from "@/lib/connections/browse-cache";

beforeEach(() => {
  _resetBrowseCacheForTest();
});

test("setBrowseCache stores items and slugSet for the given org", () => {
  const items = [
    {
      slug: "instagram",
      name: "Instagram",
      description: null,
      logo: null,
      category: "social",
    },
    {
      slug: "linear",
      name: "Linear",
      description: "Issue tracker",
      logo: null,
      category: "productivity",
    },
  ];
  setBrowseCache("org-1", items);
  const entry = getBrowseCache("org-1");
  assert.ok(entry, "cache entry should exist");
  assert.equal(entry!.items.length, 2);
  assert.ok(entry!.slugSet.has("instagram"));
  assert.ok(entry!.slugSet.has("linear"));
});

test("cache is per-org - one org cannot read another's entry", () => {
  setBrowseCache("org-A", [
    {
      slug: "instagram",
      name: "Instagram",
      description: null,
      logo: null,
      category: null,
    },
  ]);
  assert.ok(getBrowseCache("org-A"));
  assert.equal(getBrowseCache("org-B"), null);
});

test("isLiveBrowseSlug enforces the org-scoped allowlist gate", () => {
  setBrowseCache("org-1", [
    {
      slug: "instagram",
      name: "Instagram",
      description: null,
      logo: null,
      category: null,
    },
  ]);
  // Hit
  assert.equal(isLiveBrowseSlug("org-1", "instagram"), true);
  // Miss: same org, slug not in fetch
  assert.equal(isLiveBrowseSlug("org-1", "wechat"), false);
  // Miss: different org (cache is org-scoped)
  assert.equal(isLiveBrowseSlug("org-2", "instagram"), false);
});

test("cache TTL expires and getBrowseCache then returns null", () => {
  setBrowseCache("org-1", [
    {
      slug: "instagram",
      name: "Instagram",
      description: null,
      logo: null,
      category: null,
    },
  ]);
  // Sanity: live now.
  assert.ok(getBrowseCache("org-1"));

  // Fast-forward by mutating Date.now via a stub. Wrap to restore so
  // the test doesn't leak global state.
  const originalNow = Date.now;
  try {
    const future = originalNow() + BROWSE_CACHE_TTL_MS + 1_000;
    Date.now = () => future;
    assert.equal(getBrowseCache("org-1"), null);
    assert.equal(isLiveBrowseSlug("org-1", "instagram"), false);
  } finally {
    Date.now = originalNow;
  }
});

test("setBrowseCache replaces a prior entry for the same org", () => {
  setBrowseCache("org-1", [
    {
      slug: "old",
      name: "Old",
      description: null,
      logo: null,
      category: null,
    },
  ]);
  setBrowseCache("org-1", [
    {
      slug: "new",
      name: "New",
      description: null,
      logo: null,
      category: null,
    },
  ]);
  const entry = getBrowseCache("org-1");
  assert.ok(entry);
  assert.equal(entry!.items.length, 1);
  assert.equal(entry!.items[0].slug, "new");
  assert.equal(isLiveBrowseSlug("org-1", "old"), false);
  assert.equal(isLiveBrowseSlug("org-1", "new"), true);
});
