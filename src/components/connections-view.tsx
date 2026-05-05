"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  Check,
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClaudeConnectionCard } from "@/components/connections/claude-card";
import { ConnectorsGrid } from "@/components/connections/connectors-grid";
import { CreateClientSheet } from "@/components/admin/create-client-sheet";
import { jsonFetcher } from "@/lib/swr";

/**
 * Connections - cleaned up per Chris's v3 spec:
 *
 *   1. Claude Max          (powers the VPS-side 24/7 agent runtime)
 *   2. Rawgrowth MCP       (URL + bearer for Claude Desktop / Cursor / Code)
 *   3. Apps grid           (Composio-style searchable catalog of 400+
 *                           apps. Native integrations open the existing
 *                           OAuth / API key flow; the rest queue an
 *                           interest record server-side.)
 *
 * The old workspace-tools / analytics / messaging-channels sections were
 * folded into the grid - one place to find any connector, native or not.
 */

type OrgMe = {
  org: {
    id: string;
    name: string;
    slug: string;
    mcp_token: string | null;
    created_at: string;
  };
  isAdmin: boolean;
  isImpersonating: boolean;
};

export function ConnectionsView() {
  return (
    <div className="space-y-10">
      {/* 1. Claude Max */}
      <section>
        <SectionHeading
          title="Claude Max"
          subtitle="Your subscription powering the VPS-side agents (24/7 Telegram + scheduled routines)."
        />
        <ClaudeConnectionCard />
      </section>

      {/* 2. Rawgrowth MCP */}
      <section>
        <SectionHeading
          title="Rawgrowth MCP"
          subtitle="Connect Claude Desktop, Cursor, or Claude Code to this workspace."
        />
        <McpCard />
      </section>

      {/* 3. Apps */}
      <section>
        <SectionHeading
          title="Apps"
          subtitle="Search 400+ apps. Native integrations connect immediately; the rest queue via Composio."
        />
        <ConnectorsGrid />
      </section>
    </div>
  );
}

function SectionHeading({
  title,
  subtitle,
  inline,
}: {
  title: string;
  subtitle?: string;
  inline?: boolean;
}) {
  return (
    <div className={inline ? undefined : "mb-3"}>
      <h3 className="text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground">
        {title}
      </h3>
      {subtitle && (
        <p className="mt-1 text-[12px] text-muted-foreground/80">{subtitle}</p>
      )}
    </div>
  );
}

function McpCard() {
  const { data, isLoading, mutate } = useSWR<OrgMe>(
    "/api/org/me",
    jsonFetcher,
  );
  const [rotating, setRotating] = useState(false);
  const [creating, setCreating] = useState(false);

  const org = data?.org;
  const isAdmin = data?.isAdmin ?? false;

  const rotate = async () => {
    if (!org) return;
    if (
      !confirm(
        `Rotate the MCP token for ${org.name}?\n\nThe old token stops working immediately - any Claude Desktop / Cursor config still using it will lose access until you paste in the new one.`,
      )
    )
      return;
    setRotating(true);
    try {
      const res = await fetch(`/api/admin/clients/${org.id}/rotate-token`, {
        method: "POST",
      });
      if (!res.ok) {
        const { error } = (await res.json()) as { error?: string };
        throw new Error(error ?? "rotate failed");
      }
      toast.success("Token rotated");
      await mutate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRotating(false);
    }
  };

  if (isLoading || !org) {
    return <Card className="h-72 animate-pulse border-border bg-card/40" />;
  }

  const mcpUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/mcp`
      : "https://.../api/mcp";

  const configJson = `{
  "mcpServers": {
    "rawgrowth-${org.slug}": {
      "url": "${mcpUrl}",
      "headers": {
        "Authorization": "Bearer ${org.mcp_token ?? "<token>"}"
      }
    }
  }
}`;

  const clientPath = (() => {
    return {
      "claude-desktop": "~/Library/Application Support/Claude/claude_desktop_config.json",
      "cursor": "~/.cursor/mcp.json",
      "claude-code": "~/.claude.json (servers section)",
    };
  })();
  const tokenMasked = org.mcp_token
    ? org.mcp_token.slice(0, 8) + "..." + org.mcp_token.slice(-4)
    : "(not generated yet)";

  return (
    <>
      {isAdmin && (
        <div className="mb-3 flex items-center justify-end">
          <Button
            onClick={() => setCreating(true)}
            size="sm"
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="size-3.5" />
            New client
          </Button>
        </div>
      )}

      <Card className="overflow-hidden border-border bg-card/40">
        <CardContent className="space-y-5 p-5">
          {/* header */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-serif text-[20px] leading-none tracking-tight text-foreground">
                  {org.name}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                  <span className="size-1.5 rounded-full bg-emerald-400" />
                  Connected
                </span>
              </div>
              <p className="mt-1.5 text-[12px] text-muted-foreground">
                Endpoint + token below. Pick your client tab, copy the snippet, restart the app.
              </p>
            </div>
            <button
              type="button"
              onClick={rotate}
              disabled={rotating}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-background/50 px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw
                className={rotating ? "size-3 animate-spin" : "size-3"}
              />
              {rotating ? "Rotating" : "Rotate token"}
            </button>
          </div>

          {/* endpoint + token strip */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-md border border-border/60 bg-card/50 px-3 py-2.5">
              <p className="text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground">
                Endpoint
              </p>
              <p className="mt-1 truncate font-mono text-[12px] text-foreground">
                {mcpUrl}
              </p>
            </div>
            <div className="rounded-md border border-border/60 bg-card/50 px-3 py-2.5">
              <p className="text-[10px] font-medium uppercase tracking-[1.5px] text-muted-foreground">
                Token
              </p>
              <p className="mt-1 truncate font-mono text-[12px] text-foreground">
                {tokenMasked}
              </p>
            </div>
          </div>

          {/* client tabs */}
          <McpClientTabs
            configJson={configJson}
            paths={clientPath}
          />
        </CardContent>
      </Card>

      {isAdmin && (
        <CreateClientSheet
          open={creating}
          onOpenChange={setCreating}
          onCreated={() => mutate()}
        />
      )}
    </>
  );
}

function McpClientTabs({
  configJson,
  paths,
}: {
  configJson: string;
  paths: Record<string, string>;
}) {
  const [active, setActive] = useState<"claude-desktop" | "cursor" | "claude-code">("claude-desktop");
  const CLIENTS = [
    { id: "claude-desktop" as const, label: "Claude Desktop" },
    { id: "cursor" as const, label: "Cursor" },
    { id: "claude-code" as const, label: "Claude Code CLI" },
  ];
  return (
    <div>
      <div className="mb-2 flex items-center gap-1 rounded-md border border-border bg-card/50 p-1">
        {CLIENTS.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setActive(c.id)}
            className={
              "flex flex-1 items-center justify-center rounded px-3 py-1.5 text-[11px] font-medium transition-colors " +
              (active === c.id
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            {c.label}
          </button>
        ))}
      </div>
      <CopyBlock value={configJson} />
      <p className="mt-2 text-[11px] text-muted-foreground">
        Paste into{" "}
        <code className="rounded bg-muted/30 px-1 py-0.5 font-mono text-foreground/80">
          {paths[active]}
        </code>{" "}
        and restart the app.
      </p>
    </div>
  );
}

function CopyBlock({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Config copied");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border border-border bg-background/40 p-3 font-mono text-[11.5px] leading-relaxed text-foreground/85">
        {value}
      </pre>
      <button
        type="button"
        onClick={copy}
        className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        {copied ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </button>
    </div>
  );
}
