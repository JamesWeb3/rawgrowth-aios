import { NextResponse } from "next/server";

import { getOrgContext } from "@/lib/auth/admin";
import { resolveComposioApiKey } from "@/lib/composio/proxy";
import {
  getBrowseCache,
  setBrowseCache,
  type BrowseItem,
} from "@/lib/connections/browse-cache";

export const runtime = "nodejs";

/**
 * GET /api/connections/composio/browse
 *
 * Lists every Composio toolkit visible to this org's API key, so
 * operators can connect any of the 200+ apps without us hardcoding
 * them into CONNECTOR_CATALOG. Auth: session-scoped via
 * getOrgContext() so RLS holds even when a logged-out tab probes.
 *
 * Caching: 5-minute in-memory TTL keyed by orgId (mandatory per spec).
 * We do not want to hit Composio's `/api/v3/toolkits` on every modal
 * open or page refresh. Cache also serves the security gate on
 * /api/connections/composio POST so dynamic slugs round-trip safely.
 *
 * Errors: anything upstream (no API key, fetch failure, non-2xx) maps
 * to 502 with a friendly message; the modal renders it as a
 * pageload-level error state instead of crashing.
 */

type ToolkitListItem = {
  slug?: string;
  name?: string;
  description?: string | null;
  logo?: string | null;
  meta?: {
    logo?: string | null;
    description?: string | null;
    categories?: Array<{ id?: string; name?: string }> | null;
  } | null;
  categories?: Array<{ id?: string; name?: string }> | null;
};

type ToolkitListResponse = {
  items?: ToolkitListItem[];
  toolkits?: ToolkitListItem[];
  data?: ToolkitListItem[];
};

function normalizeToolkit(raw: ToolkitListItem): BrowseItem | null {
  const slug = (raw.slug ?? "").trim();
  if (!slug) return null;
  const name = (raw.name ?? slug).trim();
  const description =
    (raw.description ?? raw.meta?.description ?? null) || null;
  const logo = (raw.logo ?? raw.meta?.logo ?? null) || null;
  const cats = raw.categories ?? raw.meta?.categories ?? null;
  const firstCat =
    Array.isArray(cats) && cats.length > 0
      ? (cats[0]?.name ?? cats[0]?.id ?? null)
      : null;
  return { slug, name, description, logo, category: firstCat };
}

export async function GET() {
  try {
    const ctx = await getOrgContext();
    if (!ctx || !ctx.activeOrgId) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const organizationId = ctx.activeOrgId;

    // Cache hit: serve immediately. The slugSet is also consulted by the
    // POST /api/connections/composio gate so live browse slugs round-trip.
    const cached = getBrowseCache(organizationId);
    if (cached) {
      return NextResponse.json({
        items: cached.items,
        fetchedAt: new Date(cached.fetchedAt).toISOString(),
        cached: true,
      });
    }

    const composioKey = await resolveComposioApiKey(organizationId);
    if (!composioKey) {
      return NextResponse.json(
        {
          error:
            "Composio API key missing - set per-org key in Connections → Workspace API keys, or set COMPOSIO_API_KEY env",
        },
        { status: 502 },
      );
    }

    // Composio's /api/v3/toolkits endpoint. limit=500 covers the full
    // catalog (~200 toolkits today) without pagination. If they ever
    // grow past 500 we'll add a cursor loop similar to composio-router.
    let upstream: Response;
    try {
      upstream = await fetch(
        "https://backend.composio.dev/api/v3/toolkits?limit=500",
        {
          method: "GET",
          headers: {
            "x-api-key": composioKey,
            "content-type": "application/json",
          },
          signal: AbortSignal.timeout(20_000),
        },
      );
    } catch (err) {
      return NextResponse.json(
        {
          error: `Composio fetch failed: ${(err as Error).message}`,
        },
        { status: 502 },
      );
    }
    if (!upstream.ok) {
      const body = await upstream.text().catch(() => "");
      return NextResponse.json(
        {
          error: `Composio /toolkits ${upstream.status}: ${body.slice(0, 200)}`,
        },
        { status: 502 },
      );
    }

    const json = (await upstream.json().catch(() => ({}))) as
      | ToolkitListResponse
      | ToolkitListItem[]
      | undefined;
    const raw: ToolkitListItem[] = Array.isArray(json)
      ? json
      : (json?.items ?? json?.toolkits ?? json?.data ?? []);

    const items: BrowseItem[] = [];
    const seen = new Set<string>();
    for (const r of raw) {
      const item = normalizeToolkit(r);
      if (!item) continue;
      if (seen.has(item.slug)) continue;
      seen.add(item.slug);
      items.push(item);
    }
    items.sort((a, b) => a.name.localeCompare(b.name));

    const entry = setBrowseCache(organizationId, items);
    return NextResponse.json({
      items: entry.items,
      fetchedAt: new Date(entry.fetchedAt).toISOString(),
      cached: false,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
