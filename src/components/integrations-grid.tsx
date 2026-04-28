"use client";

import { useState } from "react";
import { Check, KeyRound, ShieldCheck, Webhook } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IntegrationConnectionSheet } from "@/components/integration-connection-sheet";
import { INTEGRATIONS, methodLabel } from "@/lib/integrations-catalog";
import { useConnections } from "@/lib/connections/use-connections";

const methodIcon = {
  api_key: KeyRound,
  oauth: ShieldCheck,
  webhook: Webhook,
} as const;

export function IntegrationsGrid() {
  const { connections, loaded, byIntegrationId } = useConnections();
  const [activeId, setActiveId] = useState<string | null>(null);

  const connectedCount = connections.length;

  const sortedIntegrations = [...INTEGRATIONS].sort((a, b) => {
    const aConn = !!byIntegrationId(a.id) && loaded;
    const bConn = !!byIntegrationId(b.id) && loaded;
    if (aConn !== bConn) return aConn ? -1 : 1;
    return 0;
  });

  return (
    <>
      <div className="mb-5 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(10,148,82,.2)] bg-primary/10 px-2.5 py-1 font-medium text-primary">
          <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_6px_rgba(12,191,106,.6)]" />
          {loaded ? connectedCount : 0} connected
        </span>
        <span>•</span>
        <span>
          {INTEGRATIONS.length - (loaded ? connectedCount : 0)} available
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {sortedIntegrations.map((i) => {
          const conn = byIntegrationId(i.id);
          const isConnected = !!conn && loaded;
          return (
            <Card
              key={i.id}
              className="group relative overflow-hidden border-border bg-card/50 backdrop-blur-sm transition-[border-color,background-color] duration-300 hover:border-primary/30 hover:bg-card"
            >
              {isConnected && (
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-primary/40 to-transparent" />
              )}
              <CardContent className="flex h-full flex-col gap-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div
                    className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border"
                    style={{ backgroundColor: `${i.brand}1a` }}
                  >
                    <i.Icon
                      className="size-6"
                      style={{
                        color: i.brand === "#FFFFFF" ? "#fff" : i.brand,
                      }}
                    />
                  </div>
                  {isConnected ? (
                    <Badge
                      variant="secondary"
                      className="gap-1 bg-primary/10 text-primary hover:bg-primary/15"
                    >
                      <Check className="size-3" />
                      Connected
                    </Badge>
                  ) : (
                    <Badge
                      variant="secondary"
                      className="bg-white/5 text-muted-foreground"
                    >
                      {i.category}
                    </Badge>
                  )}
                </div>

                <div className="min-h-16">
                  <h3 className="text-[15px] font-semibold text-foreground">
                    {i.name}
                  </h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                    {i.description}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  {i.methods.map((m) => {
                    const Icon = methodIcon[m];
                    return (
                      <span
                        key={m}
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-background/30 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                      >
                        <Icon className="size-2.5" />
                        {methodLabel(m)}
                      </span>
                    );
                  })}
                </div>

                <Button
                  onClick={() => setActiveId(i.id)}
                  variant={isConnected ? "secondary" : "default"}
                  size="sm"
                  className={
                    isConnected
                      ? "w-full bg-white/5 text-foreground hover:bg-white/10"
                      : "btn-shine w-full bg-primary text-white hover:bg-primary/90"
                  }
                >
                  {isConnected ? "Manage" : "Connect"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <IntegrationConnectionSheet
        integrationId={activeId}
        open={!!activeId}
        onOpenChange={(o) => {
          if (!o) setActiveId(null);
        }}
      />
    </>
  );
}
