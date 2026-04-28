"use client";

import { useEffect, useState } from "react";
import { Check, AlertCircle, Send } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Inline Telegram connector rendered mid-onboarding (after brand profile
 * approval, before brand-docs upload). Lists every Department Head agent
 * that still has a pending Telegram slot from
 * `seedTelegramConnectionsForDefaults` and lets the customer paste a
 * BotFather token per agent without leaving the chat.
 *
 * Each panel POSTs to /api/tg-provision/[agentId] - the same endpoint the
 * /agents/[id] page's modal uses - so server-side validation, webhook
 * registration, and audit logging stay identical between the two paths.
 *
 * The Continue button always reports back, even if zero bots got wired.
 * That keeps the chat moving for users who want to defer setup, while
 * still giving us a chance to land at least one live bot before they
 * leave the onboarding surface.
 */

type PendingAgent = {
  agentId: string;
  agentName: string;
  title: string | null;
  department: string | null;
  connectionId: string;
  status: "pending_token" | "connected";
  botUsername: string | null;
};

type ProvisionResult = {
  ok?: boolean;
  error?: string;
  bot?: { username?: string | null; first_name?: string };
  connectionId?: string;
};

export function TelegramConnectorBlock({
  onFinish,
}: {
  onFinish: (summary: { connected: string[]; skipped: string[] }) => void;
}) {
  const [agents, setAgents] = useState<PendingAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/onboarding/telegram-pending")
      .then((r) => r.json())
      .then((data) => {
        if (!alive) return;
        if (data.error) {
          setLoadError(data.error);
          return;
        }
        setAgents(data.agents ?? []);
      })
      .catch((err: Error) => {
        if (!alive) return;
        setLoadError(err.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  function handleConnected(agentId: string, result: ProvisionResult) {
    setAgents((prev) =>
      prev.map((a) =>
        a.agentId === agentId
          ? {
              ...a,
              status: "connected",
              botUsername: result.bot?.username ?? a.botUsername,
            }
          : a,
      ),
    );
  }

  function handleContinue() {
    if (done) return;
    setDone(true);
    const connected: string[] = [];
    const skipped: string[] = [];
    for (const a of agents) {
      if (a.status === "connected") connected.push(a.agentName);
      else skipped.push(a.agentName);
    }
    onFinish({ connected, skipped });
  }

  const connectedCount = agents.filter((a) => a.status === "connected").length;
  const totalCount = agents.length;

  return (
    <div
      className="rg-fade-in rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#0A1210] p-4"
      data-onboarding="telegram-connector"
    >
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[rgba(12,191,106,0.12)]">
          <Send className="h-3.5 w-3.5 text-[#0CBF6A]" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            Wire up your Telegram bots
          </p>
          <p className="text-[11px] text-muted-foreground/70">
            DM @BotFather, send /newbot, follow the prompts, and paste each
            token below. One bot per Department Head.
          </p>
        </div>
      </div>

      {loading && (
        <p className="text-[12px] text-muted-foreground/70">
          Loading agents that need bots...
        </p>
      )}

      {loadError && (
        <p className="flex items-center gap-2 text-[12px] text-destructive">
          <AlertCircle className="h-3.5 w-3.5" />
          {loadError}
        </p>
      )}

      {!loading && !loadError && agents.length === 0 && (
        <p className="text-[12px] text-muted-foreground/70">
          No Department Heads need Telegram bots right now. You can add them
          later from /agents.
        </p>
      )}

      {!loading && agents.length > 0 && (
        <div className="space-y-2.5">
          {agents.map((agent) => (
            <AgentBotPanel
              key={agent.agentId}
              agent={agent}
              disabled={done}
              onConnected={(result) => handleConnected(agent.agentId, result)}
            />
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground/60">
          {totalCount > 0
            ? `${connectedCount} of ${totalCount} bot${totalCount === 1 ? "" : "s"} connected`
            : ""}
        </p>
        <Button
          type="button"
          size="sm"
          onClick={handleContinue}
          disabled={done || loading}
          data-onboarding="telegram-continue"
        >
          {done
            ? "Saved"
            : connectedCount > 0
              ? `Continue with ${connectedCount} connected`
              : "Skip for now"}
        </Button>
      </div>
    </div>
  );
}

function AgentBotPanel({
  agent,
  disabled,
  onConnected,
}: {
  agent: PendingAgent;
  disabled: boolean;
  onConnected: (result: ProvisionResult) => void;
}) {
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isConnected = agent.status === "connected";

  async function submit() {
    setError(null);
    if (!token.includes(":")) {
      setError(
        "That doesn't look like a bot token. Paste the full string BotFather gave you.",
      );
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/tg-provision/${agent.agentId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bot_token: token.trim() }),
      });
      const json = (await res.json()) as ProvisionResult;
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Provisioning failed");
      }
      onConnected(json);
      setToken("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const headerLabel = agent.title?.trim() || agent.agentName;

  return (
    <div
      className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] p-3"
      data-onboarding="telegram-agent-panel"
      data-agent-id={agent.agentId}
    >
      <div className="flex items-center gap-2">
        {isConnected ? (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[rgba(12,191,106,0.18)]">
            <Check className="h-3 w-3 text-[#0CBF6A]" />
          </span>
        ) : (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[rgba(255,255,255,0.06)]">
            <Send className="h-2.5 w-2.5 text-muted-foreground/70" />
          </span>
        )}
        <p className="flex-1 text-[12px] font-medium text-foreground">
          {headerLabel}
        </p>
        {isConnected && agent.botUsername && (
          <a
            href={`https://t.me/${agent.botUsername}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[11px] text-primary hover:underline"
          >
            @{agent.botUsername}
          </a>
        )}
      </div>

      {!isConnected && (
        <div className="mt-2 flex items-stretch gap-2">
          <input
            type="password"
            placeholder="123456:ABC-DEF..."
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={disabled || submitting}
            className="min-w-0 flex-1 rounded-md border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] px-2.5 py-1.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-[rgba(12,191,106,0.4)] disabled:opacity-40"
            data-onboarding="telegram-token-input"
          />
          <Button
            type="button"
            size="sm"
            onClick={submit}
            disabled={disabled || submitting || !token.trim()}
            data-onboarding="telegram-connect-btn"
          >
            {submitting ? "Connecting..." : "Connect"}
          </Button>
        </div>
      )}

      {isConnected && !agent.botUsername && (
        <p className="mt-1.5 text-[11px] text-muted-foreground/70">
          Bot connected.
        </p>
      )}

      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-destructive">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
