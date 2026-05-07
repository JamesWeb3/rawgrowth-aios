"use client";

import { useState } from "react";
import useSWR from "swr";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ClaudeConnectionCard } from "@/components/connections/claude-card";
import { ConnectorsGrid } from "@/components/connections/connectors-grid";
import { CreateClientSheet } from "@/components/admin/create-client-sheet";
import { jsonFetcher } from "@/lib/swr";

/**
 * Connections - cleaned up per Chris's v3 spec (May 7 video feedback):
 *
 *   1. Claude Max          (powers the VPS-side 24/7 agent runtime)
 *   2. Apps grid           (Composio-driven searchable catalog of 400+
 *                           apps. Native integrations open the existing
 *                           OAuth / API key flow; the rest queue an
 *                           interest record server-side.)
 *
 * The Rawgrowth MCP card was removed per Chris - clients shouldn't see
 * MCP wiring on this page. Admin token rotation + new-client lives in
 * /admin/provisioning. The "New client" admin button stays visible at
 * the top of this view for admins to keep the trial demo path one-click.
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
  const { data, mutate } = useSWR<OrgMe>("/api/org/me", jsonFetcher);
  const [creating, setCreating] = useState(false);
  const isAdmin = data?.isAdmin ?? false;

  return (
    <div className="space-y-10">
      {isAdmin && (
        <div className="flex items-center justify-end">
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

      {/* 1. Claude Max */}
      <section>
        <SectionHeading
          title="Claude Max"
          subtitle="Your subscription powering the VPS-side agents (24/7 Telegram + scheduled routines)."
        />
        <ClaudeConnectionCard />
      </section>

      {/* 2. Apps */}
      <section>
        <SectionHeading
          title="Apps"
          subtitle="Search 400+ apps. Native integrations connect immediately; the rest queue via Composio."
        />
        <ConnectorsGrid />
      </section>

      {isAdmin && (
        <CreateClientSheet
          open={creating}
          onOpenChange={setCreating}
          onCreated={() => mutate()}
        />
      )}
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
