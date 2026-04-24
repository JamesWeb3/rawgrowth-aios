"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import {
  ArrowUpRight,
  Check,
  ExternalLink,
  Pencil,
  X,
} from "lucide-react";
import { SiSlack } from "react-icons/si";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { jsonFetcher } from "@/lib/swr";

type SlackStatus = {
  configured: boolean;
  installed: boolean;
  client_id: string | null;
  team: { id: string; name: string } | null;
  bot_user_id: string | null;
  scope: string | null;
  installed_at: string | null;
};

export function SlackConnectionCard() {
  const { data, isLoading, mutate } = useSWR<SlackStatus>(
    "/api/connections/slack",
    jsonFetcher,
  );

  // Wizard state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);

  // Install state
  const [starting, setStarting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // Surface OAuth callback outcome (?slack=connected / ?slack=error&reason=…)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const slackParam = url.searchParams.get("slack");
    if (!slackParam) return;
    if (slackParam === "connected") {
      const team = url.searchParams.get("team");
      toast.success(`Slack connected${team ? ` · ${team}` : ""}`);
      void mutate();
    } else if (slackParam === "error") {
      const reason = url.searchParams.get("reason") ?? "unknown";
      toast.error(`Slack install failed: ${reason}`);
    }
    url.searchParams.delete("slack");
    url.searchParams.delete("team");
    url.searchParams.delete("reason");
    window.history.replaceState({}, "", url.toString());
  }, [mutate]);

  const saveConfig = async () => {
    if (!clientId.trim() || !clientSecret.trim() || !signingSecret.trim()) {
      toast.error("Fill all three fields");
      return;
    }
    setSavingConfig(true);
    try {
      const res = await fetch("/api/connections/slack/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_id: clientId.trim(),
          client_secret: clientSecret.trim(),
          signing_secret: signingSecret.trim(),
        }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "save failed");
      toast.success("Slack App config saved");
      setWizardOpen(false);
      setClientSecret("");
      setSigningSecret("");
      await mutate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingConfig(false);
    }
  };

  const startInstall = async () => {
    setStarting(true);
    try {
      const res = await fetch("/api/connections/slack/oauth/start");
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        throw new Error(body.error ?? "failed to start install");
      }
      window.open(body.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const disconnect = async () => {
    if (
      !confirm(
        "Disconnect Slack from this workspace? This revokes the bot token and clears your app credentials.",
      )
    )
      return;
    setDisconnecting(true);
    try {
      const res = await fetch("/api/connections/slack", { method: "DELETE" });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "disconnect failed");
      toast.success("Slack disconnected");
      await mutate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDisconnecting(false);
    }
  };

  if (isLoading || !data) {
    return (
      <Card className="border-border bg-card/50">
        <CardContent className="h-40 animate-pulse p-6" />
      </Card>
    );
  }

  const redirectUri =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/connections/slack/oauth/callback`
      : "";
  const eventsUri =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/webhooks/slack`
      : "";

  return (
    <Card className="border-border bg-card/50">
      <CardContent className="space-y-5 p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border"
              style={{ backgroundColor: "rgba(74, 21, 75, 0.12)" }}
            >
              <SiSlack className="size-5" style={{ color: "#4A154B" }} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[14px] font-semibold text-foreground">
                  Slack
                </h3>
                {data.installed ? (
                  <Badge
                    variant="secondary"
                    className="bg-primary/15 text-[10px] text-primary"
                  >
                    Connected
                  </Badge>
                ) : data.configured ? (
                  <Badge
                    variant="secondary"
                    className="bg-blue-500/10 text-[10px] text-blue-400"
                  >
                    App configured · not installed
                  </Badge>
                ) : (
                  <Badge
                    variant="secondary"
                    className="bg-amber-500/10 text-[10px] text-amber-400"
                  >
                    Setup required
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {data.installed
                  ? `${data.team?.name ?? "workspace"} · installed ${data.installed_at ? new Date(data.installed_at).toLocaleDateString() : ""}`
                  : "Bind agents to channels and trigger on new messages, files, or mentions."}
              </p>
            </div>
          </div>
          {data.installed && (
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

        {data.installed ? (
          // ─── Connected state ──────────────────────────────────────
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 rounded-md border border-border bg-background/40 p-3 text-[11.5px]">
              <div>
                <div className="text-[10px] uppercase tracking-[1px] text-muted-foreground">
                  Workspace
                </div>
                <div className="mt-0.5 font-mono text-foreground">
                  {data.team?.name}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[1px] text-muted-foreground">
                  Bot user
                </div>
                <div className="mt-0.5 font-mono text-foreground">
                  {data.bot_user_id}
                </div>
              </div>
            </div>
            <SlackBindingsPanel />
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <Pencil className="size-3" />
              Edit app credentials
            </button>
          </div>
        ) : data.configured && !wizardOpen ? (
          // ─── Configured, ready to install ─────────────────────────
          <div className="space-y-3">
            <p className="text-[12.5px] text-muted-foreground">
              Slack App creds saved. Now install the bot into your workspace —
              Slack will ask you to pick a workspace and approve the scopes.
            </p>
            <div className="flex gap-2">
              <Button
                onClick={startInstall}
                disabled={starting}
                className="btn-shine bg-primary text-white hover:bg-primary/90"
              >
                <SiSlack className="size-3.5" />
                {starting ? "Starting…" : "Install to your Slack workspace"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setWizardOpen(true)}
                className="bg-white/5 text-foreground hover:bg-white/10"
              >
                <Pencil className="size-3.5" />
                Edit creds
              </Button>
            </div>
          </div>
        ) : (
          // ─── Setup wizard (not configured yet) ────────────────────
          <div className="space-y-4">
            <details className="rounded-md border border-border bg-background/30 p-3 text-[11.5px] leading-relaxed text-muted-foreground">
              <summary className="cursor-pointer text-[12px] font-medium text-foreground">
                How to create your Slack App (~5 min, one-time)
              </summary>
              <ol className="mt-3 space-y-2 pl-4">
                <li>
                  Go to{" "}
                  <a
                    href="https://api.slack.com/apps"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    api.slack.com/apps <ArrowUpRight className="size-3" />
                  </a>{" "}
                  → <strong>Create New App</strong> → <strong>From scratch</strong>.
                </li>
                <li>
                  Name it <code>Rawgrowth</code>, pick any workspace to own the app (this doesn&apos;t limit installs).
                </li>
                <li>
                  In <strong>OAuth &amp; Permissions</strong>:
                  <ul className="mt-1 list-disc pl-5">
                    <li>
                      Redirect URL — paste this:
                      <code className="ml-1 block overflow-x-auto rounded bg-background/60 px-1.5 py-0.5 font-mono text-[10.5px]">
                        {redirectUri}
                      </code>
                    </li>
                    <li>
                      Bot Token Scopes — add:{" "}
                      <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[10.5px]">
                        channels:read, channels:history, groups:read, groups:history, chat:write, files:read, users:read, app_mentions:read
                      </code>
                    </li>
                  </ul>
                </li>
                <li>
                  In <strong>Event Subscriptions</strong>:
                  <ul className="mt-1 list-disc pl-5">
                    <li>Enable Events → ON</li>
                    <li>
                      Request URL:
                      <code className="ml-1 block overflow-x-auto rounded bg-background/60 px-1.5 py-0.5 font-mono text-[10.5px]">
                        {eventsUri}
                      </code>
                    </li>
                    <li>
                      Subscribe to bot events:{" "}
                      <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[10.5px]">
                        message.channels, message.groups, app_mention, file_shared
                      </code>
                    </li>
                  </ul>
                </li>
                <li>
                  In <strong>Basic Information</strong> (or <strong>App Credentials</strong>): copy <strong>Client ID</strong>, <strong>Client Secret</strong>, and <strong>Signing Secret</strong>. Paste them below.
                </li>
              </ol>
            </details>

            <div className="space-y-3">
              <div>
                <Label className="text-[11px] font-medium text-muted-foreground">
                  Client ID
                </Label>
                <Input
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="1234567890.1234567890123"
                  className="mt-1 font-mono text-[12px]"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div>
                <Label className="text-[11px] font-medium text-muted-foreground">
                  Client Secret
                </Label>
                <Input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="from Basic Information → App Credentials"
                  className="mt-1 font-mono text-[12px]"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div>
                <Label className="text-[11px] font-medium text-muted-foreground">
                  Signing Secret
                </Label>
                <Input
                  type="password"
                  value={signingSecret}
                  onChange={(e) => setSigningSecret(e.target.value)}
                  placeholder="used to verify Slack Events webhook signatures"
                  className="mt-1 font-mono text-[12px]"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={saveConfig}
                  disabled={savingConfig}
                  className="btn-shine bg-primary text-white hover:bg-primary/90"
                >
                  {savingConfig ? "Saving…" : (
                    <>
                      <Check className="size-3.5" />
                      Save &amp; continue
                    </>
                  )}
                </Button>
                {data.configured && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setWizardOpen(false);
                      setClientSecret("");
                      setSigningSecret("");
                    }}
                    className="bg-white/5 text-foreground hover:bg-white/10"
                  >
                    Cancel
                  </Button>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                All three secrets are encrypted at rest (AES-256-GCM).
              </p>
            </div>
          </div>
        )}

        {!data.installed && (
          <div className="rounded-md border border-border bg-background/30 p-3 text-[11.5px] leading-relaxed text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Why set up my own Slack App?</span>{" "}
              Slack only allows one Events URL per app. Per-client Apps keep
              each workspace&apos;s events isolated to its own VPS, no central
              gateway needed.
            </p>
            <a
              href="https://api.slack.com/apps"
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-primary hover:underline"
            >
              Open api.slack.com/apps
              <ExternalLink className="size-3" />
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Bindings panel ─────────────────────────────────────────────────

type SlackBinding = {
  id: string;
  slack_team_id: string;
  slack_channel_id: string;
  slack_channel_name: string | null;
  agent_id: string;
  trigger_type: "new_message" | "new_file" | "app_mention" | "transcript";
  output_type: "slack_thread" | "slack_channel" | "dm_user" | "gmail";
  output_config: Record<string, unknown>;
  prompt_template: string | null;
  enabled: boolean;
  last_fired_at: string | null;
};

type SlackChannelLite = {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
};

type AgentLite = {
  id: string;
  name: string;
  title: string | null;
  role: string;
};

const TRIGGER_LABELS: Record<SlackBinding["trigger_type"], string> = {
  new_message: "Any new message in channel",
  app_mention: "Bot mentioned (@bot ...)",
  new_file: "Any file uploaded",
  transcript: "Transcript file uploaded",
};

const OUTPUT_LABELS: Record<SlackBinding["output_type"], string> = {
  slack_thread: "Reply in a thread (same channel)",
  slack_channel: "Post to a different Slack channel",
  dm_user: "DM the user who triggered it",
  gmail: "Email (coming soon)",
};

function SlackBindingsPanel() {
  const { data: bindings, mutate } = useSWR<{ bindings: SlackBinding[] }>(
    "/api/connections/slack/bindings",
    jsonFetcher,
  );
  const [adding, setAdding] = useState(false);

  const rows = bindings?.bindings ?? [];

  return (
    <div className="space-y-2 rounded-md border border-border bg-background/40 p-3">
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-semibold text-foreground">
          Channel bindings
          {rows.length > 0 && (
            <span className="ml-2 text-[11px] font-normal text-muted-foreground">
              ({rows.length})
            </span>
          )}
        </div>
        {!adding && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setAdding(true)}
            className="bg-white/5 text-foreground hover:bg-white/10"
          >
            + Add binding
          </Button>
        )}
      </div>

      {rows.length === 0 && !adding && (
        <p className="text-[11.5px] text-muted-foreground">
          No bindings yet. Pick a channel, an agent, a trigger — agents will
          listen on Slack and respond per your rules.
        </p>
      )}

      {rows.map((b) => (
        <BindingRow key={b.id} binding={b} onChange={() => mutate()} />
      ))}

      {adding && (
        <BindingForm
          onCancel={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            void mutate();
          }}
        />
      )}
    </div>
  );
}

function BindingRow({
  binding,
  onChange,
}: {
  binding: SlackBinding;
  onChange: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const destroy = async () => {
    if (!confirm("Delete this binding?")) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/connections/slack/bindings/${binding.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("delete failed");
      toast.success("Binding deleted");
      onChange();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const toggle = async () => {
    try {
      const res = await fetch(
        `/api/connections/slack/bindings/${binding.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: !binding.enabled }),
        },
      );
      if (!res.ok) throw new Error("toggle failed");
      onChange();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="flex items-center justify-between gap-2 rounded border border-border bg-background/40 px-3 py-2 text-[11.5px]">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-foreground">
          <span className="font-mono">
            #{binding.slack_channel_name ?? binding.slack_channel_id}
          </span>
          <span className="text-muted-foreground">·</span>
          <span>{TRIGGER_LABELS[binding.trigger_type]}</span>
          <span className="text-muted-foreground">→</span>
          <span>{OUTPUT_LABELS[binding.output_type]}</span>
          {!binding.enabled && (
            <Badge
              variant="secondary"
              className="bg-white/5 text-[10px] text-muted-foreground"
            >
              disabled
            </Badge>
          )}
        </div>
        {binding.prompt_template && (
          <div className="mt-0.5 truncate text-muted-foreground">
            <em>{binding.prompt_template}</em>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={toggle}
          className="rounded px-2 py-1 text-[10.5px] text-muted-foreground hover:bg-white/5 hover:text-foreground"
        >
          {binding.enabled ? "Disable" : "Enable"}
        </button>
        <button
          type="button"
          onClick={destroy}
          disabled={deleting}
          className="rounded px-2 py-1 text-[10.5px] text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
        >
          <X className="size-3" />
        </button>
      </div>
    </div>
  );
}

function BindingForm({
  onCancel,
  onSaved,
}: {
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { data: channels } = useSWR<{ channels: SlackChannelLite[] }>(
    "/api/connections/slack/channels",
    jsonFetcher,
  );
  const { data: agents } = useSWR<{ agents: AgentLite[] }>(
    "/api/agents",
    jsonFetcher,
  );

  const [channelId, setChannelId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [triggerType, setTriggerType] =
    useState<SlackBinding["trigger_type"]>("new_message");
  const [outputType, setOutputType] =
    useState<SlackBinding["output_type"]>("slack_thread");
  const [outputChannel, setOutputChannel] = useState("");
  const [outputEmail, setOutputEmail] = useState("");
  const [promptTemplate, setPromptTemplate] = useState("");
  const [saving, setSaving] = useState(false);

  const channelList = channels?.channels ?? [];
  const agentList = agents?.agents ?? [];

  const save = async () => {
    if (!channelId || !agentId) {
      toast.error("Pick a channel and an agent");
      return;
    }
    setSaving(true);
    const chanObj = channelList.find((c) => c.id === channelId);
    const output_config: Record<string, unknown> = {};
    if (outputType === "slack_channel" && outputChannel) {
      output_config.channel_id = outputChannel;
    }
    if (outputType === "gmail" && outputEmail) {
      output_config.email = outputEmail;
    }
    try {
      const res = await fetch("/api/connections/slack/bindings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slack_channel_id: channelId,
          slack_channel_name: chanObj?.name ?? null,
          agent_id: agentId,
          trigger_type: triggerType,
          output_type: outputType,
          output_config,
          prompt_template: promptTemplate || null,
        }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "save failed");
      toast.success("Binding created");
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded border border-primary/30 bg-primary/5 p-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-[11px] font-medium text-muted-foreground">
            Channel
          </Label>
          <select
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            className="mt-1 w-full rounded border border-border bg-background/60 px-2 py-1 text-[12px] text-foreground"
          >
            <option value="">— select channel —</option>
            {channelList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.is_private ? "🔒" : "#"}
                {c.name}
                {!c.is_member ? " (bot not a member)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-[11px] font-medium text-muted-foreground">
            Agent
          </Label>
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="mt-1 w-full rounded border border-border bg-background/60 px-2 py-1 text-[12px] text-foreground"
          >
            <option value="">— select agent —</option>
            {agentList.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.title ? ` — ${a.title}` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-[11px] font-medium text-muted-foreground">
            Trigger
          </Label>
          <select
            value={triggerType}
            onChange={(e) =>
              setTriggerType(e.target.value as SlackBinding["trigger_type"])
            }
            className="mt-1 w-full rounded border border-border bg-background/60 px-2 py-1 text-[12px] text-foreground"
          >
            {(Object.keys(TRIGGER_LABELS) as SlackBinding["trigger_type"][]).map(
              (k) => (
                <option key={k} value={k}>
                  {TRIGGER_LABELS[k]}
                </option>
              ),
            )}
          </select>
        </div>
        <div>
          <Label className="text-[11px] font-medium text-muted-foreground">
            Send output to
          </Label>
          <select
            value={outputType}
            onChange={(e) =>
              setOutputType(e.target.value as SlackBinding["output_type"])
            }
            className="mt-1 w-full rounded border border-border bg-background/60 px-2 py-1 text-[12px] text-foreground"
          >
            {(Object.keys(OUTPUT_LABELS) as SlackBinding["output_type"][]).map(
              (k) => (
                <option key={k} value={k}>
                  {OUTPUT_LABELS[k]}
                </option>
              ),
            )}
          </select>
        </div>
      </div>

      {outputType === "slack_channel" && (
        <div>
          <Label className="text-[11px] font-medium text-muted-foreground">
            Output channel
          </Label>
          <select
            value={outputChannel}
            onChange={(e) => setOutputChannel(e.target.value)}
            className="mt-1 w-full rounded border border-border bg-background/60 px-2 py-1 text-[12px] text-foreground"
          >
            <option value="">— select channel —</option>
            {channelList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.is_private ? "🔒" : "#"}
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {outputType === "gmail" && (
        <div>
          <Label className="text-[11px] font-medium text-muted-foreground">
            Email address
          </Label>
          <Input
            type="email"
            value={outputEmail}
            onChange={(e) => setOutputEmail(e.target.value)}
            placeholder="you@example.com"
            className="mt-1 text-[12px]"
          />
          <p className="mt-1 text-[10.5px] text-muted-foreground">
            Note: Gmail sending isn&apos;t wired up yet — for now the reply
            gets posted as a Slack thread note instead.
          </p>
        </div>
      )}

      <div>
        <Label className="text-[11px] font-medium text-muted-foreground">
          Prompt template (optional)
        </Label>
        <Textarea
          value={promptTemplate}
          onChange={(e) => setPromptTemplate(e.target.value)}
          placeholder="e.g. Extract concrete developer tasks from this transcript as a bullet list"
          className="mt-1 text-[12px]"
          rows={2}
        />
        <p className="mt-1 text-[10.5px] text-muted-foreground">
          Prepended to the message / file content. Leave empty to let the
          agent freestyle per its persona.
        </p>
      </div>

      <div className="flex gap-2">
        <Button
          onClick={save}
          disabled={saving}
          className="btn-shine bg-primary text-white hover:bg-primary/90"
        >
          {saving ? "Saving…" : "Create binding"}
        </Button>
        <Button
          variant="secondary"
          onClick={onCancel}
          disabled={saving}
          className="bg-white/5 text-foreground hover:bg-white/10"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
