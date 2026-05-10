/**
 * Print a TypeScript snippet of `logoUrl: "..."` lines for every entry in
 * CONNECTOR_CATALOG that Composio's apps API knows about. Pedro pastes
 * the snippet into src/lib/connections/catalog.ts when refreshing logos.
 *
 * Why a script:
 * - Composio adds toolkits over time; this lets us re-sync logo URLs
 *   without hand-maintaining a parallel mapping.
 * - Render path stays zero-network at runtime: the URLs land in
 *   catalog.ts at build time, the grid points <img src> straight at
 *   logos.composio.dev.
 *
 * Source: GET https://backend.composio.dev/api/v1/apps?limit=500 with
 * x-api-key. The "logo" field on each app is a CDN URL of the form
 * https://logos.composio.dev/api/<appKey>. We match a CONNECTOR_CATALOG
 * entry by its `composioAppName` override (PR 4) or, failing that, by a
 * small hand-curated alias map for catalog keys whose logo CDN slug
 * diverges from Composio's OAuth slug (e.g. "microsoft-teams" oauth
 * uses "microsoftteams" but the logo CDN serves "microsoft_teams").
 *
 * Usage:
 *   COMPOSIO_API_KEY=ak_... npx tsx scripts/sync-composio-logos.ts
 *
 * Idempotent: stdout-only, never writes files. Re-run quarterly or after
 * Composio adds a notable toolkit. Diff the output against the current
 * catalog.ts to spot new logos.
 */

import { CONNECTOR_CATALOG, composioAppNameFor } from "../src/lib/connections/catalog";

type ComposioApp = {
  key: string;
  logo?: string;
};

/**
 * Aliases for catalog keys whose logo CDN slug differs from both their
 * `key` and their `composioAppName` (OAuth) override. These were
 * discovered by curl-testing https://logos.composio.dev/api/<slug>
 * against the catalog. Keep this list small; the right long-term fix is
 * the override field on CatalogEntry.
 */
const SLUG_ALIASES: Record<string, string> = {
  "microsoft-teams": "microsoft_teams",
  "google-calendar": "googlecalendar",
  "google-analytics": "google_analytics",
  "google-drive": "googledrive",
  "cal-com": "cal",
  perplexity: "perplexityai",
  meta: "metaads",
  activecampaign: "active_campaign",
  onedrive: "one_drive",
  twitter: "twitter",
};

async function main(): Promise<void> {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) {
    console.error("COMPOSIO_API_KEY missing - export it before running");
    process.exit(2);
  }

  const res = await fetch(
    "https://backend.composio.dev/api/v1/apps?limit=500",
    { headers: { "x-api-key": key } },
  );
  if (!res.ok) {
    console.error(`Composio /apps ${res.status} ${res.statusText}`);
    process.exit(3);
  }
  const json = (await res.json()) as { items: ComposioApp[] };
  const apps = json.items ?? [];
  const bySlug = new Map<string, ComposioApp>();
  for (const a of apps) {
    if (a?.key) bySlug.set(a.key.toLowerCase(), a);
  }

  let matched = 0;
  let missed = 0;
  const lines: string[] = [];

  for (const entry of CONNECTOR_CATALOG) {
    // Resolution order: SLUG_ALIASES (logo-CDN-specific override) ->
    // composioAppNameFor (OAuth slug, often the same) -> entry.key.
    const aliased = SLUG_ALIASES[entry.key];
    const oauthSlug = composioAppNameFor(entry.key).toLowerCase();
    const candidates = [aliased, oauthSlug, entry.key.toLowerCase()].filter(
      Boolean,
    ) as string[];
    let resolved: string | null = null;
    for (const c of candidates) {
      if (bySlug.has(c)) {
        resolved = c;
        break;
      }
    }
    if (!resolved) {
      missed += 1;
      lines.push(
        `  // ${entry.key}: no Composio app match (slugs tried: ${candidates.join(", ")}) - falls back to letter avatar`,
      );
      continue;
    }
    const app = bySlug.get(resolved)!;
    matched += 1;
    const url =
      app.logo && app.logo.startsWith("http")
        ? app.logo
        : `https://logos.composio.dev/api/${resolved}`;
    lines.push(`  { key: "${entry.key}", logoUrl: "${url}" },`);
  }

  console.log("// scripts/sync-composio-logos.ts output");
  console.log(
    `// matched=${matched} missed=${missed} (${apps.length} apps in Composio)`,
  );
  console.log("// Paste the URLs into src/lib/connections/catalog.ts");
  console.log("");
  console.log("const COMPOSIO_LOGO_URLS: Record<string, string> = {");
  for (const e of CONNECTOR_CATALOG) {
    const aliased = SLUG_ALIASES[e.key];
    const oauthSlug = composioAppNameFor(e.key).toLowerCase();
    const candidates = [aliased, oauthSlug, e.key.toLowerCase()].filter(
      Boolean,
    ) as string[];
    let resolved: string | null = null;
    for (const c of candidates) {
      if (bySlug.has(c)) {
        resolved = c;
        break;
      }
    }
    if (!resolved) continue;
    const app = bySlug.get(resolved)!;
    const url =
      app.logo && app.logo.startsWith("http")
        ? app.logo
        : `https://logos.composio.dev/api/${resolved}`;
    console.log(`  "${e.key}": "${url}",`);
  }
  console.log("};");
  console.log("");
  console.log("// per-entry block (copy individual lines):");
  for (const l of lines) console.log(l);

  console.error(
    `[sync-composio-logos] matched=${matched} missed=${missed} catalog=${CONNECTOR_CATALOG.length}`,
  );
}

main().catch((err) => {
  console.error("[sync-composio-logos] fatal", err);
  process.exit(1);
});
