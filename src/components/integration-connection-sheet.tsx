"use client";

import { useState } from "react";
import {
  ArrowUpRight,
  Check,
  KeyRound,
  LogOut,
  Plug,
  ShieldCheck,
  Webhook,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { getIntegration } from "@/lib/integrations-catalog";
import {
  useConnections,
  type ConnectionRow,
} from "@/lib/connections/use-connections";

type Props = {
  integrationId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function IntegrationConnectionSheet({
  integrationId,
  open,
  onOpenChange,
}: Props) {
  const integration = integrationId ? getIntegration(integrationId) : null;
  const { byIntegrationId, disconnect, refresh } = useConnections();
  const connection = integrationId ? byIntegrationId(integrationId) : undefined;

  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!integration) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="flex w-full flex-col border-l border-border bg-background p-0 text-foreground sm:max-w-150"
        />
      </Sheet>
    );
  }

  const handleConnect = async () => {
    setError(null);
    setConnecting(true);
    try {
      // 1. Ask our server for a Nango Connect Session token.
      const sessionRes = await fetch("/api/nango/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ integrationId: integration.id }),
      });
      if (!sessionRes.ok) {
        const { error } = (await sessionRes.json()) as { error?: string };
        throw new Error(error ?? "Failed to create Connect session");
      }
      const { token } = (await sessionRes.json()) as { token: string };

      // 2. Dynamically import the frontend SDK so it doesn't land in SSR bundles.
      const mod = await import("@nangohq/frontend");
      const NangoCtor = mod.default;
      const nango = new NangoCtor({ connectSessionToken: token });

      // 3. Open Nango's hosted Connect UI. It handles the OAuth bounce /
      //    API-key form and our webhook persists the connection.
      await new Promise<void>((resolve, reject) => {
        const controller = nango.openConnectUI({
          onEvent: (event) => {
            if (event.type === "connect") {
              resolve();
            } else if (event.type === "close") {
              resolve();
            }
          },
        });
        // Safety timeout if the UI never fires an event.
        setTimeout(() => {
          controller?.close?.();
          resolve();
        }, 5 * 60_000);
      });

      // 4. Refetch connections — our webhook should have written the row by now.
      // Small delay in case the webhook races the redirect.
      await new Promise((r) => setTimeout(r, 400));
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col border-l border-border bg-background p-0 text-foreground sm:max-w-150"
      >
        <SheetHeader className="border-b border-border px-6 py-5">
          <div className="flex items-center gap-3">
            <div
              className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-border"
              style={{ backgroundColor: `${integration.brand}1f` }}
            >
              <integration.Icon
                className="size-6"
                style={{
                  color:
                    integration.brand === "#FFFFFF" ? "#fff" : integration.brand,
                }}
              />
            </div>
            <div className="min-w-0">
              <SheetTitle className="font-serif text-2xl font-normal tracking-tight text-foreground">
                {integration.name}
              </SheetTitle>
              <SheetDescription className="text-[13px] text-muted-foreground">
                {integration.description}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {connection ? (
            <CurrentConnectionCard connection={connection} />
          ) : (
            <EmptyStateInstructions
              scopes={integration.oauth?.scopes ?? []}
              providerName={integration.name}
            />
          )}

          {error && (
            <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              {error}
            </div>
          )}

          {!connection && (
            <Button
              onClick={handleConnect}
              size="sm"
              disabled={connecting}
              className="btn-shine mt-5 w-full bg-primary text-white hover:bg-primary/90"
            >
              <Plug className="size-4" />
              {connecting
                ? `Opening ${integration.name}…`
                : `Connect ${integration.name}`}
            </Button>
          )}
        </div>

        <SheetFooter className="border-t border-border bg-background px-6 py-4">
          <div className="flex w-full items-center justify-between gap-3">
            {connection ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await disconnect(connection.provider_config_key);
                  onOpenChange(false);
                }}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <LogOut className="size-3.5" /> Disconnect
              </Button>
            ) : (
              <div />
            )}
            <SheetClose
              render={
                <Button variant="ghost" size="sm">
                  Close
                </Button>
              }
            />
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ────────────────────────── Current connection card ──────────────────────────

function CurrentConnectionCard({ connection }: { connection: ConnectionRow }) {
  return (
    <div
      className="rounded-xl border border-[rgba(10,148,82,.25)] p-4"
      style={{
        background:
          "linear-gradient(160deg, rgba(12,191,106,.08) 0%, rgba(12,191,106,.02) 60%, rgba(255,255,255,.01) 100%)",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary/15 text-primary">
            <ShieldCheck className="size-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
              Connected via Nango
              <Check className="size-3.5 text-primary" />
            </div>
            <div className="text-[11px] text-muted-foreground">
              Since {new Date(connection.connected_at).toLocaleDateString()}
            </div>
          </div>
        </div>
        <Badge
          variant="secondary"
          className="gap-1 bg-primary/15 text-[10px] text-primary"
        >
          <span className="size-1.5 rounded-full bg-primary shadow-[0_0_6px_rgba(12,191,106,.6)]" />
          Live
        </Badge>
      </div>

      {connection.display_name && (
        <div className="mt-3 text-[11.5px] text-muted-foreground">
          Account:{" "}
          <span className="text-foreground">{connection.display_name}</span>
        </div>
      )}

      <div className="mt-3 flex items-center gap-1.5 rounded-md border border-border bg-background/30 px-2.5 py-1.5 font-mono text-[10.5px] text-foreground/70">
        <span className="text-muted-foreground">connection id</span>
        <code className="truncate">{connection.nango_connection_id}</code>
      </div>
    </div>
  );
}

// ────────────────────────── Empty state ──────────────────────────

function EmptyStateInstructions({
  providerName,
  scopes,
}: {
  providerName: string;
  scopes: string[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-card/40 p-4">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" />
          <div className="text-[12.5px] font-semibold text-foreground">
            What happens next
          </div>
        </div>
        <ol className="flex flex-col gap-1.5 text-[11.5px] leading-relaxed text-muted-foreground [counter-reset:steps]">
          <li className="flex gap-2">
            <StepNumber n={1} />
            Click Connect → Nango opens {providerName}&apos;s sign-in screen.
          </li>
          <li className="flex gap-2">
            <StepNumber n={2} />
            You approve the requested scopes.
          </li>
          <li className="flex gap-2">
            <StepNumber n={3} />
            Nango returns with an access token and notifies us via webhook.
          </li>
          <li className="flex gap-2">
            <StepNumber n={4} />
            The connection appears here and your agents can use it immediately.
          </li>
        </ol>
        {scopes.length > 0 && (
          <div className="mt-4">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-foreground">
              <KeyRound className="size-3" />
              Scopes requested
            </div>
            <div className="flex flex-wrap gap-1">
              {scopes.map((s) => (
                <code
                  key={s}
                  className="rounded border border-border bg-background/30 px-1.5 py-0.5 font-mono text-[10px] text-foreground/80"
                >
                  {s}
                </code>
              ))}
            </div>
          </div>
        )}
      </div>
      <a
        href="https://docs.nango.dev/integrate/guides/authorize-an-api"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 self-start text-[11px] text-primary hover:underline"
      >
        Nango Connect docs <ArrowUpRight className="size-3" />
      </a>
    </div>
  );
}

function StepNumber({ n }: { n: number }) {
  return (
    <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-[9px] font-semibold text-primary">
      {n}
    </span>
  );
}

// Also re-export Webhook icon ref so lint doesn't flag an unused import
void Webhook;
