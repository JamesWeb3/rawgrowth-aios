"use client";

import { useState } from "react";
import {
  SiGmail,
  SiGoogledrive,
  SiGithub,
  SiSupabase,
  SiVercel,
} from "react-icons/si";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IntegrationConnectionSheet } from "@/components/integration-connection-sheet";
import { useConnections } from "@/lib/connections/use-connections";

/**
 * The "workspace tools" cards on /connections  -  Gmail, Google Drive,
 * GitHub. Each card opens the existing IntegrationConnectionSheet which
 * runs the Nango Connect UI flow.
 *
 * Once connected, the bot tokens / OAuth credentials live in Nango (we
 * just store the connection_id reference in rgaios_connections). Tools
 * built on top of these (gmail.list_messages, drive.search, etc.) call
 * the Nango proxy with the org's organization_id as end_user, so the
 * right credential is picked up automatically.
 */

const TOOLS: Array<{
  id: string;
  name: string;
  description: string;
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  brand: string;
}> = [
  {
    id: "gmail",
    name: "Gmail",
    description: "Read + send email as the connected user.",
    Icon: SiGmail,
    brand: "#EA4335",
  },
  {
    id: "google-drive",
    name: "Google Drive",
    description: "Files, folders, and shared drives.",
    Icon: SiGoogledrive,
    brand: "#1FA463",
  },
  {
    id: "github",
    name: "GitHub",
    description: "Repos, PRs, issues, code search.",
    Icon: SiGithub,
    brand: "#181717",
  },
  {
    id: "supabase",
    name: "Supabase",
    description: "Postgres, auth, storage.",
    Icon: SiSupabase,
    brand: "#3ECF8E",
  },
  {
    id: "vercel",
    name: "Vercel",
    description: "Deployments, projects, env vars, and logs.",
    Icon: SiVercel,
    brand: "#FFFFFF",
  },
];

export function WorkspaceToolsSection() {
  const { byIntegrationId } = useConnections();
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TOOLS.map((tool) => {
          const conn = byIntegrationId(tool.id);
          const connected = Boolean(conn);
          const display =
            (conn as { display_name?: string | null } | undefined)
              ?.display_name ?? null;
          return (
            <Card key={tool.id} className="border-border bg-card/50">
              <CardContent className="flex items-center gap-3 p-4">
                <div
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border"
                  style={{ backgroundColor: `${tool.brand}1a` }}
                >
                  <tool.Icon
                    className="size-5"
                    style={{
                      color: tool.brand === "#181717" ? "#fff" : tool.brand,
                    }}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-foreground">
                      {tool.name}
                    </span>
                    {connected && (
                      <Badge
                        variant="secondary"
                        className="bg-primary/15 text-[10px] text-primary"
                      >
                        Connected
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                    {connected && display ? display : tool.description}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={connected ? "secondary" : "default"}
                  className={
                    connected
                      ? "bg-white/5 text-foreground hover:bg-white/10"
                      : "btn-shine bg-primary text-white hover:bg-primary/90"
                  }
                  onClick={() => setOpenId(tool.id)}
                >
                  {connected ? "Manage" : "Connect"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <IntegrationConnectionSheet
        integrationId={openId}
        open={openId !== null}
        onOpenChange={(o) => {
          if (!o) setOpenId(null);
        }}
      />
    </>
  );
}
