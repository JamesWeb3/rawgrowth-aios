"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { jsonFetcher } from "@/lib/swr";
import { useConnections } from "@/lib/connections/use-connections";

/**
 * "Browse all Composio apps" modal. Opens from a trigger on
 * /connections, loads the live /api/connections/composio/browse list
 * (server-side fetch of every toolkit visible to this org's API key,
 * 5-min cached), and lets the operator Connect any app even if it
 * isn't in our hardcoded CONNECTOR_CATALOG.
 *
 * Status per row:
 *   - Connected (green badge)  - rgaios_connections row with
 *     provider_config_key = "composio:<slug>" + status='connected'.
 *   - Connecting... (amber)    - status='pending_token'.
 *   - Connect (button)         - everything else. POSTs to
 *     /api/connections/composio with the slug, opens the Composio
 *     OAuth popup (same flow as the hardcoded grid).
 *
 * Search + category filter mirror the connectors-grid UX so muscle
 * memory carries over.
 */

type BrowseItem = {
  slug: string;
  name: string;
  description: string | null;
  logo: string | null;
  category: string | null;
};

type BrowseResponse = {
  items: BrowseItem[];
  fetchedAt?: string;
  cached?: boolean;
  error?: string;
};

const BROWSE_KEY = "/api/connections/composio/browse";

export function AllAppsModal({
  triggerLabel = "Browse all Composio apps",
}: {
  /**
   * Trigger label. Defaults to the spec'd "Browse all Composio apps"
   * string; callers can override (e.g. for an alternate entrypoint).
   */
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);

  // Only fetch once the modal opens. SWR keeps the response cached
  // across opens (server enforces 5-min TTL anyway).
  const { data, isLoading, error, mutate } = useSWR<BrowseResponse>(
    open ? BROWSE_KEY : null,
    jsonFetcher,
    { revalidateOnFocus: false, dedupingInterval: 5 * 60 * 1000 },
  );

  const { connections, refresh } = useConnections();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [requesting, setRequesting] = useState<string | null>(null);

  // Mirror connectors-grid: bucket connections by status.
  const connectedSlugs = useMemo(() => {
    const set = new Set<string>();
    for (const c of connections) {
      if (c.status !== "connected") continue;
      // provider_config_key is "composio:<slug>" for everything routed
      // through Composio. Hardcoded native flows (e.g. Telegram) use
      // bare keys; either way we add both forms to the set so the
      // dynamic list matches in both shapes.
      set.add(c.provider_config_key);
      if (c.provider_config_key.startsWith("composio:")) {
        set.add(c.provider_config_key.slice("composio:".length));
      }
    }
    return set;
  }, [connections]);

  const pendingSlugs = useMemo(() => {
    const set = new Set<string>();
    for (const c of connections) {
      if (c.status !== "pending_token") continue;
      set.add(c.provider_config_key);
      if (c.provider_config_key.startsWith("composio:")) {
        set.add(c.provider_config_key.slice("composio:".length));
      }
    }
    return set;
  }, [connections]);

  // Memoize so the `[]` fallback isn't a fresh array per render -
  // otherwise downstream useMemo dependencies thrash.
  const items: BrowseItem[] = useMemo(() => data?.items ?? [], [data?.items]);

  // Distinct category list derived from the live data. "All" first,
  // then whatever categories Composio surfaced (sorted alphabetically).
  const categories: string[] = useMemo(() => {
    const set = new Set<string>();
    for (const i of items) {
      if (i.category) set.add(i.category);
    }
    return ["All", ...Array.from(set).sort()];
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (category !== "All" && i.category !== category) return false;
      if (!q) return true;
      return (
        i.name.toLowerCase().includes(q) ||
        i.slug.toLowerCase().includes(q) ||
        (i.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, query, category]);

  // Group filtered list by category for the rendered output. When the
  // user selects a specific category, just one bucket renders.
  const grouped = useMemo(() => {
    const map = new Map<string, BrowseItem[]>();
    for (const i of filtered) {
      const cat = i.category ?? "Other";
      const arr = map.get(cat) ?? [];
      arr.push(i);
      map.set(cat, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  // Refresh badges while a Connect popup is in-flight. Lighter than
  // wiring the full sync-pending poll here - the parent connectors-grid
  // already runs that. We just nudge SWR to pick up status flips.
  useEffect(() => {
    if (!open) return;
    if (pendingSlugs.size === 0) return;
    const id = setInterval(() => {
      void refresh();
    }, 5000);
    return () => clearInterval(id);
  }, [open, pendingSlugs.size, refresh]);

  async function handleConnect(item: BrowseItem) {
    setRequesting(item.slug);
    try {
      const res = await fetch("/api/connections/composio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: item.slug }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        redirectUrl?: string;
        pending?: boolean;
      };
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to start OAuth");
      }
      if (json.redirectUrl) {
        toast.success(`${item.name} - opening OAuth in new window`);
        const w = window.open(
          json.redirectUrl,
          "rawgrowth-composio-oauth",
          "width=480,height=720,noopener=no,noreferrer=no",
        );
        if (!w) {
          window.location.assign(json.redirectUrl);
        }
        return;
      }
      if (json.pending) {
        toast.warning(
          `${item.name} - Composio API key not set. Paste a key in the Composio card on this page, then click Connect again.`,
          { duration: 8000 },
        );
        return;
      }
      toast.success(json.message ?? `${item.name} - request recorded`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRequesting(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card/40 px-3 py-1.5 text-[11.5px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary">
        {triggerLabel}
        <span aria-hidden>{"→"}</span>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl"
      >
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle>Browse all Composio apps</SheetTitle>
          <SheetDescription>
            {data
              ? `${items.length} apps available via your Composio API key. Click Connect to start OAuth.`
              : "Loading live catalog from Composio..."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 border-b border-border px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, slug, or description..."
              className="h-9 pl-9 text-[12.5px]"
            />
          </div>
          {categories.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {categories.map((cat) => {
                const active = cat === category;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={
                      "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors " +
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
          )}
          <div className="text-[11px] text-muted-foreground">
            {isLoading
              ? "Loading..."
              : `${filtered.length} of ${items.length} ${items.length === 1 ? "app" : "apps"}`}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error || data?.error ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-6 text-center text-[12.5px] text-destructive">
              {data?.error ?? "Failed to load Composio catalog."}
              <div className="mt-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void mutate();
                  }}
                >
                  Retry
                </Button>
              </div>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              <span className="text-[12.5px]">Loading Composio catalog...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-background/30 px-4 py-8 text-center text-[12.5px] text-muted-foreground">
              No apps match. Try a different category or clear the search.
            </div>
          ) : (
            <div className="space-y-5">
              {grouped.map(([cat, rows]) => (
                <div key={cat} className="space-y-2">
                  <div className="text-[10px] font-medium uppercase tracking-[1.2px] text-muted-foreground">
                    {cat}
                  </div>
                  <div className="divide-y divide-border rounded-lg border border-border bg-card/30">
                    {rows.map((item) => (
                      <AppRow
                        key={item.slug}
                        item={item}
                        connected={connectedSlugs.has(item.slug) ||
                          connectedSlugs.has(`composio:${item.slug}`)}
                        pending={
                          pendingSlugs.has(item.slug) ||
                          pendingSlugs.has(`composio:${item.slug}`)
                        }
                        requesting={requesting === item.slug}
                        onConnect={() => handleConnect(item)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AppRow({
  item,
  connected,
  pending,
  requesting,
  onConnect,
}: {
  item: BrowseItem;
  connected: boolean;
  pending: boolean;
  requesting: boolean;
  onConnect: () => void;
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  const initial = item.name.charAt(0).toUpperCase();
  // Prefer Composio's `meta.logo` (returned by the toolkits endpoint),
  // fall back to the public CDN convention used by the hardcoded
  // catalog. Letter avatar if both fail.
  const logoSrc =
    item.logo ?? `https://logos.composio.dev/api/${item.slug}`;
  const showLogo = !logoFailed;
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      {showLogo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoSrc}
          alt={`${item.name} logo`}
          loading="lazy"
          onError={() => setLogoFailed(true)}
          className="size-8 shrink-0 rounded-md bg-white object-contain p-1 ring-1 ring-black/10"
        />
      ) : (
        <div
          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-slate-700 font-mono text-[12px] font-semibold text-white ring-1 ring-black/10"
          aria-hidden
        >
          {initial}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-medium text-foreground">
          {item.name}
        </div>
        <div className="truncate text-[10.5px] text-muted-foreground">
          {item.description ?? item.slug}
        </div>
      </div>
      <div className="shrink-0">
        {connected ? (
          <Badge
            variant="secondary"
            className="bg-emerald-400/10 text-[9.5px] font-medium uppercase tracking-[1px] text-emerald-400"
          >
            Connected
          </Badge>
        ) : pending ? (
          <Badge
            variant="secondary"
            className="bg-amber-400/10 text-[9.5px] font-medium uppercase tracking-[1px] text-amber-400"
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
            {requesting ? "Sending..." : "Connect"}
          </Button>
        )}
      </div>
    </div>
  );
}
