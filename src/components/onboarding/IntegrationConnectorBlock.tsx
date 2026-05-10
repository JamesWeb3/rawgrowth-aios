"use client";

import { useEffect, useRef, useState } from "react";
import { Check, AlertCircle, Plug } from "lucide-react";
import { SiSlack, SiHubspot, SiGoogledrive, SiGmail } from "react-icons/si";

import { Button } from "@/components/ui/button";

/**
 * Generalized inline integration connector for the onboarding chat.
 * Mirrors TelegramConnectorBlock but keyed by `provider` so the same
 * widget covers Slack / HubSpot / Google Drive / Gmail without bouncing
 * the client out of the chat to /connections.
 *
 * Flow:
 * 1. On mount, GET /api/onboarding/integration-status/<provider> and
 *    render either "Not connected" + Connect button or a green check.
 * 2. Connect → POST/GET to that provider's existing OAuth-start path,
 *    open the returned URL in a new tab.
 * 3. While the popup is open, poll /api/onboarding/integration-status
 *    every 2s for up to 60s. When `connected: true` lands, swap to the
 *    green check and relabel "Skip" → "Continue".
 * 4. Skip / Continue → onFinish({ connected, skipped }).
 *
 * Polling stops automatically when the component is already connected
 * on mount  -  re-rendering the block doesn't double-poll.
 */

type Provider = "slack" | "hubspot" | "google-drive" | "gmail";

const PROVIDER_META: Record<
  Provider,
  {
    name: string;
    Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
    brand: string;
    blurb: string;
  }
> = {
  slack: {
    name: "Slack",
    Icon: SiSlack,
    brand: "#4A154B",
    blurb: "Pipe agent updates and alerts into your channels.",
  },
  hubspot: {
    name: "HubSpot",
    Icon: SiHubspot,
    brand: "#FF7A59",
    blurb: "CRM pipeline, contacts, and marketing activity.",
  },
  "google-drive": {
    name: "Google Drive",
    Icon: SiGoogledrive,
    brand: "#1FA463",
    blurb: "Files and shared drives for agent context.",
  },
  gmail: {
    name: "Gmail",
    Icon: SiGmail,
    brand: "#EA4335",
    blurb: "Read and send email as the connected user.",
  },
};

type StatusResponse = {
  connected: boolean;
  displayName?: string | null;
  error?: string;
};

const POLL_INTERVAL_MS = 2_000;
const POLL_MAX_MS = 60_000;

export function IntegrationConnectorBlock({
  provider,
  onFinish,
}: {
  provider: Provider;
  onFinish: (summary: { connected: boolean; skipped: boolean }) => void;
}) {
  const meta = PROVIDER_META[provider];
  const [connected, setConnected] = useState(false);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [done, setDone] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Tracks whether the component is still mounted so the in-flight poll
  // fetch can short-circuit setState calls after unmount (avoids the
  // React "set state on unmounted component" warning when the chat
  // re-renders mid-poll).
  const aliveRef = useRef(true);

  // Idempotency guard. Without this, a second mount (StrictMode in dev,
  // or chat re-render) would kick a new poll loop every time. Once we
  // know the provider is connected, we never start polling.
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await fetch(
          `/api/onboarding/integration-status/${provider}`,
          { cache: "no-store" },
        );
        if (!r.ok) throw new Error(`status ${r.status}`);
        const data = (await r.json()) as StatusResponse;
        if (!alive) return;
        setConnected(!!data.connected);
        setDisplayName(data.displayName ?? null);
        setLoading(false);
      } catch (err) {
        if (!alive) return;
        setError((err as Error).message);
        setLoading(false);
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [provider]);

  // Cleanup any in-flight poller when the block unmounts.
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  function startPolling() {
    if (pollTimerRef.current || connected) return;
    setPolling(true);
    const start = Date.now();
    pollTimerRef.current = setInterval(async () => {
      if (!aliveRef.current) return;
      if (Date.now() - start > POLL_MAX_MS) {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
        if (aliveRef.current) setPolling(false);
        return;
      }
      try {
        const r = await fetch(
          `/api/onboarding/integration-status/${provider}`,
          { cache: "no-store" },
        );
        if (!aliveRef.current) return;
        if (!r.ok) return;
        const data = (await r.json()) as StatusResponse;
        if (!aliveRef.current) return;
        if (data.connected) {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          setPolling(false);
          setConnected(true);
          setDisplayName(data.displayName ?? null);
        }
      } catch {
        /* transient  -  next tick will retry */
      }
    }, POLL_INTERVAL_MS);
  }

  async function handleConnect() {
    setError(null);
    try {
      const url = await resolveOAuthUrl(provider);
      if (!url) {
        setError("Could not build the OAuth URL  -  check provider config.");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
      startPolling();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function handleFinish() {
    if (done) return;
    setDone(true);
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    onFinish({ connected, skipped: !connected });
  }

  const Icon = meta.Icon;
  const continueLabel = connected
    ? "Continue"
    : polling
      ? "Skip"
      : "Skip";

  return (
    <div
      className="rg-fade-in rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#0A1210] p-4"
      data-onboarding="integration-connector"
      data-provider={provider}
    >
      <div className="mb-3 flex items-center gap-3">
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: `${meta.brand}1f` }}
        >
          <Icon
            className="h-3.5 w-3.5"
            style={{
              color: meta.brand === "#FFFFFF" ? "#fff" : meta.brand,
            }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            Connect {meta.name}
          </p>
          <p className="text-[11px] text-muted-foreground/70">{meta.blurb}</p>
        </div>
        {connected ? (
          <span className="flex items-center gap-1.5 rounded-full bg-[rgba(12,191,106,0.12)] px-2 py-0.5 text-[11px] font-medium text-[#0CBF6A]">
            <Check className="h-3 w-3" />
            Connected
          </span>
        ) : (
          <span className="rounded-full border border-[rgba(255,255,255,0.08)] px-2 py-0.5 text-[11px] text-muted-foreground/70">
            Not connected
          </span>
        )}
      </div>

      {connected && displayName && (
        <p
          className="mb-2 truncate text-[11px] text-muted-foreground/70"
          data-onboarding="integration-display-name"
        >
          {displayName}
        </p>
      )}

      {polling && !connected && (
        <p className="mb-2 text-[11px] text-muted-foreground/70">
          Waiting for {meta.name} to confirm the install...
        </p>
      )}

      {error && (
        <p className="mb-2 flex items-start gap-1.5 text-[11px] text-destructive">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        {!connected && (
          <Button
            type="button"
            size="sm"
            onClick={handleConnect}
            disabled={loading || done || polling}
            data-onboarding="integration-connect-btn"
          >
            <Plug className="mr-1.5 h-3.5 w-3.5" />
            {polling ? "Connecting..." : `Connect ${meta.name}`}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant={connected ? "default" : "ghost"}
          onClick={handleFinish}
          disabled={done || loading}
          data-onboarding="integration-continue-btn"
        >
          {done ? "Saved" : continueLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * Per-provider OAuth start. Slack keeps its bespoke start route
 * (returns `{ url }` for the slack.com authorize page). Every other
 * Composio-backed provider POSTs /api/connections/composio which
 * persists a pending row + returns Composio's hosted OAuth redirect
 * URL. The polling /api/onboarding/integration-status endpoint reads
 * the same rgaios_connections row, so the inline block stays a simple
 * "open URL, poll for connected" loop.
 */
async function resolveOAuthUrl(provider: Provider): Promise<string | null> {
  if (provider === "slack") {
    const r = await fetch("/api/connections/slack/oauth/start");
    const data = (await r.json()) as { url?: string; error?: string };
    if (!r.ok || !data.url) {
      throw new Error(data.error ?? "Slack OAuth start failed");
    }
    return data.url;
  }

  const r = await fetch("/api/connections/composio", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key: provider }),
  });
  const data = (await r.json()) as {
    redirectUrl?: string;
    error?: string;
  };
  if (!r.ok || !data.redirectUrl) {
    throw new Error(data.error ?? "Could not start Composio OAuth");
  }
  return data.redirectUrl;
}
