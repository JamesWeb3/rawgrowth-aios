"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  ArrowUpRight,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClaudeLogo } from "@/components/icons/claude-logo";
import { jsonFetcher } from "@/lib/swr";

type ClaudeStatus = {
  connected: boolean;
  installed_at?: string;
  token_preview?: string | null;
  token?: string;
};

const TOKEN_PREFIX = "sk-ant-oat01-";

export function ClaudeConnectionCard() {
  const { data, isLoading, mutate } = useSWR<ClaudeStatus>(
    "/api/connections/claude",
    jsonFetcher,
  );

  // OAuth flow state
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [authState, setAuthState] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [starting, setStarting] = useState(false);
  const [completing, setCompleting] = useState(false);

  // Connected state
  const [disconnecting, setDisconnecting] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);

  const connected = data?.connected ?? false;
  const stale = (data as { stale?: boolean } | undefined)?.stale ?? false;
  const staleSince = (data as { stale_since?: string | null } | undefined)?.stale_since ?? null;

  const startOauth = async () => {
    setStarting(true);
    try {
      const res = await fetch("/api/connections/claude/oauth/start", {
        method: "POST",
      });
      const body = (await res.json()) as {
        ok?: boolean;
        url?: string;
        state?: string;
        error?: string;
      };
      if (!res.ok || !body.ok || !body.url || !body.state) {
        throw new Error(body.error ?? "failed to start OAuth");
      }
      setAuthUrl(body.url);
      setAuthState(body.state);
      // Open Anthropic in a new tab
      window.open(body.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const completeOauth = async () => {
    if (!authState) {
      toast.error("Click Open Anthropic first");
      return;
    }
    const trimmed = code.trim();
    if (!trimmed) {
      toast.error("Paste the code from Anthropic first");
      return;
    }
    setCompleting(true);
    try {
      const res = await fetch("/api/connections/claude/oauth/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: trimmed, state: authState }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "exchange failed");
      }
      toast.success("Claude Max connected");
      setAuthUrl(null);
      setAuthState(null);
      setCode("");
      await mutate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCompleting(false);
    }
  };

  const cancelOauth = () => {
    setAuthUrl(null);
    setAuthState(null);
    setCode("");
  };

  const reveal = async () => {
    if (revealed) {
      setRevealed(null);
      return;
    }
    setRevealing(true);
    try {
      const res = await fetch("/api/connections/claude?reveal=1");
      const body = (await res.json()) as { token?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? "reveal failed");
      if (!body.token) throw new Error("no token to reveal");
      setRevealed(body.token);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRevealing(false);
    }
  };

  const copyRevealed = async () => {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed);
      toast.success("Token copied");
    } catch {
      /* ignore */
    }
  };

  const disconnect = async () => {
    if (!confirm("Disconnect your Claude Max from this workspace?")) return;
    setDisconnecting(true);
    try {
      const res = await fetch("/api/connections/claude", { method: "DELETE" });
      if (!res.ok) {
        const { error } = (await res.json()) as { error?: string };
        throw new Error(error ?? "Disconnect failed");
      }
      toast.success("Disconnected");
      await mutate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDisconnecting(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="border-border bg-card/50">
        <CardContent className="h-48 animate-pulse p-6" />
      </Card>
    );
  }

  return (
    <Card className="border-border bg-card/50">
      <CardContent className="space-y-5 p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border"
              style={{ backgroundColor: "rgba(217, 119, 87, 0.1)" }}
            >
              <ClaudeLogo className="size-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[14px] font-semibold text-foreground">
                  Claude Max
                </h3>
                {!connected ? (
                  <Badge
                    variant="secondary"
                    className="bg-amber-500/10 text-[10px] text-amber-400"
                  >
                    Not connected
                  </Badge>
                ) : stale ? (
                  <Badge
                    variant="secondary"
                    className="bg-red-500/15 text-[10px] text-red-300"
                  >
                    Token rejected - reconnect
                  </Badge>
                ) : (
                  <Badge
                    variant="secondary"
                    className="bg-primary/15 text-[10px] text-primary"
                  >
                    Connected
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {!connected
                  ? "Powers your VPS-side agents (24/7 Telegram + scheduled routines)"
                  : stale
                    ? `Anthropic returned 401 ${staleSince ? `at ${new Date(staleSince).toLocaleString()}` : "recently"}. Disconnect + Connect again to refresh.`
                    : `Connected${data?.installed_at ? ` · ${new Date(data.installed_at).toLocaleDateString()}` : ""}`}
              </p>
            </div>
          </div>
          {connected && (
            <Button
              size="sm"
              variant="secondary"
              onClick={disconnect}
              disabled={disconnecting}
              className="bg-white/5 text-foreground hover:bg-white/10"
            >
              <X className="size-3.5" />
              Disconnect
            </Button>
          )}
        </div>

        {connected ? (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <Label className="text-[11px] font-medium text-muted-foreground">
                Stored token
              </Label>
              <button
                type="button"
                onClick={reveal}
                disabled={revealing}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                {revealed ? (
                  <>
                    <EyeOff className="size-3" /> Hide
                  </>
                ) : (
                  <>
                    <Eye className="size-3" /> {revealing ? "Loading…" : "Show"}
                  </>
                )}
              </button>
            </div>
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-background/40 px-3 py-2 font-mono text-[12px] text-foreground/85">
              <code className="flex-1 truncate">
                {revealed ?? data?.token_preview ?? `${TOKEN_PREFIX}…`}
              </code>
              {revealed && (
                <button
                  type="button"
                  onClick={copyRevealed}
                  className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  aria-label="Copy token"
                >
                  <Copy className="size-3.5" />
                </button>
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Stored encrypted (AES-256-GCM). Synced to your VPS within
              60 seconds of any change.
            </p>
          </div>
        ) : authUrl ? (
          // Step 2: user has opened the auth URL, now needs to paste the code
          <div className="space-y-4">
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
              <p className="text-[12.5px] text-foreground">
                Anthropic should be open in a new tab. Sign in with your
                Claude Max, then copy the code Anthropic shows you on the
                callback page.
              </p>
              <button
                type="button"
                onClick={() => window.open(authUrl, "_blank", "noopener,noreferrer")}
                className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-primary hover:underline"
              >
                Re-open Anthropic
                <ExternalLink className="size-3" />
              </button>
            </div>
            <div>
              <Label
                htmlFor="claude-oauth-code"
                className="text-[11px] font-medium text-muted-foreground"
              >
                Code from Anthropic
              </Label>
              <div className="mt-1.5 flex gap-2">
                <Input
                  id="claude-oauth-code"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="paste the code Anthropic shows you"
                  className="font-mono text-[12px]"
                  autoComplete="off"
                  spellCheck={false}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !completing) completeOauth();
                  }}
                />
                <Button
                  onClick={completeOauth}
                  disabled={completing || !code.trim()}
                  className="bg-primary text-white hover:bg-primary/90"
                >
                  {completing ? "Connecting…" : (
                    <>
                      <Check className="size-3.5" />
                      Connect
                    </>
                  )}
                </Button>
                <Button
                  variant="secondary"
                  onClick={cancelOauth}
                  disabled={completing}
                  className="bg-white/5 text-foreground hover:bg-white/10"
                >
                  Cancel
                </Button>
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                The code looks like a long string with a <code>#</code> in
                the middle. Paste the whole thing  -  we&apos;ll handle the
                formatting.
              </p>
            </div>
          </div>
        ) : (
          // Step 1: not started  -  show the Connect button + intro
          <div className="space-y-4">
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              Click below to sign in with your Claude Max. Anthropic will
              show you a code on a callback page  -  paste it back here and
              you&apos;re done.
            </p>
            <Button
              onClick={startOauth}
              disabled={starting}
              className="bg-primary text-white hover:bg-primary/90"
            >
              <ClaudeLogo className="size-4" />
              {starting ? "Starting…" : "Connect Claude Max"}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              No CLI, no terminal. Anthropic verifies you, the dashboard
              exchanges the code from the VPS so the resulting token works
              there.
            </p>
          </div>
        )}

        <div className="rounded-md border border-border bg-background/30 p-3 text-[11.5px] leading-relaxed text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">
              Native connectors (Gmail, Drive, Slack, Notion, GitHub, …)
            </span>{" "}
            live in your Claude account, not here. Connect them once and
            every agent picks them up.
          </p>
          <a
            href="https://claude.ai/settings/connectors"
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-primary hover:underline"
          >
            Open Claude connector settings
            <ArrowUpRight className="size-3" />
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
