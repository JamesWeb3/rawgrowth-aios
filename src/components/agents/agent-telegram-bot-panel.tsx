"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Bot, KeyRound, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { jsonFetcher } from "@/lib/swr";

/**
 * Per-agent Telegram bot connector. Renders inside the agent edit sheet
 * when the agent is marked as a Department Head. Lets the operator paste
 * a BotFather token, validates it server-side, and registers the webhook
 * so DMs to that bot route to this specific agent as the persona.
 */

type BotRow = {
  id: string;
  agent_id: string;
  bot_id: number;
  bot_username: string | null;
  bot_first_name: string | null;
  status: string;
};

type ListResponse = { bots: BotRow[] };

export function AgentTelegramBotPanel({
  agentId,
  agentName,
}: {
  agentId: string;
  agentName: string;
}) {
  const { data, mutate } = useSWR<ListResponse>(
    "/api/connections/agent-telegram",
    jsonFetcher,
  );

  const myBot = data?.bots?.find((b) => b.agent_id === agentId) ?? null;

  if (myBot) {
    return (
      <ConnectedCard bot={myBot} agentName={agentName} onChanged={mutate} />
    );
  }
  return <ConnectForm agentId={agentId} onConnected={mutate} />;
}

function ConnectForm({
  agentId,
  onConnected,
}: {
  agentId: string;
  onConnected: () => void | Promise<unknown>;
}) {
  const [token, setToken] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!token.includes(":")) {
      setError(
        "That doesn't look like a bot token. Paste the full string BotFather gave you.",
      );
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/connections/agent-telegram", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent_id: agentId, token: token.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to connect");
      }
      toast.success("Telegram bot connected");
      setToken("");
      await onConnected();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Bot className="size-4 text-primary" />
        <div className="text-[12.5px] font-semibold text-foreground">
          Telegram bot for this head
        </div>
      </div>
      <ol className="mb-3 flex flex-col gap-1 text-[11.5px] leading-relaxed text-muted-foreground">
        <li>
          1. Open Telegram and message{" "}
          <code className="font-mono text-foreground/80">@BotFather</code>.
        </li>
        <li>
          2. Send <code className="font-mono text-foreground/80">/newbot</code>,
          name it, and copy the token.
        </li>
        <li>3. Paste the token here.</li>
      </ol>

      <Label className="text-[12px] font-medium text-foreground">
        Bot token
      </Label>
      <div className="mt-1.5 flex items-stretch gap-2">
        <Input
          type={show ? "text" : "password"}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="1234567890:AA…"
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

      {error && (
        <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
          {error}
        </div>
      )}

      <Button
        onClick={submit}
        disabled={busy}
        size="sm"
        className="btn-shine mt-3 w-full bg-primary text-white hover:bg-primary/90"
      >
        {busy ? "Validating…" : "Connect bot"}
      </Button>
      <p className="mt-1.5 text-center text-[10.5px] text-muted-foreground">
        DMs to this bot will route to this agent's persona.
      </p>
    </div>
  );
}

function ConnectedCard({
  bot,
  agentName,
  onChanged,
}: {
  bot: BotRow;
  agentName: string;
  onChanged: () => void | Promise<unknown>;
}) {
  const [revealing, setRevealing] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  // Mask: the leading numeric part of a Telegram token is the bot id and
  // is shown as-is for recognisability; the secret half stays hidden.
  const tokenDisplay = revealed ?? `${bot.bot_id}:${"•".repeat(20)}`;

  const reveal = async () => {
    if (revealed) {
      setRevealed(null);
      return;
    }
    setRevealing(true);
    try {
      const res = await fetch(
        `/api/connections/agent-telegram/${bot.id}/token`,
      );
      if (!res.ok) throw new Error("Failed to reveal token");
      const { token } = (await res.json()) as { token?: string };
      if (!token) throw new Error("Token not found");
      setRevealed(token);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRevealing(false);
    }
  };

  const disconnect = async () => {
    if (!confirm(`Disconnect ${agentName}'s Telegram bot?`)) return;
    setDisconnecting(true);
    try {
      const res = await fetch(`/api/connections/agent-telegram/${bot.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to disconnect");
      toast.success("Disconnected");
      await onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDisconnecting(false);
    }
  };

  // Reset reveal when the bot row changes underneath us (e.g. token rotated).
  useEffect(() => {
    setRevealed(null);
  }, [bot.id]);

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
            <div className="text-[12.5px] font-semibold text-foreground">
              {bot.bot_username ? `@${bot.bot_username}` : bot.bot_first_name ?? "Bot"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Routes DMs to {agentName}
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

      <div className="mt-3">
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
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={disconnect}
        disabled={disconnecting}
        className="mt-3 w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <X className="size-3.5" />
        {disconnecting ? "Disconnecting…" : "Disconnect bot"}
      </Button>

      <KeyRoundReference />
    </div>
  );
}

// Lint: keep KeyRound used so the import doesn't dead-code; we may surface
// it later as a "Replace token" affordance.
function KeyRoundReference() {
  void KeyRound;
  return null;
}
