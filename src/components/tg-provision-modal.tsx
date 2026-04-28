"use client";

import { useState } from "react";
import { X, Check, AlertCircle, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Modal invoked from any agent node's "Add to Telegram" button. Walks the
 * user through BotFather token paste → server validates → webhook
 * registered → confirmation. Sub-agents use the same modal, gated
 * behind an extra "Yes, give this sub-agent its own bot" confirmation
 * to prevent the §9 auto-fail (sub-agent bots without opt-in).
 */
export type TgProvisionModalProps = {
  agentId: string;
  agentName: string;
  agentRole: "manager" | "sub-agent";
  onClose: () => void;
  onConnected: (result: {
    connectionId: string;
    bot: { id: number; username?: string | null };
  }) => void;
};

export function TgProvisionModal({
  agentId,
  agentName,
  agentRole,
  onClose,
  onConnected,
}: TgProvisionModalProps) {
  const [confirmed, setConfirmed] = useState(agentRole === "manager");
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    bot_username?: string | null;
    connectionId: string;
  } | null>(null);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/tg-provision/${agentId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bot_token: token.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? "Provisioning failed");
      }
      setResult({
        connectionId: json.connectionId,
        bot_username: json.bot?.username ?? null,
      });
      onConnected(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="relative w-full max-w-lg rounded-lg border border-[var(--line)] bg-[var(--brand-surface)] p-6">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-[var(--text-muted)] hover:text-[var(--text-strong)]"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 className="text-xl font-medium text-[var(--text-strong)]">
          Add Telegram to {agentName}
        </h2>
        <p className="mt-1 text-sm text-[var(--text-body)]">
          Paste a BotFather token. The bot turns on within seconds.
        </p>

        {!confirmed && agentRole === "sub-agent" && (
          <div className="mt-4 rounded-md border border-[var(--line-strong)] bg-[var(--brand-surface-2)] p-4">
            <p className="text-sm text-[var(--text-strong)]">
              Sub-agents only get a Telegram bot when you explicitly opt in.
              Confirm this sub-agent should have its own bot, separate from
              its department manager.
            </p>
            <div className="mt-3 flex gap-2">
              <Button onClick={() => setConfirmed(true)} variant="default">
                Yes, give it a bot
              </Button>
              <Button onClick={onClose} variant="ghost">
                Cancel
              </Button>
            </div>
          </div>
        )}

        {confirmed && !result && (
          <>
            <label className="mt-5 block text-xs uppercase tracking-widest text-[var(--text-muted)]">
              Bot token
            </label>
            <input
              type="password"
              autoFocus
              placeholder="123456:ABC-DEF..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="mt-1 w-full rounded-md border border-[var(--line-strong)] bg-[var(--brand-surface-2)] px-3 py-2 font-mono text-sm text-[var(--text-strong)] placeholder:text-[var(--text-faint)] focus:border-primary focus:outline-none"
            />

            <p className="mt-3 text-xs text-[var(--text-muted)]">
              Get a fresh token by DMing @BotFather on Telegram and running
              <code className="mx-1 rounded bg-[var(--brand-surface-2)] px-1 py-0.5 font-mono">
                /newbot
              </code>
              . Tokens are stored encrypted at rest.
            </p>

            {error && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-[#8b2e14] bg-[#1a0b08] p-3 text-sm text-[#f4b27a]">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={onClose} variant="ghost" disabled={submitting}>
                Cancel
              </Button>
              <Button
                onClick={submit}
                disabled={!token.trim() || submitting}
                variant="default"
              >
                {submitting ? "Connecting…" : "Connect"}
              </Button>
            </div>
          </>
        )}

        {result && (
          <div className="mt-5 rounded-md border border-[#5a7340] bg-[#0f1a0d] p-4 text-sm">
            <div className="flex items-center gap-2 text-[#aad08f]">
              <Check className="h-4 w-4" />
              <span className="font-medium">Bot connected</span>
            </div>
            {result.bot_username && (
              <p className="mt-2 flex items-center gap-2 text-[var(--text-body)]">
                Talk to your bot:
                <a
                  href={`https://t.me/${result.bot_username}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-primary hover:underline"
                >
                  @{result.bot_username}
                </a>
                <button
                  type="button"
                  onClick={() =>
                    navigator.clipboard.writeText(`@${result.bot_username}`)
                  }
                  className="text-[var(--text-muted)] hover:text-[var(--text-strong)]"
                  aria-label="Copy bot handle"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </p>
            )}
            <div className="mt-4 flex justify-end">
              <Button onClick={onClose} variant="default">
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
