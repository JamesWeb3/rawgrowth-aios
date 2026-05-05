"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  ArrowUpRight,
  Bot,
  Check,
  KeyRound,
  LogOut,
  Plug,
  ShieldCheck,
  Webhook,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  getIntegration,
  type IntegrationEntry,
} from "@/lib/integrations-catalog";
import {
  useConnections,
  type ConnectionRow,
} from "@/lib/connections/use-connections";
import { jsonFetcher } from "@/lib/swr";

type TelegramStats = {
  connected: boolean;
  bot_id?: number | null;
  bot_username?: string | null;
  last_inbound_at?: string | null;
  last_outbound_at?: string | null;
  messages_today?: number;
  pending?: number;
};

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[1px] text-muted-foreground">
        {label}
      </div>
      <div
        className={
          "mt-0.5 font-mono text-[13px] " +
          (highlight ? "text-amber-400" : "text-foreground")
        }
      >
        {value}
      </div>
    </div>
  );
}

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

      // 3. Open Nango's hosted Connect UI and capture the payload fired on
      //    successful auth. The webhook also writes this row in prod, but
      //    relying on it alone breaks local dev  -  so we persist client-side.
      type ConnectPayload = {
        providerConfigKey?: string;
        connectionId?: string;
      };
      let captured: ConnectPayload | null = null;

      await new Promise<void>((resolve) => {
        const controller = nango.openConnectUI({
          onEvent: (event) => {
            if (event.type === "connect") {
              captured = (event.payload ?? null) as ConnectPayload | null;
              resolve();
            } else if (event.type === "close") {
              resolve();
            }
          },
        });
        setTimeout(() => {
          controller?.close?.();
          resolve();
        }, 5 * 60_000);
      });

      // 4. Persist the connection ourselves. The server re-fetches from Nango
      //    to prove it exists before writing the row.
      const payload = captured as ConnectPayload | null;
      if (payload?.providerConfigKey && payload?.connectionId) {
        const finalizeRes = await fetch("/api/connections/finalize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            providerConfigKey: payload.providerConfigKey,
            connectionId: payload.connectionId,
          }),
        });
        if (!finalizeRes.ok) {
          const { error } = (await finalizeRes
            .json()
            .catch(() => ({}))) as { error?: string };
          throw new Error(error ?? "Failed to persist connection");
        }
      }

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
            integration.connectStrategy === "telegram-bot" ? (
              <TelegramConnectedCard
                connection={connection}
                onRotated={refresh}
              />
            ) : (
              <CurrentConnectionCard connection={connection} />
            )
          ) : integration.connectStrategy === "telegram-bot" ? (
            <TelegramBotForm integration={integration} onConnected={refresh} />
          ) : integration.connectStrategy === "supabase-pat" ? (
            <SupabasePatForm integration={integration} onConnected={refresh} />
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

          {!connection &&
            integration.connectStrategy !== "telegram-bot" &&
            integration.connectStrategy !== "supabase-pat" && (
              <Button
                onClick={handleConnect}
                size="sm"
                disabled={connecting}
                className="mt-5 w-full bg-primary text-white hover:bg-primary/90"
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

// ────────────────────────── Telegram connected (masked + reveal + rotate) ──

function TelegramConnectedCard({
  connection,
  onRotated,
}: {
  connection: ConnectionRow;
  onRotated: () => void | Promise<void>;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reveal = async () => {
    if (revealed) {
      setRevealed(null);
      return;
    }
    setError(null);
    setRevealing(true);
    try {
      const res = await fetch("/api/connections/telegram/token");
      if (!res.ok) throw new Error("Failed to reveal token");
      const { token } = (await res.json()) as { token?: string };
      if (!token) throw new Error("Token not found");
      setRevealed(token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRevealing(false);
    }
  };

  const { data: stats } = useSWR<TelegramStats>(
    "/api/connections/telegram/stats",
    jsonFetcher,
    { refreshInterval: 15_000 },
  );

  const botId = stats?.bot_id ?? null;

  // Token format is "{bot_id}:{secret}". The bot_id half is public-ish
  // (anyone who messages the bot sees it), so showing it is safe and
  // gives the operator a recognisable preview without revealing the
  // secret half. Once revealed, show the full token.
  const tokenDisplay = (() => {
    if (revealed) return revealed;
    if (botId) return `${botId}:${"•".repeat(20)}`;
    return "•".repeat(28);
  })();

  return (
    <div className="space-y-4">
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
                Bot connected
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
      </div>

      {/* Activity panel  -  proves the bot is actually working */}
      {stats && stats.connected && (
        <div className="rounded-xl border border-border bg-card/30 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Webhook className="size-4 text-primary" />
            <div className="text-[12.5px] font-semibold text-foreground">
              Recent activity
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-[11.5px]">
            <Stat label="Last message in" value={relativeTime(stats.last_inbound_at)} />
            <Stat label="Last reply out" value={relativeTime(stats.last_outbound_at)} />
            <Stat label="Today" value={`${stats.messages_today ?? 0}`} />
            <Stat
              label="Pending replies"
              value={`${stats.pending ?? 0}`}
              highlight={(stats.pending ?? 0) > 0}
            />
          </div>
        </div>
      )}

      <div>
        <Label className="text-[12px] font-medium text-foreground">
          Bot token
        </Label>
        <div className="mt-1.5 flex items-stretch gap-2">
          <div className="flex-1 rounded-md border border-border bg-input/40 px-3 py-2 font-mono text-[12.5px] text-foreground/80">
            <span className="break-all">{tokenDisplay}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={reveal}
            disabled={revealing}
            className="shrink-0"
          >
            {revealing ? "…" : revealed ? "Hide" : "Reveal"}
          </Button>
          {revealed && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigator.clipboard?.writeText(revealed)}
              className="shrink-0"
            >
              Copy
            </Button>
          )}
        </div>
        <p className="mt-1.5 text-[10.5px] text-muted-foreground">
          Each reveal is recorded in your audit log.
        </p>
      </div>

      {rotating ? (
        <div className="rounded-xl border border-border bg-card/40 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Bot className="size-4 text-primary" />
            <div className="text-[12.5px] font-semibold text-foreground">
              Replace with a new token
            </div>
          </div>
          <RotateTokenForm
            onDone={async () => {
              setRotating(false);
              setRevealed(null);
              await onRotated();
            }}
            onCancel={() => setRotating(false)}
          />
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRotating(true)}
          className="w-full"
        >
          <KeyRound className="size-3.5" />
          Replace token
        </Button>
      )}

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}

function RotateTokenForm({
  onDone,
  onCancel,
}: {
  onDone: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [token, setToken] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!token.includes(":")) {
      setError("That doesn't look like a bot token.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/connections/telegram", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      if (!res.ok) {
        const { error: err } = (await res.json()) as { error?: string };
        throw new Error(err ?? "Failed to rotate");
      }
      await onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Input
        type={show ? "text" : "password"}
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="1234567890:AA…"
        className="bg-input/40 font-mono text-[12.5px]"
        autoComplete="off"
      />
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => setShow((s) => !s)}>
          {show ? "Hide" : "Show"}
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={busy}
            className="bg-primary text-white hover:bg-primary/90"
          >
            {busy ? "Rotating…" : "Rotate"}
          </Button>
        </div>
      </div>
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}

// ────────────────────────── Supabase PAT form ──────────────────────────

function SupabasePatForm({
  integration,
  onConnected,
}: {
  integration: IntegrationEntry;
  onConnected: () => void | Promise<void>;
}) {
  const [token, setToken] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ organizations: { name: string }[] } | null>(
    null,
  );

  const submit = async () => {
    setError(null);
    if (!token.startsWith("sbp_")) {
      setError("Supabase PATs start with sbp_. Generate one in your Supabase account → Access Tokens.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/connections/supabase", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      if (!res.ok) {
        const { error: err } = (await res.json()) as { error?: string };
        throw new Error(err ?? "Failed to connect");
      }
      const json = (await res.json()) as { organizations: { name: string }[] };
      setResult(json);
      await onConnected();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-card/40 p-4">
        <div className="mb-3 flex items-center gap-2">
          <KeyRound className="size-4 text-primary" />
          <div className="text-[12.5px] font-semibold text-foreground">
            How to get a Personal Access Token
          </div>
        </div>
        <ol className="flex flex-col gap-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
          <li>1. Open the Supabase dashboard.</li>
          <li>
            2. Click your avatar → <strong className="text-foreground">Account</strong>{" "}
            → <strong className="text-foreground">Access Tokens</strong>.
          </li>
          <li>3. Generate a new token, name it &ldquo;Rawgrowth&rdquo;, copy the value.</li>
        </ol>
        {integration.apiKey?.docsUrl && (
          <a
            href={integration.apiKey.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            Open Supabase token page <ArrowUpRight className="size-3" />
          </a>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">
          One token covers every Supabase organization &amp; project the user can
          access. Agents pass <code className="font-mono text-foreground/80">project_ref</code>
          {" "}per call to target a specific DB.
        </p>
      </div>

      <div>
        <Label className="text-[12px] font-medium text-foreground">
          Personal Access Token
        </Label>
        <div className="mt-1.5 flex items-stretch gap-2">
          <Input
            type={show ? "text" : "password"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={integration.apiKey?.placeholder}
            className="flex-1 bg-input/40 font-mono text-[12.5px]"
            autoComplete="off"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShow((s) => !s)}
            className="shrink-0"
          >
            {show ? "Hide" : "Show"}
          </Button>
        </div>
      </div>

      {result && (
        <div className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-[12px] text-primary">
          Connected  -  token sees{" "}
          <strong className="font-semibold">
            {result.organizations.length} Supabase org
            {result.organizations.length === 1 ? "" : "s"}
          </strong>
          {result.organizations.length > 0 &&
            ` (${result.organizations.map((o) => o.name).join(", ")})`}
          .
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
          {error}
        </div>
      )}

      <Button
        onClick={submit}
        disabled={busy}
        size="sm"
        className="w-full bg-primary text-white hover:bg-primary/90"
      >
        <Plug className="size-4" />
        {busy ? "Validating…" : "Connect Supabase"}
      </Button>
      <p className="text-center text-[10.5px] text-muted-foreground">
        We verify the token by listing your Supabase orgs, then store it
        encrypted in your connection row.
      </p>
    </div>
  );
}

// ────────────────────────── Telegram bot-token form ──────────────────────────

function TelegramBotForm({
  integration,
  onConnected,
}: {
  integration: IntegrationEntry;
  onConnected: () => void | Promise<void>;
}) {
  const [token, setToken] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bot, setBot] = useState<{ first_name: string; username?: string } | null>(
    null,
  );

  const submit = async () => {
    setError(null);
    if (!token.includes(":")) {
      setError("That doesn't look like a bot token. Paste the full string BotFather gave you.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/connections/telegram", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      if (!res.ok) {
        const { error: err } = (await res.json()) as { error?: string };
        throw new Error(err ?? "Failed to connect");
      }
      const { bot: me } = (await res.json()) as {
        bot: { first_name: string; username?: string };
      };
      setBot(me);
      await onConnected();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-card/40 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Bot className="size-4 text-primary" />
          <div className="text-[12.5px] font-semibold text-foreground">
            How to get a bot token
          </div>
        </div>
        <ol className="flex flex-col gap-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
          <li>
            1. Open Telegram and message{" "}
            <code className="font-mono text-foreground/80">@BotFather</code>.
          </li>
          <li>
            2. Send <code className="font-mono text-foreground/80">/newbot</code>{" "}
            and follow the prompts to name your bot.
          </li>
          <li>3. BotFather replies with a token  -  paste it below.</li>
        </ol>
        {integration.apiKey?.docsUrl && (
          <a
            href={integration.apiKey.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            Telegram bots tutorial <ArrowUpRight className="size-3" />
          </a>
        )}
      </div>

      <div>
        <Label className="text-[12px] font-medium text-foreground">
          Bot token
        </Label>
        <div className="mt-1.5 flex items-stretch gap-2">
          <Input
            type={show ? "text" : "password"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={integration.apiKey?.placeholder}
            className="flex-1 bg-input/40 font-mono text-[12.5px]"
            autoComplete="off"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShow((s) => !s)}
            className="shrink-0"
          >
            {show ? "Hide" : "Show"}
          </Button>
        </div>
      </div>

      {bot && (
        <div className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-[12px] text-primary">
          Connected as{" "}
          <strong className="font-semibold">
            {bot.username ? `@${bot.username}` : bot.first_name}
          </strong>
          . Webhook registered.
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
          {error}
        </div>
      )}

      <Button
        onClick={submit}
        disabled={busy}
        size="sm"
        className="w-full bg-primary text-white hover:bg-primary/90"
      >
        <Plug className="size-4" />
        {busy ? "Validating…" : "Connect bot"}
      </Button>
      <p className="text-center text-[10.5px] text-muted-foreground">
        We verify the token with Telegram, register our webhook, and store the
        token in your org&apos;s connection row.
      </p>
    </div>
  );
}
