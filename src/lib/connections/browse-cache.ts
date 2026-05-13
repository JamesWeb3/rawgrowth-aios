/**
 * In-process cache of the live Composio toolkit catalog, keyed per
 * organization. Powers `GET /api/connections/composio/browse` (modal
 * grid showing all ~200+ apps without us hardcoding them) AND the
 * security gate on `POST /api/connections/composio`: the connect
 * endpoint accepts any slug we've seen in the live catalog for this
 * org within the last 5 min, in addition to the hardcoded
 * CONNECTOR_CATALOG allowlist.
 *
 * Cache is per-org because the Composio API key is per-org (set on
 * Connections → Workspace API keys), and each org may have a
 * different set of toolkits enabled.
 *
 * TTL is mandatory (5 min) so we don't hammer Composio's toolkits
 * endpoint on every page load. The cache lives in process memory and
 * clears on restart - that's fine; the next page-load just refetches.
 */

export type BrowseItem = {
  slug: string;
  name: string;
  description: string | null;
  logo: string | null;
  category: string | null;
};

export type BrowseEntry = {
  items: BrowseItem[];
  slugSet: Set<string>;
  fetchedAt: number;
  expiresAt: number;
};

const TTL_MS = 5 * 60 * 1000;

const cache: Map<string, BrowseEntry> = new Map();

export function getBrowseCache(orgId: string): BrowseEntry | null {
  const entry = cache.get(orgId);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    cache.delete(orgId);
    return null;
  }
  return entry;
}

export function setBrowseCache(
  orgId: string,
  items: BrowseItem[],
): BrowseEntry {
  const now = Date.now();
  const entry: BrowseEntry = {
    items,
    slugSet: new Set(items.map((i) => i.slug)),
    fetchedAt: now,
    expiresAt: now + TTL_MS,
  };
  cache.set(orgId, entry);
  return entry;
}

/**
 * Security gate helper used by /api/connections/composio POST. Returns
 * true when `slug` was returned by the live toolkits fetch for `orgId`
 * within the last 5 min. Returning false means the caller should fall
 * back to the hardcoded CONNECTOR_CATALOG allowlist - we never allow
 * arbitrary strings posted by the client.
 */
export function isLiveBrowseSlug(orgId: string, slug: string): boolean {
  const entry = getBrowseCache(orgId);
  if (!entry) return false;
  return entry.slugSet.has(slug);
}

/** Test-only: wipe the cache. Exported so unit tests stay isolated. */
export function _resetBrowseCacheForTest(): void {
  cache.clear();
}

export const BROWSE_CACHE_TTL_MS = TTL_MS;
