"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useConnections } from "@/lib/connections/use-connections";
import {
  CATALOG_CATEGORIES,
  CONNECTOR_CATALOG,
  type CatalogEntry,
} from "@/lib/connections/catalog";
import { AllAppsModal } from "@/components/connections/all-apps-modal";

/**
 * Searchable connector grid. Pedro removed Nango on 2026-05-07 so
 * every catalog entry now POSTs to /api/connections/composio. Bespoke
 * providers (Telegram bot tokens, Stripe API keys, Supabase PATs)
 * still surface dedicated cards elsewhere on /connections; the grid
 * delegates to Composio for everything else.
 */

type CategoryFilter = (typeof CATALOG_CATEGORIES)[number];

export function ConnectorsGrid() {
  const { connections, refresh } = useConnections();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("All");
  const [requesting, setRequesting] = useState<string | null>(null);

  /**
   * Two buckets per catalog entry (Chris's bugs 1 + 5, 2026-05-12):
   *   - connectedKeys     → status='connected'
   *   - pendingKeys       → status='pending_token' (user clicked Connect
   *                         but hasn't finished OAuth on Composio side)
   *
   * Composio's v3 OAuth flow ends on a "Successfully connected" page that
   * doesn't auto-redirect back here. We now show a "Connecting…" badge
   * for pending rows + auto-refresh every 5s while any pending row
   * exists, so the badge flips to Connected once Composio's server-side
   * callback fires (which IS reliable even when the redirect isn't).
   */
  const connectedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const c of connections) {
      if (c.status !== "connected") continue;
      set.add(c.provider_config_key);
    }
    return set;
  }, [connections]);

  const pendingKeys = useMemo(() => {
    const set = new Set<string>();
    for (const c of connections) {
      if (c.status !== "pending_token") continue;
      set.add(c.provider_config_key);
    }
    return set;
  }, [connections]);

  const isCardConnected = (entry: CatalogEntry): boolean => {
    return (
      connectedKeys.has(entry.key) ||
      connectedKeys.has(`composio:${entry.key}`) ||
      // Bespoke API-key connectors store their row under `${key}-key`
      // (e.g. apify → apify-key) via the Workspace API keys card.
      connectedKeys.has(`${entry.key}-key`)
    );
  };

  const isCardPending = (entry: CatalogEntry): boolean => {
    return (
      pendingKeys.has(entry.key) ||
      pendingKeys.has(`composio:${entry.key}`)
    );
  };

  // Auto-poll while pending rows exist. Two-step every 5s:
  //   1. POST /api/connections/composio/sync-pending — hits Composio's
  //      GET /api/v3/connected_accounts/{id} for each pending row and
  //      flips status='connected' if Composio reports ACTIVE. This is
  //      the server-side workaround for Composio v3 not honoring our
  //      callback_url (Chris bug 1).
  //   2. refresh() — refetches /api/connections so the UI badge updates.
  useEffect(() => {
    if (pendingKeys.size === 0) return;
    const id = setInterval(async () => {
      try {
        await fetch("/api/connections/composio/sync-pending", {
          method: "POST",
        });
      } catch {
        /* tolerate transient errors; SWR retry next cycle */
      }
      void refresh();
    }, 5000);
    return () => clearInterval(id);
  }, [pendingKeys.size, refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CONNECTOR_CATALOG.filter((entry) => {
      if (category !== "All" && entry.category !== category) return false;
      if (!q) return true;
      return (
        entry.name.toLowerCase().includes(q) ||
        entry.key.toLowerCase().includes(q) ||
        entry.category.toLowerCase().includes(q)
      );
    });
  }, [query, category]);

  const handleConnect = async (entry: CatalogEntry) => {
    // Bespoke connectors (Telegram, Stripe key, Supabase PAT, Apify
    // token) live on dedicated cards elsewhere on /connections - bounce
    // the operator there instead of running through the Composio OAuth
    // path that doesn't apply to them. Apify in particular is a
    // standalone API (api.apify.com), not a Composio app.
    if (
      entry.key === "telegram" ||
      entry.key === "stripe" ||
      entry.key === "supabase" ||
      entry.key === "apify"
    ) {
      toast.message(
        `Use the dedicated ${entry.name} card on this page to connect.`,
      );
      return;
    }
    setRequesting(entry.key);
    try {
      const res = await fetch("/api/connections/composio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: entry.key }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        redirectUrl?: string;
        pending?: boolean;
      };
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to record interest");
      }
      // Real Composio path returns a redirectUrl. Open in a popup
      // (Chris's bug 1 follow-up): Composio v3's "Successfully connected"
      // static page doesn't auto-redirect back. If we send the user
      // there via window.location.assign, our /connections tab is gone
      // and the auto-poll can't update the badge. Popup keeps the main
      // tab alive + polling; when the row flips status='connected'
      // (server-side via /api/connections/composio/sync-pending), the
      // badge updates without operator action. Popup-blocker fallback:
      // if window.open returns null, fall back to same-tab redirect.
      if (json.redirectUrl) {
        toast.success(`${entry.name} - opening OAuth in new window`);
        const w = window.open(
          json.redirectUrl,
          "rawgrowth-composio-oauth",
          "width=480,height=720,noopener=no,noreferrer=no",
        );
        if (!w) {
          // Popup blocked - degrade to same-tab redirect so OAuth
          // still completes.
          window.location.assign(json.redirectUrl);
        }
        return;
      }
      // pending=true means the backend recorded interest but couldn't
      // start a real OAuth flow (no Composio key). The previous quiet
      // toast.success was easy to miss. Surface it as a warning that
      // names the fix so the operator doesn't think the click did
      // nothing (e2e audit found this dead-air UX).
      if (json.pending) {
        toast.warning(
          `${entry.name} - Composio API key not set. Paste a key in the Composio card at the top of this page, then click Connect again.`,
          { duration: 8000 },
        );
        return;
      }
      toast.success(json.message ?? `${entry.name} - request recorded`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRequesting(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Search + category chips */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search 400+ apps..."
            className="h-10 pl-9 text-[13px]"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CATALOG_CATEGORIES.map((cat) => {
            const active = cat === category;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={
                  "rounded-full border px-3 py-1 text-[11.5px] font-medium transition-colors " +
                  (active
                    ? "border-primary/40 bg-primary/15 text-primary"
                    : "border-border bg-card/40 text-muted-foreground hover:bg-white/5 hover:text-foreground")
                }
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* Result count */}
      <div className="text-[11.5px] text-muted-foreground">
        {filtered.length} {filtered.length === 1 ? "app" : "apps"}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        {filtered.map((entry) => (
          <ConnectorCard
            key={entry.key}
            entry={entry}
            connected={isCardConnected(entry)}
            pending={isCardPending(entry)}
            requesting={requesting === entry.key}
            onConnect={() => handleConnect(entry)}
          />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-background/30 px-4 py-8 text-center text-[12.5px] text-muted-foreground">
          No apps match. Try a different category or clear the search.
        </div>
      )}

      {/* Browse-all entrypoint. Opens AllAppsModal which fetches the
          live Composio toolkit catalog (~200+ apps) so operators can
          connect anything that isn't in the curated grid above. */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border bg-background/30 px-4 py-3">
        <div className="text-[11.5px] text-muted-foreground">
          Don&apos;t see your app? Browse Composio&apos;s full catalog of 200+ integrations.
        </div>
        <AllAppsModal />
      </div>
    </div>
  );
}

function ConnectorCard({
  entry,
  connected,
  pending,
  requesting,
  onConnect,
}: {
  entry: CatalogEntry;
  connected: boolean;
  pending: boolean;
  requesting: boolean;
  onConnect: () => void;
}) {
  const initial = entry.name.charAt(0).toUpperCase();
  const fg = readableForeground(entry.brandColor);
  // Track per-card logo failure so a 404 / network error from
  // logos.composio.dev silently demotes to the letter-avatar fallback
  // instead of leaving a broken-image icon. Bespoke entries (telegram,
  // supabase, vercel) and a handful of apps Composio's CDN doesn't host
  // (anthropic, s3, zapier, webhook) ship `logoUrl` undefined, so they
  // skip the <img> branch entirely.
  const [logoFailed, setLogoFailed] = useState(false);
  const showLogo = Boolean(entry.logoUrl) && !logoFailed;
  return (
    <Card
      className={
        "group relative overflow-hidden border bg-card/40 transition-colors duration-150 hover:bg-card/70 " +
        (connected ? "border-primary/30" : "border-border hover:border-border")
      }
    >
      {connected && (
        <span
          className="absolute right-0 top-0 size-2 translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-400"
          aria-hidden
        />
      )}
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          {showLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={entry.logoUrl}
              alt={`${entry.name} logo`}
              loading="lazy"
              onError={() => setLogoFailed(true)}
              className="size-10 shrink-0 rounded-md bg-white object-contain p-1 ring-1 ring-black/10"
            />
          ) : (
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-lg font-mono text-[15px] font-semibold ring-1 ring-black/10"
              style={{ backgroundColor: entry.brandColor, color: fg }}
              aria-hidden
            >
              {initial}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-foreground">
              {entry.name}
            </span>
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="capitalize">{entry.category}</span>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-muted-foreground/70">
                {entry.hasNativeIntegration ? "Native" : "Composio"}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          {connected ? (
            <Badge
              variant="secondary"
              className="bg-emerald-400/10 text-[10px] font-medium uppercase tracking-[1px] text-emerald-400"
            >
              Connected
            </Badge>
          ) : pending ? (
            <Badge
              variant="secondary"
              className="bg-amber-400/10 text-[10px] font-medium uppercase tracking-[1px] text-amber-400"
            >
              Connecting...
            </Badge>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={requesting}
              className="h-7 border-border text-[11px] hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
              onClick={onConnect}
            >
              {requesting
                ? "Sending..."
                : entry.hasNativeIntegration
                  ? "Connect"
                  : "Request"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Picks black or white text for an arbitrary brand hex so the letter
 * avatar stays legible without us hand-tuning each entry.
 */
function readableForeground(hex: string): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return "#fff";
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  // Relative luminance per WCAG 2.x.
  const lum =
    (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.6 ? "#0F172A" : "#FFFFFF";
}
