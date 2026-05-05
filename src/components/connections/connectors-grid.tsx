"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { IntegrationConnectionSheet } from "@/components/integration-connection-sheet";
import { useConnections } from "@/lib/connections/use-connections";
import { providerConfigKeyFor } from "@/lib/nango/providers";
import {
  CATALOG_CATEGORIES,
  CONNECTOR_CATALOG,
  type CatalogCategory,
  type CatalogEntry,
} from "@/lib/connections/catalog";

/**
 * Composio-style searchable grid of every connector this workspace can
 * eventually plug in. Native integrations open their existing OAuth /
 * key flow; everything else POSTs to /api/connections/composio so we
 * can record interest until the Composio bridge is live.
 */

type CategoryFilter = (typeof CATALOG_CATEGORIES)[number];

export function ConnectorsGrid() {
  const { connections, isConnected } = useConnections();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("All");
  const [openIntegrationId, setOpenIntegrationId] = useState<string | null>(
    null,
  );
  const [requesting, setRequesting] = useState<string | null>(null);

  /**
   * A non-native catalog entry is "connected" when a row exists in
   * rgaios_connections matching its key (the Composio bridge will write
   * that row using the same provider_config_key).
   */
  const connectedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const c of connections) {
      set.add(c.provider_config_key);
    }
    return set;
  }, [connections]);

  const isCardConnected = (entry: CatalogEntry): boolean => {
    if (entry.hasNativeIntegration) {
      return isConnected(entry.key);
    }
    return connectedKeys.has(entry.key);
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
    if (entry.hasNativeIntegration) {
      // Existing integrations route through the Nango Connect sheet
      // (or, for Telegram / Slack OAuth / Stripe / Supabase PAT, the
      // sheet branches internally on connectStrategy + methods).
      const supportedByNango = providerConfigKeyFor(entry.key) !== null;
      if (supportedByNango) {
        setOpenIntegrationId(entry.key);
      } else {
        toast.message("Open the dedicated card on this page to connect.");
      }
      return;
    }
    // Coming via Composio - log interest server-side.
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
      };
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to record interest");
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

      <IntegrationConnectionSheet
        integrationId={openIntegrationId}
        open={openIntegrationId !== null}
        onOpenChange={(o) => {
          if (!o) setOpenIntegrationId(null);
        }}
      />
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
          <div
            className="flex size-10 shrink-0 items-center justify-center rounded-lg font-mono text-[15px] font-semibold ring-1 ring-black/10"
            style={{ backgroundColor: entry.brandColor, color: fg }}
            aria-hidden
          >
            {initial}
          </div>
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
