"use client";

import { useMemo, useState } from "react";
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
  type CatalogCategory,
  type CatalogEntry,
} from "@/lib/connections/catalog";

/**
 * Searchable connector grid. Pedro removed Nango on 2026-05-07 so
 * every catalog entry now POSTs to /api/connections/composio. Bespoke
 * providers (Telegram bot tokens, Stripe API keys, Supabase PATs)
 * still surface dedicated cards elsewhere on /connections; the grid
 * delegates to Composio for everything else.
 */

type CategoryFilter = (typeof CATALOG_CATEGORIES)[number];

export function ConnectorsGrid() {
  const { connections } = useConnections();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("All");
  const [requesting, setRequesting] = useState<string | null>(null);

  /**
   * A non-native catalog entry is "connected" when a row exists in
   * rgaios_connections with status='connected' for either the bare key
   * or the composio-prefixed key. The Composio POST handler writes
   * provider_config_key=`composio:${key}`; older rows (and any future
   * Composio bridge rewrite) may store the bare key. We accept both so
   * the badge stays correct across migrations.
   */
  const connectedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const c of connections) {
      if (c.status !== "connected") continue;
      set.add(c.provider_config_key);
    }
    return set;
  }, [connections]);

  const isCardConnected = (entry: CatalogEntry): boolean => {
    return (
      connectedKeys.has(entry.key) ||
      connectedKeys.has(`composio:${entry.key}`)
    );
  };

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
    // Bespoke connectors (Telegram, Stripe key, Supabase PAT) live on
    // dedicated cards elsewhere on /connections - bounce the operator
    // there instead of running through the Composio OAuth path that
    // doesn't apply to them.
    if (
      entry.key === "telegram" ||
      entry.key === "stripe" ||
      entry.key === "supabase"
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
      };
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to record interest");
      }
      // Real Composio path returns a redirectUrl - send the operator to
      // the OAuth screen. Otherwise stay on /connections (interest log).
      if (json.redirectUrl) {
        toast.success(`${entry.name} - opening OAuth`);
        window.location.assign(json.redirectUrl);
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
    </div>
  );
}

function ConnectorCard({
  entry,
  connected,
  requesting,
  onConnect,
}: {
  entry: CatalogEntry;
  connected: boolean;
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
        "group relative overflow-hidden border bg-card/40 transition-all duration-150 hover:bg-card/70 " +
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
